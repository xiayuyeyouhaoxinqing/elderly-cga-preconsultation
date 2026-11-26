"""门诊评估家属协助授权 ORM 模型
作用：记录老人本人授权谁在本次就诊中协助回答，以及允许协助的采集范围。
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, BusinessBaseMixin


class PatientAssistanceAuthorization(BusinessBaseMixin, Base):
    """本次门诊就诊的协助人授权记录，历史授权只撤销不覆盖。"""

    __tablename__ = "patient_assistance_authorization"

    patient_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("patient.id", ondelete="RESTRICT"),
        nullable=False,
        comment="患者ID",
    )
    encounter_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("patient_encounter.id", ondelete="RESTRICT"),
        nullable=False,
        comment="本次就诊ID",
    )
    consent_record_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("consent_record.id", ondelete="SET NULL"),
        nullable=True,
        comment="授权时已同意的门诊评估同意记录",
    )
    helper_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="协助人姓名")
    helper_relation: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="协助人与患者关系"
    )
    helper_contact_masked: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="协助人联系方式掩码，不保存明文"
    )
    assist_scope: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment="允许协助的采集范围编码列表"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", comment="active/revoked"
    )
    authorized_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, comment="授权生效时间"
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="撤销时间"
    )
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True, comment="撤销或替换原因")
    recorded_by: Mapped[str] = mapped_column(
        String(32), nullable=False, comment="登记来源，如 patient:12"
    )

    __table_args__ = (
        Index(
            "idx_assistance_authorization_encounter",
            "encounter_id",
            "status",
            "deleted",
        ),
        Index(
            "idx_assistance_authorization_patient",
            "patient_id",
            "encounter_id",
            "deleted",
        ),
    )
