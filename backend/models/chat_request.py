"""채팅 요청의 중복 처리 방지와 완료 응답 재사용을 위한 모델입니다."""

from __future__ import annotations

from typing import Any
from uuid import UUID as UUIDValue

from sqlalchemy import CheckConstraint, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from models.common import TimestampMixin


class ChatRequestRecord(TimestampMixin, Base):
    """한 request_id의 처리 상태와 생성된 원본 메시지를 연결합니다."""

    __tablename__ = "chat_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('processing', 'completed', 'failed')",
            name="ck_chat_requests_status",
        ),
    )

    # request_id 자체가 전역 중복 방지 키이므로 별도 숫자 ID를 만들지 않습니다.
    request_id: Mapped[UUIDValue] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
    )
    conversation_id: Mapped[UUIDValue] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # 같은 request_id를 다른 본문에 재사용하는 실수를 감지하기 위한 SHA-256입니다.
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    user_message_id: Mapped[UUIDValue | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
    )
    assistant_message_id: Mapped[UUIDValue | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="processing",
        server_default=text("'processing'"),
    )
    response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
