"""Memory 대체 관계와 reconciliation 감사 필드를 추가합니다.

Revision ID: 20260930_0006
Revises: 20260930_0005
Create Date: 2026-09-30
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260930_0006"
down_revision: str | None = "20260930_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """기존 행과 호환되도록 새 필드를 모두 nullable로 추가합니다."""

    op.add_column(
        "memories",
        sa.Column(
            "supersedes_memory_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_memories_supersedes_memory_id_memories",
        "memories",
        "memories",
        ["supersedes_memory_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_memories_supersedes_memory_id",
        "memories",
        ["supersedes_memory_id"],
    )

    op.add_column(
        "memory_extractions",
        sa.Column("reconciliation_action", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "memory_extractions",
        sa.Column(
            "matched_memory_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "memory_extractions",
        sa.Column("reconciliation_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "memory_extractions",
        sa.Column("reconciler_version", sa.String(length=50), nullable=True),
    )
    op.create_check_constraint(
        "ck_memory_extractions_reconciliation_action",
        "memory_extractions",
        "reconciliation_action IS NULL OR reconciliation_action IN ('new', 'reinforce', 'supersede')",
    )
    op.create_foreign_key(
        "fk_memory_extractions_matched_memory_id_memories",
        "memory_extractions",
        "memories",
        ["matched_memory_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_memory_extractions_matched_memory_id",
        "memory_extractions",
        ["matched_memory_id"],
    )


def downgrade() -> None:
    """조정 감사와 대체 연결 의미가 손실되므로 운영 DB에서는 신중해야 합니다."""

    op.drop_index(
        "ix_memory_extractions_matched_memory_id",
        table_name="memory_extractions",
    )
    op.drop_constraint(
        "fk_memory_extractions_matched_memory_id_memories",
        "memory_extractions",
        type_="foreignkey",
    )
    op.drop_constraint(
        "ck_memory_extractions_reconciliation_action",
        "memory_extractions",
        type_="check",
    )
    op.drop_column("memory_extractions", "reconciler_version")
    op.drop_column("memory_extractions", "reconciliation_reason")
    op.drop_column("memory_extractions", "matched_memory_id")
    op.drop_column("memory_extractions", "reconciliation_action")

    op.drop_constraint(
        "uq_memories_supersedes_memory_id",
        "memories",
        type_="unique",
    )
    op.drop_constraint(
        "fk_memories_supersedes_memory_id_memories",
        "memories",
        type_="foreignkey",
    )
    op.drop_column("memories", "supersedes_memory_id")
