"""新增门诊评估家属协助授权表。"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260826_outpatient_assistance"
down_revision: str | Sequence[str] | None = "20260822_patient_portal"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _base() -> list[sa.Column]:
    return [
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("creator", sa.String(64), nullable=True),
        sa.Column("updator", sa.String(64), nullable=True),
        sa.Column(
            "create_time",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "update_time",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted", sa.Integer(), server_default="0", nullable=False),
    ]


def upgrade() -> None:
    """创建本次就诊的协助授权记录，历史授权只撤销不覆盖。"""
    op.create_table(
        "patient_assistance_authorization",
        *_base(),
        sa.Column(
            "patient_id",
            sa.BigInteger(),
            sa.ForeignKey("patient.id", ondelete="RESTRICT"),
            nullable=False,
            comment="患者ID",
        ),
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("patient_encounter.id", ondelete="RESTRICT"),
            nullable=False,
            comment="本次就诊ID",
        ),
        sa.Column(
            "consent_record_id",
            sa.BigInteger(),
            sa.ForeignKey("consent_record.id", ondelete="SET NULL"),
            nullable=True,
            comment="授权时已同意的门诊评估同意记录",
        ),
        sa.Column("helper_name", sa.String(128), nullable=False, comment="协助人姓名"),
        sa.Column("helper_relation", sa.String(64), nullable=False, comment="协助人与患者关系"),
        sa.Column(
            "helper_contact_masked",
            sa.String(64),
            nullable=True,
            comment="协助人联系方式掩码，不保存明文",
        ),
        sa.Column(
            "assist_scope",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="允许协助的采集范围编码列表",
        ),
        sa.Column(
            "status",
            sa.String(16),
            nullable=False,
            server_default="active",
            comment="active/revoked",
        ),
        sa.Column(
            "authorized_at",
            sa.DateTime(timezone=True),
            nullable=False,
            comment="授权生效时间",
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True, comment="撤销时间"),
        sa.Column("revoke_reason", sa.Text(), nullable=True, comment="撤销或替换原因"),
        sa.Column(
            "recorded_by",
            sa.String(32),
            nullable=False,
            comment="登记来源，如 patient:12",
        ),
    )
    op.create_index(
        "idx_assistance_authorization_encounter",
        "patient_assistance_authorization",
        ["encounter_id", "status", "deleted"],
    )
    op.create_index(
        "idx_assistance_authorization_patient",
        "patient_assistance_authorization",
        ["patient_id", "encounter_id", "deleted"],
    )


def downgrade() -> None:
    """移除协助授权表。"""
    op.drop_index(
        "idx_assistance_authorization_patient",
        table_name="patient_assistance_authorization",
    )
    op.drop_index(
        "idx_assistance_authorization_encounter",
        table_name="patient_assistance_authorization",
    )
    op.drop_table("patient_assistance_authorization")
