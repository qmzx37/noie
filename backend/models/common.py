"""여러 모델에서 함께 쓰는 컬럼 구성을 정의합니다."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    """생성/수정 시각을 timezone-aware timestamp로 저장합니다."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        # v0.1에서는 DB trigger 없이 SQLAlchemy ORM이 수정 시각을 관리합니다.
        onupdate=func.now(),
    )


class SoftDeleteMixin:
    """NULL은 활성 상태, 시간 값은 soft deleted 상태를 뜻합니다."""

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
