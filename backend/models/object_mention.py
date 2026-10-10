"""A verified source mention, not a resolved real-world identity."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import SoftDeleteMixin, TimestampMixin


class ObjectMention(SoftDeleteMixin, TimestampMixin, Base):
    __tablename__ = "object_mentions"
    __table_args__ = (
        UniqueConstraint("agent_action_id", name="uq_object_mentions_action"),
        UniqueConstraint("supersedes_mention_id", name="uq_object_mentions_supersedes"),
        CheckConstraint("kind IN ('person','place','thing','project')", name="ck_object_mentions_kind"),
        CheckConstraint("length(trim(label)) > 0 AND length(label) <= 500", name="ck_object_mentions_label"),
        CheckConstraint("source_start >= 0 AND source_end > source_start AND length(label) = source_end - source_start", name="ck_object_mentions_span"),
        CheckConstraint("kind_basis = 'user_selected'", name="ck_object_mentions_basis"),
        CheckConstraint("identity_status = 'unresolved'", name="ck_object_mentions_identity"),
        CheckConstraint("status IN ('active','superseded')", name="ck_object_mentions_status"),
        CheckConstraint("supersedes_mention_id IS NULL OR supersedes_mention_id != id", name="ck_object_mentions_not_self"),
        Index("ix_object_mentions_user_created_id", "user_id", "created_at", "id"),
        Index("ix_object_mentions_activity_id", "activity_id"),
        Index("ix_object_mentions_message_id", "message_id"),
        Index("ix_object_mentions_conversation_id", "conversation_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    activity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("activities.id", ondelete="RESTRICT"), nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=False)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(500), nullable=False)
    source_start: Mapped[int] = mapped_column(Integer, nullable=False)
    source_end: Mapped[int] = mapped_column(Integer, nullable=False)
    kind_basis: Mapped[str] = mapped_column(String(20), nullable=False, default="user_selected", server_default=text("'user_selected'"))
    identity_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unresolved", server_default=text("'unresolved'"))
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default=text("'active'"))
    supersedes_mention_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("object_mentions.id", ondelete="RESTRICT"), nullable=True)
