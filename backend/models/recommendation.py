"""제안의 추적 이력을 저장합니다. 수락/거절이나 실제 행동은 저장하지 않습니다."""

import uuid
from typing import Any
from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from database import Base
from models.common import TimestampMixin


class Recommendation(TimestampMixin, Base):
    """동일 Agent Action의 재시도는 최대 한 추천 이력만 생성합니다."""

    __tablename__ = "recommendations"
    __table_args__ = (
        UniqueConstraint("agent_action_id", name="uq_recommendations_agent_action_id"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_recommendations_confidence_range"),
        CheckConstraint("length(trim(primary_action)) > 0 AND length(trim(rationale)) > 0", name="ck_recommendations_not_blank"),
        CheckConstraint("recommendation_kind IN ('direct', 'two_step', 'recover_then_reassess', 'tradeoff')", name="ck_recommendations_kind"),
        CheckConstraint("(recommendation_kind = 'tradeoff' AND alternative_action IS NOT NULL AND length(trim(alternative_action)) > 0 AND trim(alternative_action) <> trim(primary_action)) OR (recommendation_kind <> 'tradeoff' AND alternative_action IS NULL)", name="ck_recommendations_alternative"),
        CheckConstraint("(reassess_after_minutes IS NULL OR reassess_after_minutes BETWEEN 1 AND 120) AND (recommendation_kind <> 'recover_then_reassess' OR reassess_after_minutes IS NOT NULL)", name="ck_recommendations_reassess"),
        Index("ix_recommendations_user_id_created_at_id", "user_id", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=True)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    primary_action: Mapped[str] = mapped_column(String(240), nullable=False)
    alternative_action: Mapped[str | None] = mapped_column(String(240), nullable=True)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    recommendation_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    reassess_after_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
