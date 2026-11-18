"""护士评估复核请求 Schema。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AssessmentReviewRequest(BaseModel):
    """保存护士独立结果或最终确认结果。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str
    nurse_answers: dict[str, str] = Field(default_factory=dict)
    final_answers: dict[str, str] = Field(default_factory=dict)
    correction_reasons: dict[str, str] = Field(default_factory=dict)
    supplementary_inquiry: str = Field(default="", max_length=4000)
    return_reason: str | None = Field(default=None, max_length=1000)
    expected_submission_id: int | None = Field(default=None, gt=0)
    status: Literal["draft", "returned", "confirmed"]
