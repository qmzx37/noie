"""record_daily_trace Tool의 사실 중심 입력 계약입니다."""

from pydantic import BaseModel, ConfigDict, Field


class DailyTraceArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=50)
