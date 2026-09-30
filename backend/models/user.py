"""사용자 DB 모델입니다."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from models.common import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from models.conversation import Conversation
    from models.message import Message


class User(SoftDeleteMixin, TimestampMixin, Base):
    """채팅과 대화를 소유하는 최소 사용자 레코드입니다."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    # 기존 initial migration의 사용자 행은 이름이 없을 수 있으므로 nullable입니다.
    # 2단계 POST /users API에서는 공백이 아닌 이름을 반드시 입력받습니다.
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # metadata는 SQLAlchemy가 내부에서 사용하는 이름이므로 Python에서는
    # metadata_로 접근하고, 실제 DB 컬럼명만 metadata로 유지합니다.
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="user",
        passive_deletes="all",
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="user",
        passive_deletes=True,
    )
