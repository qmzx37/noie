"""Tool Gateway가 만든 action 계획과 승인 상태를 영구 저장합니다."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class AgentAction(TimestampMixin, Base):
    """실제 Tool 실행 전후의 단일 action 상태를 나타냅니다."""

    __tablename__ = "agent_actions"
    __table_args__ = (
        UniqueConstraint("action_id", name="uq_agent_actions_action_id"),
        UniqueConstraint("idempotency_key", name="uq_agent_actions_idempotency_key"),
        UniqueConstraint("confirmation_id", name="uq_agent_actions_confirmation_id"),
        CheckConstraint(
            "status IN ('planned', 'pending_confirmation', 'ready', 'needs_review', "
            "'not_implemented', 'processing', 'completed', 'failed', 'cancelled', 'rejected')",
            name="ck_agent_actions_status",
        ),
        CheckConstraint(
            "mode IN ('record', 'suggest', 'execute')",
            name="ck_agent_actions_mode",
        ),
        CheckConstraint(
            "confirmation_status IN ('not_required', 'pending', 'confirmed', 'rejected')",
            name="ck_agent_actions_confirmation_status",
        ),
        CheckConstraint(
            "confidence >= 0.0 AND confidence <= 1.0",
            name="ck_agent_actions_confidence_range",
        ),
        CheckConstraint("attempt_count >= 0", name="ck_agent_actions_attempt_count_nonnegative"),
        Index("ix_agent_actions_user_id_status_created_at", "user_id", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
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
    action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    intent: Mapped[str] = mapped_column(String(100), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, nullable=False)
    execution_order: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    confirmation_status: Mapped[str] = mapped_column(String(20), nullable=False)
    confirmation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    arguments: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # 외부 예외 전문이나 secret은 저장하지 않고 안전한 오류 종류만 허용합니다.
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
