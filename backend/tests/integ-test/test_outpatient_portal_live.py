"""门诊 PostgreSQL 行锁与 Redis 会话联调，须显式使用一次性本地数据库。"""

import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.celery_app.tasks import nursing_plan_worker
from app.configs.app_config import get_app_config
from app.main import create_app
from app.models import base as model_base
from app.models.assessment_execution import AssessmentAnswer, AssessmentInstance, AssessmentReview, AssessmentSubmission
from app.models.assessment_template import AssessmentOption, AssessmentQuestion, AssessmentScale, AssessmentScaleVersion
from app.models.patient_task import Patient, PatientEncounter
from app.models.staff_account import StaffAccount
from app.schemas.patient import OUTPATIENT_ACTIVE
from app.utils.password import hash_password
from app.utils.patient_identity import encrypt_id_card
from app.utils.redis_client import get_redis


@pytest.mark.skipif(
    os.getenv("TEST_WEEK2_LIVE_SERVICES") != "1",
    reason="需要显式配置一次性 PostgreSQL 和 Redis",
)
def test_live_outpatient_registration_lock_and_session(monkeypatch):
    monkeypatch.setattr(nursing_plan_worker, "delay", lambda *_: None)
    config = get_app_config()
    assert config.database.host == config.redis.host == "127.0.0.1"
    assert config.database.db.startswith("cga_week2_test")
    assert config.redis.port != 6379
    suffix = uuid4().hex[:12]
    password = "synthetic-week2-test"
    id_card = "990000" + str(uuid4().int)[-12:]
    phone = "199" + str(uuid4().int)[-8:]
    credentials = {"id_card_no": id_card, "phone": phone, "encounter_kind": "outpatient"}
    with TestClient(create_app(), base_url="https://testserver") as client:
        assert get_redis().ping()
        with model_base.SessionLocal() as db:
            patient = Patient(
                patient_no=f"CGA-{suffix}", patient_name="合成门诊患者", phone=phone,
                id_card_ciphertext=encrypt_id_card(id_card, config.security.patient_identity_secret),
            )
            staff = StaffAccount(
                staff_no=f"CGA{suffix.upper()}", staff_name="合成测试职工",
                role_code="nurse", account_status="启用", password_hash=hash_password(password),
            )
            other_staff = StaffAccount(
                staff_no=f"OTHER{suffix.upper()}", staff_name="非责任职工",
                role_code="nurse", account_status="启用", password_hash=hash_password(password),
            )
            db.add_all([patient, staff, other_staff])
            scale = AssessmentScale(
                scale_code=f"LIVE-{suffix}", scale_name="联调量表",
                scale_type="评估", status="启用",
            )
            db.add(scale)
            db.flush()
            version = AssessmentScaleVersion(
                scale_id=scale.id, version_code="v1", version_name="联调版本",
                publish_status="已发布", scale_snapshot={}, content_hash=suffix,
            )
            db.add(version)
            db.flush()
            note = AssessmentQuestion(
                scale_version_id=version.id, question_code="note", question_name="评估备注",
                original_text="评估备注", patient_text="评估备注", question_type="text",
                value_type="text", required=True,
            )
            choice = AssessmentQuestion(
                scale_version_id=version.id, question_code="choice", question_name="测试选择",
                original_text="测试选择", patient_text="测试选择", question_type="single_choice",
                value_type="text", required=True,
            )
            db.add_all([note, choice])
            db.flush()
            db.add(AssessmentOption(
                question_id=choice.id, option_code="a", option_label="选项甲", option_value="甲",
            ))
            db.commit()
            patient_id, staff_no = patient.id, staff.staff_no
            other_staff_no = other_staff.staff_no
            scale_id = scale.id

        register = f"/api/patients/{patient_id}/outpatient-encounters"
        payload = {"department_name": "老年医学科"}
        assert client.post(register, json=payload).status_code == 401
        staff_login = client.post(
            "/api/auth/staff/login", json={"staff_no": staff_no, "password": password},
        )
        assert staff_login.status_code == 200
        barrier = Barrier(3, timeout=10)

        def register_at_barrier():
            barrier.wait()
            return client.post(register, json=payload)

        with ThreadPoolExecutor(max_workers=2) as workers:
            with model_base.SessionLocal() as lock:
                lock.execute(select(Patient.id).where(Patient.id == patient_id).with_for_update())
                first = workers.submit(register_at_barrier)
                second = workers.submit(register_at_barrier)
                barrier.wait()
                waiting = 0
                try:
                    deadline = time.monotonic() + 8
                    while time.monotonic() < deadline:
                        with model_base.SessionLocal() as observer:
                            waiting = observer.scalar(text(
                                "SELECT count(*) FROM pg_stat_activity "
                                "WHERE datname = current_database() AND wait_event_type = 'Lock' "
                                "AND query ILIKE '%FOR UPDATE%'"
                            ))
                        if waiting >= 2:
                            break
                        time.sleep(0.05)
                finally:
                    lock.rollback()
                assert waiting >= 2, "两条登记请求应同时等待 PostgreSQL 行锁"
                results = [first.result(timeout=10), second.result(timeout=10)]

        assert sorted(result.status_code for result in results) == [200, 409]
        with model_base.SessionLocal() as db:
            encounters = db.scalars(select(PatientEncounter).where(
                PatientEncounter.patient_id == patient_id,
                PatientEncounter.encounter_status == OUTPATIENT_ACTIVE,
            )).all()
            assert len(encounters) == 1
            encounter_id = encounters[0].id
            assert encounters[0].inpatient_no is None

        filtered_list = client.get("/api/patients", params={
            "patient_id": patient_id, "status": OUTPATIENT_ACTIVE,
        })
        assert filtered_list.status_code == 200
        assert [row["encounter"]["id"] for row in filtered_list.json()["data"]] == [encounter_id]
        task_payload = {
            "patient_id": patient_id, "encounter_id": encounter_id,
            "scale_ids": [scale_id], "assessment_scene": "outpatient",
            "collection_mode": "traditional_form", "participant_type": "patient",
        }
        assert client.post("/api/tasks", json={
            **task_payload, "collection_mode": "ai_dialogue",
        }).status_code == 404
        created_task = client.post("/api/tasks", json=task_payload)
        assert created_task.status_code == 200, created_task.text
        task = created_task.json()["data"]["task"]
        assert task["assessment_scene"] == "outpatient"

        login = client.post("/api/patients/login", json=credentials)
        assert login.status_code == 200
        assert "httponly" in login.headers["set-cookie"].lower()
        patient_cookie = login.cookies[config.security.patient_session_cookie]
        key = f"patient_auth:{patient_cookie}"
        assert get_redis().get(key) == {"patient_id": patient_id, "encounter_id": encounter_id}
        assert get_redis().client.ttl(key) > 0
        patient_tasks = client.get("/api/patients/me/tasks")
        assert patient_tasks.status_code == 200
        assert [row["task_id"] for row in patient_tasks.json()["data"]] == [task["task_id"]]
        task_id = str(task["task_id"])
        questionnaire_path = f"/api/tasks/{task_id}/questionnaire"
        review_path = f"/api/tasks/{task_id}/review"
        review = {
            "task_id": task_id, "status": "returned", "return_reason": "请补充发生时间",
            "supplementary_inquiry": "职工内部记录",
        }
        assert client.post(review_path, json=review).status_code == 409
        assert client.post(f"{questionnaire_path}/submit", json={
            "task_id": task_id, "answers": {"note": "原始备注", "choice": "a"},
        }).status_code == 200
        assert client.post(review_path, json={**review, "return_reason": "  "}).status_code == 422

        staff_cookie = config.security.staff_session_cookie
        responsible_token = client.cookies.get(staff_cookie)
        assert client.post("/api/auth/staff/login", json={
            "staff_no": other_staff_no, "password": password,
        }).status_code == 200
        assert client.post(review_path, json=review).status_code == 403
        client.cookies.set(staff_cookie, responsible_token, domain="testserver.local", path="/")
        submitted = client.get(questionnaire_path).json()["data"]
        submission_id = submitted["submission_id"]
        review["expected_submission_id"] = submission_id
        returned = client.post(review_path, json=review)
        assert returned.status_code == 200, returned.text
        assert client.post(review_path, json=review).status_code == 409

        client.cookies.delete(staff_cookie)
        assert client.post(review_path, json=review).status_code == 401
        reopened = client.get(questionnaire_path).json()["data"]
        assert reopened["status"] == "returned"
        assert reopened["return_reason"] == "请补充发生时间"
        assert "职工内部记录" not in str(reopened)
        assert [a["answer_text"] for a in reopened["answers"] if a["question_code"] == "note"] == ["原始备注"]
        draft = client.put(f"{questionnaire_path}/draft", json={
            "task_id": task_id, "answers": {"note": "补充后的备注"},
        })
        assert draft.status_code == 200, draft.text
        assert draft.json()["data"]["submission_id"] != submission_id
        resumed = client.get(questionnaire_path).json()["data"]
        assert resumed["status"] == "returned"
        assert resumed["return_reason"] == reopened["return_reason"]
        assert next(a for a in resumed["answers"] if a["question_code"] == "choice")["selected_options"] == ["a"]
        resubmitted = client.post(f"{questionnaire_path}/submit", json={"task_id": task_id})
        assert resubmitted.status_code == 200, resubmitted.text
        after_submit = resubmitted.json()["data"]
        assert after_submit["submission_id"] == resumed["submission_id"]
        assert after_submit["status"] == "submitted"
        assert after_submit["return_reason"] is None
        with model_base.SessionLocal() as db:
            rows = db.scalars(select(AssessmentSubmission).join(AssessmentInstance).where(
                AssessmentInstance.task_id == int(task_id),
                AssessmentSubmission.submission_type == "patient_self",
            )).all()
            assert len(rows) == 2
            assert db.scalar(select(AssessmentAnswer.answer_text).where(
                AssessmentAnswer.submission_id == submission_id,
                AssessmentAnswer.answer_type == "text",
            )) == "原始备注"
            assert db.scalar(select(AssessmentReview.supplementary_inquiry).join(AssessmentInstance).where(
                AssessmentInstance.task_id == int(task_id),
                AssessmentReview.review_status == "returned",
            )) == "职工内部记录"
        client.cookies.set(staff_cookie, responsible_token, domain="testserver.local", path="/")
        assert client.post(review_path, json=review).status_code == 409
        assert client.post(f"/api/patients/outpatient-encounters/{encounter_id}/close").status_code == 200
        assert client.post(review_path, json={
            **review, "expected_submission_id": resumed["submission_id"],
        }).status_code == 409
        assert client.get("/api/patients", params={
            "patient_id": patient_id, "status": OUTPATIENT_ACTIVE,
        }).json()["data"] == []
        assert client.post("/api/tasks", json=task_payload).status_code == 404
        assert client.get("/api/patients/me/tasks").status_code == 401
        assert client.post("/api/patients/logout").status_code == 200
        assert get_redis().get(key) is None
