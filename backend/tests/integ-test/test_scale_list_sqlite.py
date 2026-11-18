"""列表服务的实际SQL执行验证；临时SQLite，不替代PostgreSQL环境验收。"""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api import auth, scales
from app.configs.app_config import get_app_config
from app.errors.handlers import register_exception_handlers
from app.models.assessment_template import (
    AssessmentQuestion,
    AssessmentScale,
    AssessmentScaleVersion,
    AssessmentSection,
)
from app.models.base import Base, get_db
from app.models.staff_account import StaffAccount
from app.services import staff_service
from app.services.scale_service import list_published_scales
from app.utils.password import hash_password


@compiles(JSONB, "sqlite")
def jsonb_for_sqlite(element, compiler, **kwargs):
    """仅将测试库JSONB列编译成SQLite JSON，不改变生产模型。"""
    return "JSON"


def test_filter_and_staff_session_runs_against_sqlite(monkeypatch):
    """验证发布、生效、删除、互斥时间窗及通配符字面匹配。"""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [
        model.__table__
        for model in (
            AssessmentScale,
            AssessmentScaleVersion,
            AssessmentSection,
            AssessmentQuestion,
            StaffAccount,
        )
    ]
    Base.metadata.create_all(engine, tables=tables)
    now = datetime.now(UTC)
    with Session(engine) as db:
        db.add(StaffAccount(
            id=1, staff_no="CGA001", staff_name="评估测试职工",
            password_hash=hash_password("week1-test-only"), role_code="nurse",
            account_status="启用", deleted=0,
        ))
        for ident, name, status, start, end, deleted in [
            (1, "营养评估", "已发布", None, None, 0),
            (2, "A%_测试", "已发布", None, None, 0),
            (3, "营养草稿", "审核中", None, None, 0),
            (4, "营养未来", "已发布", now + timedelta(days=1), None, 0),
            (5, "营养过期", "已发布", None, now - timedelta(days=1), 0),
            (6, "营养删除", "已发布", None, None, 1),
        ]:
            db.add(
                AssessmentScale(
                    id=ident,
                    scale_code=f"test_{ident}",
                    scale_name=name,
                    scale_type="测试",
                    status="启用",
                    deleted=deleted,
                )
            )
            db.add(
                AssessmentScaleVersion(
                    id=ident,
                    scale_id=ident,
                    version_code="v1",
                    version_name="测试版本",
                    publish_status=status,
                    effective_time=start,
                    expire_time=end,
                    scale_snapshot={},
                    content_hash=str(ident),
                )
            )
        db.commit()
        assert [x.id for x in list_published_scales(db)] == [1, 2]
        assert [x.id for x in list_published_scales(db, "  营养  ")] == [1]
        assert [x.id for x in list_published_scales(db, "%_")] == [2]
        assert list_published_scales(db, "无匹配") == []
        assert len(list_published_scales(db, "  ")) == 2
        assert list_published_scales(db)[0].question_count == 0

    class MemorySessions:
        def __init__(self):
            self.values = {}

        def set(self, key, value, *, ex):
            self.values[key] = value
            return True

        def get(self, key):
            return self.values.get(key)

        def delete(self, key):
            self.values.pop(key, None)

    session_store = MemorySessions()
    monkeypatch.setattr(staff_service, "get_redis", lambda: session_store)

    def local_session():
        with Session(engine) as db:
            yield db

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(auth.router)
    app.include_router(scales.router)
    app.dependency_overrides[get_db] = local_session
    with TestClient(app, base_url="https://testserver") as http:
        http.cookies.set(get_app_config().security.patient_session_cookie, "patient-only")
        assert http.get("/api/scales").status_code == 401
        assert http.post("/api/auth/staff/login", json={
            "staff_no": "CGA001", "password": "wrong"
        }).status_code == 401
        login = http.post("/api/auth/staff/login", json={
            "staff_no": "CGA001", "password": "week1-test-only"
        })
        assert login.status_code == 200
        assert "httponly" in login.headers["set-cookie"].lower()
        result = http.get("/api/scales")
        assert result.status_code == 200
        assert [row["id"] for row in result.json()["data"]] == [1, 2]
        assert http.post("/api/auth/staff/logout").status_code == 200
        assert http.get("/api/scales").status_code == 401
    engine.dispose()
