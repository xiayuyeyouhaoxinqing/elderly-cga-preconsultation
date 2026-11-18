"""量表列表参数、权限和文字过滤契约；不连接数据库或Redis。"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.api import scales
from app.api.dependencies import require_staff
from app.models.base import get_db
from app.services import scale_service


@pytest.fixture
def client(monkeypatch):
    """隔离基础设施，仅装载本次路由。"""
    app = FastAPI()
    app.include_router(scales.router)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[require_staff] = lambda: SimpleNamespace(id=1)
    monkeypatch.setattr(scale_service, "list_published_scales", lambda db, keyword=None: [])
    with TestClient(app) as test_client:
        yield test_client, app


def test_list_and_length(client):
    """原调用及空白兼容，超长输入由路由拒绝。"""
    http, _ = client
    for params in ({}, {"keyword": ""}, {"keyword": "  "}, {"keyword": "营养"}):
        result = http.get("/api/scales", params=params)
        assert result.status_code == 200
        assert result.json() == {"code": "OK", "message": "成功", "data": []}
    assert http.get("/api/scales", params={"keyword": "x" * 51}).status_code == 422


def test_staff_guard(client):
    """医护身份依赖必须被实际执行，不能绕开。"""
    http, app = client

    def deny():
        raise HTTPException(status_code=401)

    app.dependency_overrides[require_staff] = deny
    assert http.get("/api/scales").status_code == 401


def test_query_keeps_published_window_and_escapes():
    """检查查询保留发布与生效限制，并绑定转义后参数；非数据库执行验证。"""

    class FakeDb:
        statement = None

        def execute(self, statement):
            self.statement = statement
            return SimpleNamespace(all=lambda: [])

    db = FakeDb()
    assert scale_service.list_published_scales(db, "  A%_  ") == []
    query = db.statement.compile(dialect=postgresql.dialect())
    assert "A/%/_" in query.params.values()
    assert "已发布" in query.params.values()
    assert "effective_time" in str(query) and "expire_time" in str(query)
    assert "ORDER BY assessment_scale.id ASC" in str(query)


def test_whitespace_has_no_name_filter():
    """空白输入保持原列表查询。"""

    class FakeDb:
        def execute(self, statement):
            self.statement = statement
            return SimpleNamespace(all=lambda: [])

    db = FakeDb()
    scale_service.list_published_scales(db, "   ")
    assert "LIKE" not in str(db.statement.compile(dialect=postgresql.dialect()))
