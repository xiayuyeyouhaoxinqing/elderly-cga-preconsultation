"""门诊评估电子确认契约。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AssessmentConsentStatus = Literal["pending", "agreed", "declined"]


class AssessmentConsentDto(BaseModel):
    record_id: int
    title: str
    version: str
    full_text: str
    status: AssessmentConsentStatus
    decided_at: datetime | None = None


class AssessmentConsentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_id: int = Field(gt=0)
    version: str = Field(min_length=1, max_length=64)
    decision: Literal["agree", "decline"]
