"""门诊评估协助授权的 HTTP 边界测试，使用 SQLite 和替身会话。"""

from datetime import UTC, datetime
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api import tasks
from app.api.dependencies import require_assessment_patient, require_staff_or_assessment_patient
from app.errors.handlers import register_exception_handlers
from app.models.base import Base, get_db
from app.models.patient_assistance import PatientAssistanceAuthorization
from app.models.patient_portal import ConsentDocument, ConsentDocumentVersion, ConsentRecord
from app.models.patient_task import CareTask, Patient, PatientEncounter
from app.schemas.patient import OUTPATIENT_ACTIVE, OUTPATIENT_CLOSED
from app.services import assistance_authorization_service


@compiles(JSONB, "sqlite")
def sqlite_json(*_args, **_kwargs):
    return "JSON"


@compiles(BigInteger, "sqlite")
def sqlite_integer(*_args, **_kwargs):
    return "INTEGER"


def _build_app(
    engine,
    access: str,
    *,
    patient_id: int = 1,
    encounter_id: int = 20,
    encounter_status: str = OUTPATIENT_ACTIVE,
) -> FastAPI:
    """按患者或职工会话构造只挂载任务路由的最小应用。"""

    def get_session():
        with Session(engine) as db:
            yield db

    def patient_context():
        return (
            SimpleNamespace(id=patient_id),
            SimpleNamespace(id=encounter_id, encounter_status=encounter_status),
        )

    def staff_context():
        return SimpleNamespace(id=7, staff_no="CGA-TEST")

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(tasks.router)
    app.dependency_overrides[get_db] = get_session
    app.dependency_overrides[require_assessment_patient] = patient_context
    app.dependency_overrides[require_staff_or_assessment_patient] = (
        staff_context if access == "staff" else patient_context
    )
    return app


def _seed(engine) -> None:
    now = datetime.now(UTC)
    with Session(engine) as db:
        db.add(Patient(id=1, patient_no="P1", patient_name="合成患者"))
        db.add(Patient(id=2, patient_no="P2", patient_name="其他患者"))
        db.add(
            PatientEncounter(
                id=20,
                encounter_no="E20",
                patient_id=1,
                admission_time=now,
                encounter_status=OUTPATIENT_ACTIVE,
            )
        )
        db.add(
            PatientEncounter(
                id=21,
                encounter_no="E21",
                patient_id=2,
                admission_time=now,
                encounter_status=OUTPATIENT_ACTIVE,
            )
        )
        db.add(
            CareTask(
                id=30,
                task_no="T30",
                patient_id=1,
                encounter_id=20,
                task_type="assessment",
                task_name="门诊评估",
                task_source="manual",
                collection_mode="traditional_form",
                task_status="pending",
                assigned_nurse_id=7,
            )
        )
        db.add(
            CareTask(
                id=31,
                task_no="T31",
                patient_id=2,
                encounter_id=21,
                task_type="assessment",
                task_name="门诊评估",
                task_source="manual",
                collection_mode="traditional_form",
                task_status="pending",
                assigned_nurse_id=7,
            )
        )
        db.add(
            ConsentDocument(
                id=40,
                consent_code="C40",
                consent_name="合成同意书",
                consent_type="outpatient_assessment",
            )
        )
        db.add(
            ConsentDocumentVersion(
                id=50,
                consent_document_id=40,
                version_code="v1",
                full_text="合成正文",
            )
        )
        db.add(
            ConsentRecord(
                id=60,
                task_id=30,
                patient_id=1,
                encounter_id=20,
                consent_document_id=40,
                consent_version_id=50,
                participant_type="patient",
                record_status="进行中",
                started_at=now,
            )
        )
        db.commit()


def _tables():
    return [
        Patient.__table__,
        PatientEncounter.__table__,
        CareTask.__table__,
        ConsentDocument.__table__,
        ConsentDocumentVersion.__table__,
        ConsentRecord.__table__,
        PatientAssistanceAuthorization.__table__,
    ]


PAYLOAD = {
    "helper_name": "合成家属",
    "helper_relation": "子女",
    "helper_phone": "13800001234",
    "scope": ["history", "medication"],
    "confirmed_by_patient": True,
}


def test_assistance_authorization_requires_consent_and_keeps_history():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=_tables())
    _seed(engine)
    path = "/api/tasks/T30/assistance-authorization"

    with TestClient(_build_app(engine, "patient"), base_url="https://testserver") as client:
        # 尚未同意门诊评估时不得授权，但可以读到空的授权快照与可选范围。
        assert client.put(path, json=PAYLOAD).status_code == 403
        blank = client.get(path).json()["data"]
        assert blank["status"] == "none"
        assert {item["code"] for item in blank["scope_options"]} >= {"history", "adl"}
        assert {item["code"] for item in blank["non_assistable"]} == {
            "cognitive",
            "delirium",
            "performance",
            "professional",
        }

        with Session(engine) as db:
            record = db.scalar(select(ConsentRecord).where(ConsentRecord.id == 60))
            record.record_status = "已完成"
            record.patient_confirmed = True
            db.commit()

        authorized = client.put(path, json=PAYLOAD)
        assert authorized.status_code == 200, authorized.text
        data = authorized.json()["data"]
        assert data["status"] == "active"
        assert data["helper_contact_masked"].endswith("1234")
        assert "13800001234" not in str(data)
        assert set(data["scope"]) == {"history", "medication"}

        # 未知关系、缺少明确确认和不可代答范围都在入口被拒绝。
        assert client.put(path, json={**PAYLOAD, "helper_relation": "路人"}).status_code == 422
        assert (
            client.put(
                path,
                json={
                    **PAYLOAD,
                    "confirmed_by_patient": False,
                },
            ).status_code
            == 422
        )
        assert client.put(path, json={**PAYLOAD, "scope": ["cognitive"]}).status_code == 422

        # 更换协助人时旧记录撤销，新记录生效，联系方式不保存明文。
        replaced = client.put(
            path,
            json={
                **PAYLOAD,
                "helper_name": "合成照护者",
                "helper_relation": "照护者",
                "helper_phone": None,
                "scope": ["environment", "nutrition"],
            },
        )
        assert replaced.status_code == 200
        assert replaced.json()["data"]["helper_name"] == "合成照护者"
        with Session(engine) as db:
            rows = db.scalars(
                select(PatientAssistanceAuthorization).order_by(PatientAssistanceAuthorization.id)
            ).all()
            assert [row.status for row in rows] == ["revoked", "active"]
            assert rows[0].revoke_reason == "本人更换协助人"
            assert rows[0].helper_contact_masked.endswith("1234")
            assert rows[0].consent_record_id == 60

        revoked = client.post(f"{path}/revoke", json={"reason": "家属临时离开"})
        assert revoked.status_code == 200
        assert revoked.json()["data"]["status"] == "revoked"
        assert revoked.json()["data"]["revoke_reason"] == "家属临时离开"
        assert client.post(f"{path}/revoke", json={}).status_code == 409

        # 撤销后再次授权需要重新登记，不复用旧记录。
        again = client.put(path, json=PAYLOAD)
        assert again.status_code == 200
        assert again.json()["data"]["status"] == "active"

    # 其他患者、已结束就诊和越权任务都不可读写。
    with TestClient(
        _build_app(engine, "patient", patient_id=2, encounter_id=21),
        base_url="https://testserver",
    ) as other:
        assert other.put(path, json=PAYLOAD).status_code == 403
        assert other.get(path).status_code == 403
        assert (
            other.get("/api/tasks/T31/assistance-authorization").json()["data"]["status"] == "none"
        )

    with TestClient(
        _build_app(engine, "patient", encounter_status=OUTPATIENT_CLOSED),
        base_url="https://testserver",
    ) as closed:
        assert closed.put(path, json=PAYLOAD).status_code == 401

    # 责任职工只读取状态，不能替患者授权。
    with TestClient(_build_app(engine, "staff"), base_url="https://testserver") as staff:
        assert staff.get(path).json()["data"]["helper_name"] == "合成家属"

    engine.dispose()


def test_authorization_summary_hides_revoked_helper():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=_tables())
    _seed(engine)
    with Session(engine) as db:
        assert assistance_authorization_service.authorization_summary(db, 20) == (
            "none",
            None,
            [],
        )
        db.add(
            PatientAssistanceAuthorization(
                patient_id=1,
                encounter_id=20,
                helper_name="合成家属",
                helper_relation="子女",
                helper_contact_masked="********1234",
                assist_scope=["history"],
                status="revoked",
                authorized_at=datetime.now(UTC),
                revoked_at=datetime.now(UTC),
                recorded_by="patient:1",
            )
        )
        db.commit()
        assert assistance_authorization_service.authorization_summary(db, 20) == (
            "revoked",
            None,
            [],
        )
    engine.dispose()
