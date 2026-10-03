"""사용자 발화 기반 인지 상태 해석을 Emotion과 분리해 저장합니다."""

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class CognitiveStateEvent(TimestampMixin, Base):
    """미언급 축에는 0 기본값을 두지 않고 NULL을 사용합니다."""

    __tablename__ = "cognitive_state_events"
    __table_args__ = (
        UniqueConstraint("agent_action_id", name="uq_cognitive_state_events_agent_action_id"),
        # PostgreSQL의 NaN/무한대도 0..1 범위를 만족하지 않아 거부됩니다.
        CheckConstraint(
            "(focus IS NULL OR (focus >= 0 AND focus <= 1)) AND "
            "(mental_load IS NULL OR (mental_load >= 0 AND mental_load <= 1)) AND "
            "(motivation IS NULL OR (motivation >= 0 AND motivation <= 1)) AND "
            "(uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 1)) AND "
            "(clarity IS NULL OR (clarity >= 0 AND clarity <= 1))",
            name="ck_cognitive_state_events_axis_range",
        ),
        CheckConstraint(
            "focus IS NOT NULL OR mental_load IS NOT NULL OR motivation IS NOT NULL OR "
            "uncertainty IS NOT NULL OR clarity IS NOT NULL",
            name="ck_cognitive_state_events_has_axis",
        ),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_cognitive_state_events_confidence_range"),
        Index("ix_cognitive_state_events_user_id_created_at_id", "user_id", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=True)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    focus: Mapped[float | None] = mapped_column(Float, nullable=True)
    mental_load: Mapped[float | None] = mapped_column(Float, nullable=True)
    motivation: Mapped[float | None] = mapped_column(Float, nullable=True)
    uncertainty: Mapped[float | None] = mapped_column(Float, nullable=True)
    clarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'orchestrator'"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
