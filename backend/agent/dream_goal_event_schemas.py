"""Dream Goal 읽기 전용 응답 계약입니다."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DreamGoalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    conversation_id: UUID | None
    message_id: UUID | None
    agent_action_id: UUID
    statement: str
    kind: str
    source: str
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
