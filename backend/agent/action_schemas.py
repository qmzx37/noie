"""Action persistence 및 confirmation API 계약입니다."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from agent.schemas import ActionMode, AgentType
from agent.tool_schemas import ConfirmationStatus, PlanStatus, ToolExecutionPlan


class PersistActionPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    conversation_id: UUID | None = None
    message_id: UUID | None = None
    plans: list[ToolExecutionPlan] = Field(min_length=1, max_length=12)


class ConfirmationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    confirmation_id: UUID


class ExecuteActionRequest(BaseModel):
    """개발용 execute API가 action 소유자를 검증하기 위한 요청입니다."""

    model_config = ConfigDict(extra="forbid")

    user_id: UUID


class AgentActionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    conversation_id: UUID | None
    message_id: UUID | None
    action_id: UUID
    tool_name: str | None
    action_type: AgentType
    intent: str
    mode: ActionMode
    status: PlanStatus
    confidence: float
    requires_confirmation: bool
    execution_order: int
    idempotency_key: str
    confirmation_status: ConfirmationStatus
    confirmation_id: UUID | None
    confirmed_at: datetime | None
    rejected_at: datetime | None
    processing_started_at: datetime | None
    lease_expires_at: datetime | None
    attempt_count: int
    result: dict[str, Any] | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    cancelled_at: datetime | None


class ExecuteActionResponse(BaseModel):
    """실행 결과와 재시도 가능 여부를 함께 반환합니다."""

    action: AgentActionResponse
    executor_called: bool
    fenced: bool
    can_retry: bool
