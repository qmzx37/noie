"""추천은 실행 명령이 아니라 최대 두 선택을 제시하는 해석 결과입니다."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RecommendationArguments(BaseModel):
    """미언급 개인 사실은 채우지 않고 신뢰도를 성공 확률로 취급하지 않습니다."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    primary_action: str = Field(min_length=1, max_length=240)
    alternative_action: str | None = Field(default=None, min_length=1, max_length=240)
    rationale: str = Field(min_length=1, max_length=600)
    confidence: float = Field(ge=0, le=1, strict=True)
    recommendation_kind: Literal["direct", "two_step", "recover_then_reassess", "tradeoff"]
    reassess_after_minutes: int | None = Field(default=None, ge=1, le=120, strict=True)

    @model_validator(mode="after")
    def validate_choices(self) -> "RecommendationArguments":
        """문자열의 공백과 선택/재평가 계약을 검증하되 제안 문장을 고치지 않습니다."""
        if any(not value.strip() for value in (self.primary_action, self.rationale)):
            raise ValueError("추천과 근거는 공백일 수 없습니다.")
        if self.alternative_action is not None:
            if not self.alternative_action.strip() or self.alternative_action.strip() == self.primary_action.strip():
                raise ValueError("대안은 주 추천과 다른 유효한 선택이어야 합니다.")
        if (self.recommendation_kind == "tradeoff") != (self.alternative_action is not None):
            raise ValueError("tradeoff만 주 추천과 대안을 함께 가집니다.")
        if self.recommendation_kind == "recover_then_reassess" and self.reassess_after_minutes is None:
            raise ValueError("회복 후 재평가에는 재평가 시간이 필요합니다.")
        return self


class RecommendationContext(BaseModel):
    """전체 history 대신 조회 범위와 실제 전달한 제한된 스냅샷을 기록합니다."""

    model_config = ConfigDict(extra="forbid")
    as_of: datetime
    state_window_minutes: int = 120
    recent_states: dict[str, Any] = Field(default_factory=dict)
    schedules: list[dict[str, Any]] = Field(default_factory=list, max_length=3)
    dream_goals: list[dict[str, Any]] = Field(default_factory=list, max_length=3)
    daily_life: list[dict[str, Any]] = Field(default_factory=list, max_length=3)
    places: list[dict[str, Any]] = Field(default_factory=list, max_length=4)


class RecommendationResponse(RecommendationArguments):
    """추천 이력은 원문 Message와 연결되며 사용자 상태를 변경하지 않습니다."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")
    id: UUID
    user_id: UUID
    conversation_id: UUID | None
    message_id: UUID | None
    agent_action_id: UUID
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
