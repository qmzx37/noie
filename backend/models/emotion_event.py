"""사용자의 한 시점 감정 관측값을 원문 Message와 분리해 저장합니다."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class EmotionEvent(TimestampMixin, Base):
    __tablename__ = "emotion_events"
    __table_args__ = (
        UniqueConstraint("agent_action_id", name="uq_emotion_events_agent_action_id"),
        CheckConstraint(
            "f >= 0 AND f <= 1 AND a >= 0 AND a <= 1 AND d >= 0 AND d <= 1 "
            "AND j >= 0 AND j <= 1 AND c >= 0 AND c <= 1 AND g >= 0 AND g <= 1 "
            "AND t >= 0 AND t <= 1 AND r >= 0 AND r <= 1",
            name="ck_emotion_events_axis_range",
        ),
        CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="ck_emotion_events_confidence_range",
        ),
        Index("ix_emotion_events_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=True
    )
    agent_action_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False
    )
    f: Mapped[float] = mapped_column(Float, nullable=False)
    a: Mapped[float] = mapped_column(Float, nullable=False)
    d: Mapped[float] = mapped_column(Float, nullable=False)
    j: Mapped[float] = mapped_column(Float, nullable=False)
    c: Mapped[float] = mapped_column(Float, nullable=False)
    g: Mapped[float] = mapped_column(Float, nullable=False)
    t: Mapped[float] = mapped_column(Float, nullable=False)
    r: Mapped[float] = mapped_column(Float, nullable=False)
    dominant_emotion: Mapped[str | None] = mapped_column(String(1), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'agent'"))
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
