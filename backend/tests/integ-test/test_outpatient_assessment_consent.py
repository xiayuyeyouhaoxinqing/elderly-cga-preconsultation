"""门诊评估同意控制，使用一次性 PostgreSQL、Redis 和合成身份。"""

import os
from contextlib import closing
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.configs.app_config import get_app_config
from app.main import create_app
from app.models import base
from app.models.assessment_template import AssessmentQuestion, AssessmentScale, AssessmentScaleVersion
from app.models.patient_portal import ConsentDocument, ConsentDocumentVersion, ConsentRecord
from app.models.patient_task import CareTask, Patient, PatientEncounter
from app.models.staff_account import StaffAccount
from app.schemas.patient import OUTPATIENT_ACTIVE
from app.utils.password import hash_password
from app.utils.patient_identity import encrypt_id_card


@pytest.mark.skipif(
    os.getenv("TEST_WEEK2_LIVE_SERVICES") != "1",
    reason="需要一次性 PostgreSQL 和 Redis",
)
def test_outpatient_consent_gates_questionnaire_and_pins_document(monkeypatch):
    config = get_app_config()
    assert config.database.host == config.redis.host == "127.0.0.1"
    assert config.database.db.startswith("cga_week2_test")
    assert config.redis.port != 6379
    suffix = uuid4().hex[:10]
    code = f"CONSENT-{suffix}"
    monkeypatch.setattr(config.security, "outpatient_consent_document_code", code)
    now = datetime.now(UTC)
    identity = "990000" + str(uuid4().int)[-12:]
    phone = "199" + str(uuid4().int)[-8:]
    password = "synthetic-assessment-consent"

    app = create_app()
    with TestClient(app, base_url="https://testserver") as staff, closing(
        TestClient(app, base_url="https://testserver")
    ) as patient:
        with base.SessionLocal() as db:
            person = Patient(
                patient_no=code, patient_name="合成门诊患者", phone=phone,
                id_card_ciphertext=encrypt_id_card(identity, config.security.patient_identity_secret),
            )
            nurse = StaffAccount(
                staff_no=code.upper(), staff_name="合成测试职工", password_hash=hash_password(password),
            )
            scale = AssessmentScale(scale_code=code, scale_name="合成问卷", scale_type="评估", status="启用")
            db.add_all([person, nurse, scale])
            db.flush()
            encounter = PatientEncounter(
                patient_id=person.id, encounter_no=code, encounter_status=OUTPATIENT_ACTIVE, admission_time=now,
            )
            scale_version = AssessmentScaleVersion(
                scale_id=scale.id, version_code="v1", version_name="测试版", publish_status="已发布",
                scale_snapshot={}, content_hash=suffix,
            )
            db.add_all([encounter, scale_version])
            db.flush()
            question = AssessmentQuestion(
                scale_version_id=scale_version.id, question_code="note", question_name="测试题",
                original_text="测试题", patient_text="测试题", question_type="text", value_type="text",
                required=True,
            )
            db.add(question)
            db.commit()
            payload = {
                "patient_id": person.id, "encounter_id": encounter.id, "scale_ids": [scale.id],
                "collection_mode": "traditional_form", "assessment_scene": "outpatient",
            }
            staff_no, question_id = nurse.staff_no, question.id

        assert staff.post("/api/auth/staff/login", json={"staff_no": staff_no, "password": password}).status_code == 200
        assert staff.post("/api/tasks", json=payload).status_code == 409
        with base.SessionLocal() as db:
            assert db.scalar(select(CareTask).where(CareTask.encounter_id == payload["encounter_id"])) is None
            document = ConsentDocument(
                consent_code=code, consent_name="合成测试文书", consent_type="outpatient_assessment",
            )
            db.add(document)
            db.flush()
            document_id = document.id
            db.add(ConsentDocumentVersion(
                consent_document_id=document_id, version_code="v1", full_text="仅用于测试的第一版文书。",
            ))
            db.commit()

        def create_task():
            response = staff.post("/api/tasks", json=payload)
            assert response.status_code == 200, response.text
            return response.json()["data"]["task"]

        first = create_task()
        task_id = str(first["task_id"])
        consent_path = f"/api/tasks/{task_id}/assessment-consent"
        questionnaire_path = f"/api/tasks/{task_id}/questionnaire"
        answers = {"task_id": task_id, "answers": {str(question_id): "合成回答"}}
        assert first["assessment_consent_status"] == "pending"
        assert patient.get(consent_path).status_code == 401
        assert staff.get(consent_path).status_code == 401
        credentials = {"id_card_no": identity, "phone": phone, "encounter_kind": "outpatient"}
        assert patient.post("/api/patients/login", json=credentials).status_code == 200
        assert patient.get(questionnaire_path).status_code == 403
        with monkeypatch.context() as disabled:
            disabled.setattr(config.security, "outpatient_consent_document_code", None)
            assert patient.get(questionnaire_path).status_code == 403
        assert patient.put(f"{questionnaire_path}/draft", json=answers).status_code == 403
        assert patient.post(f"{questionnaire_path}/submit", json=answers).status_code == 403
        assert patient.get(f"/api/consent-forms/{task_id}/snapshot").status_code == 403
        snapshot = patient.get(consent_path).json()["data"]
        assert snapshot["version"] == "v1"

        with base.SessionLocal() as db:
            db.add(ConsentDocumentVersion(
                consent_document_id=document_id, version_code="v2",
                full_text="仅用于测试的第二版文书。", effective_time=now,
            ))
            db.commit()
        assert patient.get(consent_path).json()["data"]["version"] == "v1"
        decision = {"record_id": snapshot["record_id"], "version": "v1", "decision": "agree"}
        assert patient.put(consent_path, json={**decision, "version": "v2"}).status_code == 409
        approved = patient.put(consent_path, json=decision).json()["data"]
        assert approved["status"] == "agreed"
        assert patient.put(consent_path, json=decision).json()["data"]["decided_at"] == approved["decided_at"]
        assert patient.put(f"{questionnaire_path}/draft", json=answers).status_code == 200
        assert staff.get(f"/api/tasks/{task_id}").json()["data"]["assessment_consent_status"] == "agreed"

        second = create_task()
        second_id = str(second["task_id"])
        second_path = f"/api/tasks/{second_id}/assessment-consent"
        second_snapshot = patient.get(second_path).json()["data"]
        assert second_snapshot["version"] == "v2"
        declined = {**decision, "record_id": second_snapshot["record_id"], "version": "v2", "decision": "decline"}
        assert patient.put(second_path, json=declined).json()["data"]["status"] == "declined"
        assert patient.put(second_path, json={**declined, "decision": "agree"}).status_code == 409
        assert patient.get(f"/api/tasks/{second_id}/questionnaire").status_code == 403
        assert staff.post(f"/api/tasks/{second_id}/review", json={
            "task_id": second_id, "status": "confirmed",
        }).status_code == 409
        assert staff.get(f"/api/tasks/{second_id}").json()["data"]["assessment_consent_status"] == "declined"
        with base.SessionLocal() as db:
            record = db.get(ConsentRecord, snapshot["record_id"])
            assert record.updator == f"patient:{payload['patient_id']}"
        close = f"/api/patients/outpatient-encounters/{payload['encounter_id']}/close"
        assert staff.post(close).status_code == 200
        assert patient.put(consent_path, json=decision).status_code == 401
        assert staff.post(
            f"/api/patients/{payload['patient_id']}/outpatient-encounters",
            json={"department_name": "老年医学科"},
        ).status_code == 200
        assert patient.post("/api/patients/login", json=credentials).status_code == 200
        assert patient.get(consent_path).status_code == 404
