"""수정하거나 요약하지 않은 원본 채팅 메시지 DB 모델입니다."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from models.conversation import Conversation
    from models.user import User


class Message(Base):
    """향후 재처리를 위해 원문 content를 그대로 보관합니다."""

    __tablename__ = "messages"
    __table_args__ = (
        # 대화 복원 쿼리: WHERE conversation_id = ? ORDER BY created_at, id
        Index(
            "ix_messages_conversation_id_created_at_id",
            "conversation_id",
            "created_at",
            "id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # 현재 앱에는 로그인이 없고 assistant/system 메시지도 저장하므로 nullable입니다.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        Enum("user", "assistant", "system", name="message_role"),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    user: Mapped["User | None"] = relationship(back_populates="messages")
