"""列表服务的实际SQL执行验证；临时SQLite，不替代PostgreSQL环境验收。"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app.models.assessment_template import (
    AssessmentQuestion,
    AssessmentScale,
    AssessmentScaleVersion,
    AssessmentSection,
)
from app.models.base import Base
from app.services.scale_service import list_published_scales


@compiles(JSONB, "sqlite")
def jsonb_for_sqlite(element, compiler, **kwargs):
    """仅将测试库JSONB列编译成SQLite JSON，不改变生产模型。"""
    return "JSON"


def test_filter_runs_against_real_database():
    """验证发布、生效、删除、互斥时间窗及通配符字面匹配。"""
    engine = create_engine("sqlite://")
    tables = [
        model.__table__
        for model in (
            AssessmentScale,
            AssessmentScaleVersion,
            AssessmentSection,
            AssessmentQuestion,
        )
    ]
    Base.metadata.create_all(engine, tables=tables)
    now = datetime.now(UTC)
    with Session(engine) as db:
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
    engine.dispose()
