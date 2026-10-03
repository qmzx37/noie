"""사용자 발화 기반 신체 상태 해석을 Emotion과 분리해 저장합니다."""

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class BodyStateEvent(TimestampMixin, Base):
    """미언급 축에는 0 기본값을 두지 않고 NULL을 사용합니다."""

    __tablename__ = "body_state_events"
    __table_args__ = (
        UniqueConstraint("agent_action_id", name="uq_body_state_events_agent_action_id"),
        # PostgreSQL의 NaN/무한대도 0..1 범위를 만족하지 않아 거부됩니다.
        CheckConstraint(
            "(fatigue IS NULL OR (fatigue >= 0 AND fatigue <= 1)) AND "
            "(sleepiness IS NULL OR (sleepiness >= 0 AND sleepiness <= 1)) AND "
            "(energy IS NULL OR (energy >= 0 AND energy <= 1)) AND "
            "(hunger IS NULL OR (hunger >= 0 AND hunger <= 1)) AND "
            "(physical_tension IS NULL OR (physical_tension >= 0 AND physical_tension <= 1)) AND "
            "(discomfort IS NULL OR (discomfort >= 0 AND discomfort <= 1))",
            name="ck_body_state_events_axis_range",
        ),
        CheckConstraint(
            "fatigue IS NOT NULL OR sleepiness IS NOT NULL OR energy IS NOT NULL OR "
            "hunger IS NOT NULL OR physical_tension IS NOT NULL OR discomfort IS NOT NULL",
            name="ck_body_state_events_has_axis",
        ),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_body_state_events_confidence_range"),
        Index("ix_body_state_events_user_id_created_at_id", "user_id", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=True)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    fatigue: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleepiness: Mapped[float | None] = mapped_column(Float, nullable=True)
    energy: Mapped[float | None] = mapped_column(Float, nullable=True)
    hunger: Mapped[float | None] = mapped_column(Float, nullable=True)
    physical_tension: Mapped[float | None] = mapped_column(Float, nullable=True)
    discomfort: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'orchestrator'"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
