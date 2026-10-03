"""Place의 방문, 현재 장소, 선호와 읽기 응답 계약입니다."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class RecordPlaceEventArguments(BaseModel):
    """좌표나 주소 추정 없이 현재 발화에 있는 장소 표현만 받습니다."""

    model_config = ConfigDict(extra="forbid")
    place_name: str = Field(min_length=1, max_length=120)
    kind: Literal["visit", "context", "preference"]
    preference: Literal["like", "dislike"] | None = None
    occurred_at: AwareDatetime | None = None

    @field_validator("place_name")
    @classmethod
    def validate_place_name(cls, value: str) -> str:
        """공백이나 지시어만 있는 장소를 거부하고 원래 표현은 유지합니다."""
        if not value.strip() or value.strip() in {"거기", "저기", "여기", "그 장소", "이곳", "그곳", "저곳"}:
            raise ValueError("현재 발화에서 식별 가능한 장소가 필요합니다.")
        return value

    @model_validator(mode="after")
    def validate_preference(self) -> "RecordPlaceEventArguments":
        """선호에만 방향을 요구하고 방문/현재 장소에 선호를 섞지 않습니다."""
        if (self.kind == "preference") != (self.preference is not None):
            raise ValueError("preference는 kind=preference일 때만 반드시 지정합니다.")
        return self


class PlaceEventResponse(BaseModel):
    """원문 대신 Message 근거와 구조화된 결과를 반환합니다."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    conversation_id: UUID | None
    message_id: UUID | None
    agent_action_id: UUID
    place_name: str
    kind: Literal["visit", "context", "preference"]
    preference: Literal["like", "dislike"] | None
    occurred_at: datetime | None
    source: str
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
