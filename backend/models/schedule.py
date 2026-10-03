"""사용자가 확인한 미래 일정을 원문 evidence와 분리해 저장합니다."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class Schedule(TimestampMixin, Base):
    """같은 Agent Action에서 생성된 일정은 최대 한 개입니다."""

    __tablename__ = "schedules"
    __table_args__ = (
        UniqueConstraint("agent_action_id", name="uq_schedules_agent_action_id"),
        CheckConstraint("end_at IS NULL OR end_at > start_at", name="ck_schedules_end_after_start"),
        CheckConstraint("length(trim(title)) > 0", name="ck_schedules_title_not_blank"),
        Index("ix_schedules_user_id_start_at_id", "user_id", "start_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=True)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'orchestrator'"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
