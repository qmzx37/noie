"""memory_extractions 추적 테이블을 추가합니다.

Revision ID: 20260930_0005
Revises: 20260930_0004
Create Date: 2026-09-30
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260930_0005"
down_revision: str | None = "20260930_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """기존 message/memory를 변경하지 않고 추출 실행 이력만 추가합니다."""

    op.create_table(
        "memory_extractions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("memory_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("extractor_version", sa.String(length=50), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'processing'"),
            nullable=False,
        ),
        sa.Column("should_remember", sa.Boolean(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('processing', 'completed', 'failed')",
            name="ck_memory_extractions_status",
        ),
        sa.ForeignKeyConstraint(
            ["memory_id"],
            ["memories.id"],
            name="fk_memory_extractions_memory_id_memories",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            name="fk_memory_extractions_message_id_messages",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_memory_extractions"),
        sa.UniqueConstraint(
            "message_id",
            "extractor_version",
            name="uq_memory_extractions_message_id_extractor_version",
        ),
    )
    op.create_index(
        "ix_memory_extractions_memory_id",
        "memory_extractions",
        ["memory_id"],
    )
    op.create_index(
        "ix_memory_extractions_message_id",
        "memory_extractions",
        ["message_id"],
    )


def downgrade() -> None:
    """추출 이력만 삭제하며 원본 message와 생성된 memory는 유지합니다."""

    op.drop_index(
        "ix_memory_extractions_message_id",
        table_name="memory_extractions",
    )
    op.drop_index(
        "ix_memory_extractions_memory_id",
        table_name="memory_extractions",
    )
    op.drop_table("memory_extractions")
