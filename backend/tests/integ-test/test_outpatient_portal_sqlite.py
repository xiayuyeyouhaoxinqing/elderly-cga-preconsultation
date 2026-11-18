"""门诊入口的 HTTP 与 SQL 隔离测试，Redis 会话使用内存替身。"""

from datetime import UTC, datetime
from types import SimpleNamespace

from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api import patients, tasks
from app.api.dependencies import require_patient, require_staff
from app.configs.app_config import get_app_config
from app.errors.codes import ErrorCode
from app.errors.handlers import AppError, register_exception_handlers
from app.models.base import Base, get_db
from app.models.patient_task import CareTask, Patient, PatientEncounter
from app.schemas.task import BackendTaskDto
from app.services import patient_service, task_service
from app.utils.patient_identity import encrypt_id_card


@compiles(JSONB, "sqlite")
def sqlite_json(*_args, **_kwargs):
    return "JSON"


@compiles(BigInteger, "sqlite")
def sqlite_integer(*_args, **_kwargs):
    return "INTEGER"


def test_outpatient_login_scopes_tasks_and_rejects_closed_session(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=[
        Patient.__table__, PatientEncounter.__table__, CareTask.__table__,
    ])
    config = get_app_config()
    identity = "110101195507250026"
    phone = "13800000002"
    now = datetime.now(UTC)
    with Session(engine) as db:
        db.add_all([
            Patient(id=1, patient_no="P1", patient_name="测试患者",
                    phone=phone, id_card_ciphertext=encrypt_id_card(
                        identity, config.security.patient_identity_secret)),
            Patient(id=2, patient_no="P2", patient_name="其他患者"),
        ])
        db.add(PatientEncounter(
            id=20, encounter_no="INACTIVE", patient_id=1, admission_time=now,
            encounter_status="已出院",
        ))
        db.commit()

    sessions = {}
    def save_session(key, value, *, ex):
        sessions[key] = value
        return True

    monkeypatch.setattr(patient_service, "get_redis", lambda: SimpleNamespace(
        set=save_session, get=sessions.get, delete=lambda key: sessions.pop(key, None),
    ))

    def task_dto(_db, task):
        return BackendTaskDto(
            id=task.id, task_id=task.id, task_no=task.task_no, patient_id=task.patient_id,
            encounter_id=task.encounter_id, encounter_no=str(task.encounter_id),
            patient_name="测试", task_type=task.task_type, collection_mode=task.collection_mode,
            task_status=task.task_status, created_at=task.create_time.isoformat(),
        )

    monkeypatch.setattr(task_service, "_to_backend_task_dto", task_dto)

    def get_session():
        with Session(engine) as db:
            yield db

    def staff_only(request: Request):
        if request.headers.get("x-test-staff") != "staff":
            raise AppError(ErrorCode.ERR_STAFF_002)
        return SimpleNamespace(staff_no="CGA-TEST")

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(patients.router)
    app.include_router(tasks.router)
    app.get("/legacy-check", dependencies=[Depends(require_patient)])(
        lambda: {"ok": True}
    )
    app.dependency_overrides[get_db] = get_session
    app.dependency_overrides[require_staff] = staff_only
    credentials = {"id_card_no": identity, "phone": phone}
    register = "/api/patients/1/outpatient-encounters"
    payload = {"department_name": "老年医学科"}
    staff = {"x-test-staff": "staff"}

    with TestClient(app, base_url="https://testserver") as client:
        assert client.post(register, json=payload).status_code == 401
        assert client.post("/api/patients/login", json=credentials).status_code == 403
        created = client.post(register, json=payload, headers=staff)
        assert created.status_code == 200
        encounter = created.json()["data"]["encounter"]
        assert encounter["inpatient_no"] is None
        assert encounter["bed_no"] is None
        assert client.post(register, json=payload, headers=staff).status_code == 409
        with Session(engine) as db:
            db.add_all([
                CareTask(task_no=no, patient_id=owner, encounter_id=encounter_id,
                         task_type="assessment", task_name="合成用例", task_source="manual",
                         collection_mode="traditional_form", task_status="pending")
                for no, owner, encounter_id in [
                    ("CURRENT", 1, encounter["id"]), ("OLD", 1, 20),
                    ("OTHER", 2, encounter["id"]),
                ]
            ])
            db.commit()
        assert client.post("/api/patients/login", json={
            **credentials, "encounter_kind": "inpatient",
        }).status_code == 403
        logged_in = client.post("/api/patients/login", json=credentials)
        assert logged_in.status_code == 200
        assert "httponly" in logged_in.headers["set-cookie"].lower()
        assert [row["task_no"] for row in logged_in.json()["data"]["tasks"]] == ["CURRENT"]
        task_rows = client.get("/api/patients/me/tasks").json()["data"]
        assert [row["task_no"] for row in task_rows] == ["CURRENT"]
        assert client.get("/legacy-check").status_code == 403
        assert client.get("/api/tasks/OLD/questionnaire").status_code == 403
        close = f"/api/patients/outpatient-encounters/{encounter['id']}/close"
        assert client.post(close).status_code == 401
        assert client.post(close, headers=staff).status_code == 200
        assert client.post(close, headers=staff).status_code == 200
        assert client.get("/api/patients/me/tasks").status_code == 401
        assert client.post("/api/patients/login", json=credentials).status_code == 403
        assert client.post(register, json=payload, headers=staff).status_code == 200
    engine.dispose()
