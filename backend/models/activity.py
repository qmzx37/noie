"""원문 Message에 연결된 사용자 보고 활동입니다. 추론/패턴/자동 병합은 없습니다."""

import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, String, Time, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class Activity(TimestampMixin, Base):
    """동일 Message/index는 한 번만 저장하며 다른 요청의 같은 문장은 별도 경험입니다."""

    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("message_id", "record_index", name="uq_activities_message_record"),
        CheckConstraint("record_index BETWEEN 0 AND 15", name="ck_activities_record_index"),
        CheckConstraint("status IN ('performed','ongoing')", name="ck_activities_status"),
        CheckConstraint("length(trim(action)) > 0 AND length(action) <= 500", name="ck_activities_action"),
        CheckConstraint("duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 525600", name="ck_activities_duration"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="ck_activities_confidence"),
        CheckConstraint("status != 'ongoing' OR end_time IS NULL", name="ck_activities_ongoing"),
        Index("ix_activities_user_observed_id", "user_id", "observed_at", "id"),
        Index("ix_activities_conversation_id", "conversation_id"),
        Index("ix_activities_agent_action_id", "agent_action_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=False)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    record_index: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time(timezone=False), nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time(timezone=False), nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
