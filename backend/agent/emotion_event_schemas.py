"""Emotion Event 읽기 전용 API 응답 계약입니다."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EmotionEventResponse(BaseModel):
    """한 시점의 감정 관측과 원본 evidence 식별자만 반환합니다."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    conversation_id: UUID | None
    message_id: UUID | None
    agent_action_id: UUID
    F: float = Field(validation_alias="f")
    A: float = Field(validation_alias="a")
    D: float = Field(validation_alias="d")
    J: float = Field(validation_alias="j")
    C: float = Field(validation_alias="c")
    G: float = Field(validation_alias="g")
    T: float = Field(validation_alias="t")
    R: float = Field(validation_alias="r")
    dominant_emotion: str | None
    confidence: float
    source: str
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
