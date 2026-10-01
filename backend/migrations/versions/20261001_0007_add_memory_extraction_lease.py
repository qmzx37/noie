"""memory extraction에 timeout/retry lease 필드를 추가합니다.

Revision ID: 20261001_0007
Revises: 20260930_0006
Create Date: 2026-10-01
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20261001_0007"
down_revision: str | None = "20260930_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """기존 extraction 결과를 보존하면서 lease 운영 필드를 추가합니다."""

    op.add_column(
        "memory_extractions",
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "memory_extractions",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "memory_extractions",
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_memory_extractions_attempt_count_nonnegative",
        "memory_extractions",
        "attempt_count >= 0",
    )


def downgrade() -> None:
    """lease 운영 필드만 제거하며 Message/Memory/Evidence는 변경하지 않습니다."""

    op.drop_constraint(
        "ck_memory_extractions_attempt_count_nonnegative",
        "memory_extractions",
        type_="check",
    )
    op.drop_column("memory_extractions", "lease_expires_at")
    op.drop_column("memory_extractions", "processing_started_at")
    op.drop_column("memory_extractions", "attempt_count")
