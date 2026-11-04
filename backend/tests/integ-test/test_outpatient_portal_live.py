"""门诊 PostgreSQL 行锁与 Redis 会话联调，须显式使用一次性本地数据库。"""

import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.configs.app_config import get_app_config
from app.main import create_app
from app.models import base as model_base
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
def test_live_outpatient_registration_lock_and_session():
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
            db.add_all([patient, staff])
            db.commit()
            patient_id, staff_no = patient.id, staff.staff_no

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

        login = client.post("/api/patients/login", json=credentials)
        assert login.status_code == 200
        assert "httponly" in login.headers["set-cookie"].lower()
        patient_cookie = login.cookies[config.security.patient_session_cookie]
        key = f"patient_auth:{patient_cookie}"
        assert get_redis().get(key) == {"patient_id": patient_id, "encounter_id": encounter_id}
        assert get_redis().client.ttl(key) > 0
        assert client.get("/api/patients/me/tasks").status_code == 200
        assert client.post(f"/api/patients/outpatient-encounters/{encounter_id}/close").status_code == 200
        assert client.get("/api/patients/me/tasks").status_code == 401
        assert client.post("/api/patients/logout").status_code == 200
        assert get_redis().get(key) is None
