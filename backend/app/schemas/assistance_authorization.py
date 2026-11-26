"""门诊评估协助授权契约。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AssistanceScopeCode = Literal[
    "history",
    "medication",
    "care_need",
    "adl",
    "iadl",
    "environment",
    "sensory",
    "continence",
    "sleep",
    "nutrition",
    "pain_self",
]

AssistanceAuthorizationStatus = Literal["none", "active", "revoked"]

RELATION_OPTIONS = (
    "配偶",
    "子女",
    "父母",
    "兄弟姐妹",
    "其他亲属",
    "照护者",
)


class AssistanceScopeOption(BaseModel):
    """可协助或不可代答的范围说明。"""

    code: str
    label: str


class AssistanceAuthorizationDto(BaseModel):
    """当前就诊的协助授权快照。"""

    status: AssistanceAuthorizationStatus
    helper_name: str | None = None
    helper_relation: str | None = None
    helper_contact_masked: str | None = None
    scope: list[str] = Field(default_factory=list)
    authorized_at: datetime | None = None
    revoked_at: datetime | None = None
    revoke_reason: str | None = None
    scope_options: list[AssistanceScopeOption] = Field(default_factory=list)
    relation_options: list[str] = Field(default_factory=list)
    non_assistable: list[AssistanceScopeOption] = Field(default_factory=list)


class AssistanceAuthorizationRequest(BaseModel):
    """本人明确授权协助人的请求体。"""

    model_config = ConfigDict(extra="forbid")

    helper_name: str = Field(min_length=1, max_length=32)
    helper_relation: str = Field(min_length=1, max_length=16)
    helper_phone: str | None = Field(default=None, max_length=20)
    scope: list[AssistanceScopeCode] = Field(min_length=1)
    confirmed_by_patient: Literal[True]

    @field_validator("helper_name", "helper_relation")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("不能只填写空格")
        return stripped

    @field_validator("helper_relation")
    @classmethod
    def _known_relation(cls, value: str) -> str:
        if value not in RELATION_OPTIONS:
            raise ValueError("请选择机构确认的协助人关系")
        return value

    @field_validator("helper_phone")
    @classmethod
    def _phone_digits(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        digits = value.strip()
        if not digits.isdigit() or not 6 <= len(digits) <= 20:
            raise ValueError("联系方式只能填写 6 至 20 位数字")
        return digits


class AssistanceAuthorizationRevokeRequest(BaseModel):
    """撤销协助授权的原因。"""

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None
