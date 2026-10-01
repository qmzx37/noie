"""한 원문 메시지의 자동 Memory 추출 상태를 기록하는 모델입니다."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from models.common import TimestampMixin

if TYPE_CHECKING:
    from models.memory import Memory
    from models.message import Message


class MemoryExtraction(TimestampMixin, Base):
    """같은 extractor version이 같은 message를 한 번만 처리하도록 보장합니다."""

    __tablename__ = "memory_extractions"
    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "extractor_version",
            name="uq_memory_extractions_message_id_extractor_version",
        ),
        CheckConstraint(
            "status IN ('processing', 'completed', 'failed')",
            name="ck_memory_extractions_status",
        ),
        CheckConstraint(
            "reconciliation_action IS NULL OR reconciliation_action IN ('new', 'reinforce', 'supersede')",
            name="ck_memory_extractions_reconciliation_action",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_memory_extractions_attempt_count_nonnegative",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    memory_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("memories.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    extractor_version: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="processing",
        server_default=text("'processing'"),
    )
    should_remember: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reconciliation_action: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )
    matched_memory_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("memories.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    reconciliation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reconciler_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 외부 API의 세부 정보나 키를 넣지 않고 안전한 오류 종류만 저장합니다.
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # lease를 획득할 때마다 증가하며 오래된 worker의 결과 반영을 막는 fencing 값으로 사용합니다.
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=text("0"),
    )
    processing_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    message: Mapped["Message"] = relationship()
    memory: Mapped["Memory | None"] = relationship(foreign_keys=[memory_id])
    matched_memory: Mapped["Memory | None"] = relationship(
        foreign_keys=[matched_memory_id]
    )
