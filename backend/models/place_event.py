"""원본 Message와 분리된 장소 사실/선호 해석을 보존합니다."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class PlaceEvent(TimestampMixin, Base):
    """같은 Action의 재실행은 UNIQUE 제약으로 추가 기록을 만들지 않습니다."""

    __tablename__ = "place_events"
    __table_args__ = (
        UniqueConstraint("agent_action_id", name="uq_place_events_agent_action_id"),
        CheckConstraint("kind IN ('visit', 'context', 'preference')", name="ck_place_events_kind"),
        # SQL NULL의 삼치 논리를 피하도록 선호 분기에서 NOT NULL을 명시합니다.
        CheckConstraint("(kind = 'preference' AND preference IS NOT NULL AND preference IN ('like', 'dislike')) OR (kind IN ('visit', 'context') AND preference IS NULL)", name="ck_place_events_preference"),
        CheckConstraint("length(trim(place_name)) > 0", name="ck_place_events_place_name_not_blank"),
        Index("ix_place_events_user_id_created_at_id", "user_id", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="RESTRICT"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="RESTRICT"), nullable=True)
    agent_action_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_actions.id", ondelete="RESTRICT"), nullable=False)
    place_name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    preference: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 불명확한 시각은 NULL로 보존하고 기록 생성 시각과 구분합니다.
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'orchestrator'"))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
