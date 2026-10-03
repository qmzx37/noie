"""일정 생성 입력과 읽기 전용 응답 계약입니다."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class CreateScheduleArguments(BaseModel):
    """시간대 추정 없이 명시적인 일정 시각만 허용합니다."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    start_at: AwareDatetime
    end_at: AwareDatetime | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        """공백뿐인 제목은 저장하지 않습니다."""
        if not value.strip():
            raise ValueError("일정 제목은 공백일 수 없습니다.")
        return value

    @model_validator(mode="after")
    def validate_end(self) -> "CreateScheduleArguments":
        """종료 시각은 시작 시각보다 뒤여야 합니다."""
        if self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at은 start_at 이후여야 합니다.")
        return self


class ScheduleResponse(BaseModel):
    """원문 대신 Message FK와 구조화된 일정을 반환합니다."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    conversation_id: UUID | None
    message_id: UUID | None
    agent_action_id: UUID
    title: str
    start_at: datetime
    end_at: datetime | None
    source: str
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
