"""Tool Gateway v0.1의 입력과 실행 계획 계약입니다."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from agent.schemas import ActionMode, AgentType
from agent.emotion_schemas import EmotionRecordArguments
from agent.daily_life_schemas import DailyTraceArguments
from agent.dream_goal_schemas import DreamGoalArguments
from agent.schedule_schemas import CreateScheduleArguments
from agent.place_schemas import RecordPlaceEventArguments


PlanStatus = Literal[
    "planned",
    "pending_confirmation",
    "ready",
    "needs_review",
    "rejected",
    "not_implemented",
    "processing",
    "completed",
    "failed",
    "cancelled",
]
ConfirmationStatus = Literal["not_required", "pending", "confirmed", "rejected"]


class GatewayAction(BaseModel):
    """Orchestrator 출력과 호환되지만 Gateway가 독립적으로 다시 검증합니다."""

    model_config = ConfigDict(extra="forbid")

    action_id: UUID | None = None
    type: AgentType
    intent: str = Field(min_length=1, max_length=100)
    mode: ActionMode
    reason: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    requires_confirmation: bool
    execution_order: int = Field(ge=1)
    arguments: EmotionRecordArguments | DailyTraceArguments | DreamGoalArguments | CreateScheduleArguments | RecordPlaceEventArguments | None = None

    @model_validator(mode="after")
    def validate_place_arguments(self) -> "GatewayAction":
        """Gateway 직접 호출에서도 Place의 type, mode, 인자를 재검증합니다."""
        if self.intent == "record_place_event":
            if self.type != "place" or self.mode != "record" or not isinstance(self.arguments, RecordPlaceEventArguments):
                raise ValueError("record_place_event의 type/mode/arguments가 올바르지 않습니다.")
        elif isinstance(self.arguments, RecordPlaceEventArguments):
            raise ValueError("Place arguments는 record_place_event에서만 사용합니다.")
        return self


class ToolPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actions: list[GatewayAction] = Field(default_factory=list, max_length=12)


class ToolExecutionPlan(BaseModel):
    """아직 실행되지 않은 정책 검증 결과입니다."""

    action_id: UUID
    action_type: AgentType
    intent: str
    tool_name: str | None
    mode: ActionMode
    status: PlanStatus
    confidence: float
    requires_confirmation: bool
    confirmation_status: ConfirmationStatus
    confirmation_id: UUID | None
    confirmed_at: datetime | None = None
    execution_order: int
    idempotency_key: str
    implemented: bool
    can_execute: bool = False
    policy_messages: list[str] = Field(default_factory=list)
    arguments: EmotionRecordArguments | DailyTraceArguments | DreamGoalArguments | CreateScheduleArguments | RecordPlaceEventArguments | None = None


class ToolPlanResponse(BaseModel):
    """부분 실패를 허용하는 순차 실행 계획 묶음입니다."""

    plans: list[ToolExecutionPlan]
    all_valid: bool
    execution_enabled: bool = False
