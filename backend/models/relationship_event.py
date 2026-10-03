"""사회관계 사실, 명시적 상태, 의미관계와 관찰을 append-only 근거로 분리합니다."""

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class RelationshipEvent(TimestampMixin, Base):
    """사람 master/현재 관계 resolver가 아니므로 label 기준 UNIQUE는 없습니다."""

    __tablename__ = "relationship_events"
    __table_args__ = (
        UniqueConstraint("agent_action_id", "record_index", name="uq_relationship_events_action_record"),
        CheckConstraint("record_index BETWEEN 0 AND 7", name="ck_relationship_events_record_index"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_relationship_events_confidence"),
        CheckConstraint("identity_kind IN ('named','temporary')", name="ck_relationship_events_identity"),
        CheckConstraint("temporal_scope IN ('past','current')", name="ck_relationship_events_temporal"),
        CheckConstraint("length(trim(person_label)) > 0 AND length(trim(relationship_statement)) > 0 AND length(relationship_statement) <= 500", name="ck_relationship_events_not_blank"),
        CheckConstraint(
            "(record_kind = 'social_relation' AND relationship_type IS NOT NULL AND relationship_type IN ('family','friend','colleague','acquaintance','partner','other') AND meaning_relation_type IS NULL) OR "
            "(record_kind = 'meaning_relation' AND meaning_relation_type IS NOT NULL AND meaning_relation_type IN ('fan_of','role_model','inspired_by','follows','likes') AND relationship_type IS NULL) OR "
            "(record_kind IN ('relationship_state','observation') AND relationship_type IS NULL AND meaning_relation_type IS NULL)",
            name="ck_relationship_events_kind_fields",
        ),
        Index("ix_relationship_events_user_id_created_at_id", "user_id", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=False)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    record_index: Mapped[int] = mapped_column(Integer, nullable=False)
    person_label: Mapped[str] = mapped_column(String(120), nullable=False)
    identity_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    record_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    relationship_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    meaning_relation_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    relationship_statement: Mapped[str] = mapped_column(Text, nullable=False)
    temporal_scope: Mapped[str] = mapped_column(String(10), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
