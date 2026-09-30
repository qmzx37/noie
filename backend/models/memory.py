"""AI가 원문 메시지를 해석해 만든 기억과 원문 근거 모델입니다."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from models.common import SoftDeleteMixin, TimestampMixin

if TYPE_CHECKING:
    from models.message import Message
    from models.user import User


class Memory(SoftDeleteMixin, TimestampMixin, Base):
    """원문과 분리해서 보관하는 AI의 해석 결과입니다."""

    __tablename__ = "memories"
    __table_args__ = (
        CheckConstraint(
            "importance IS NULL OR (importance >= 0 AND importance <= 100)",
            name="ck_memories_importance_range",
        ),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)",
            name="ck_memories_confidence_range",
        ),
        CheckConstraint(
            "status IN ('active', 'superseded', 'invalid')",
            name="ck_memories_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # 새 Memory가 직접 대체한 이전 Memory를 가리킵니다. NULL UNIQUE는 여러 행에 허용됩니다.
    supersedes_memory_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("memories.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # PostgreSQL ENUM 대신 문자열을 사용해 새 기억 종류를 migration 없이 확장할 수 있습니다.
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    importance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="active",
        server_default=text("'active'"),
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    user: Mapped["User"] = relationship()
    supersedes: Mapped["Memory | None"] = relationship(
        remote_side="Memory.id",
        foreign_keys=[supersedes_memory_id],
    )
    evidence: Mapped[list["MemoryEvidence"]] = relationship(
        back_populates="memory",
        order_by="MemoryEvidence.created_at",
        passive_deletes="all",
    )


class MemoryEvidence(Base):
    """해석된 기억이 어떤 원문 메시지에서 나왔는지 연결합니다."""

    __tablename__ = "memory_evidence"
    __table_args__ = (
        UniqueConstraint(
            "memory_id",
            "message_id",
            name="uq_memory_evidence_memory_id_message_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("memories.id", ondelete="RESTRICT"),
        nullable=False,
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    memory: Mapped["Memory"] = relationship(back_populates="evidence")
    message: Mapped["Message"] = relationship()
