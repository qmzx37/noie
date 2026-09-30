"""채팅 request_id 중복 방지 테이블을 추가합니다.

Revision ID: 20260930_0003
Revises: 20260930_0002
Create Date: 2026-09-30
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260930_0003"
down_revision: str | None = "20260930_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """기존 messages 데이터에 영향을 주지 않고 요청 추적 테이블을 추가합니다."""

    op.create_table(
        "chat_requests",
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("user_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("assistant_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'processing'"),
            nullable=False,
        ),
        sa.Column("response", postgresql.JSONB(), nullable=True),
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
            name="ck_chat_requests_status",
        ),
        sa.ForeignKeyConstraint(
            ["assistant_message_id"],
            ["messages.id"],
            name="fk_chat_requests_assistant_message_id_messages",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name="fk_chat_requests_conversation_id_conversations",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_message_id"],
            ["messages.id"],
            name="fk_chat_requests_user_message_id_messages",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("request_id", name="pk_chat_requests"),
        sa.UniqueConstraint(
            "assistant_message_id",
            name="uq_chat_requests_assistant_message_id",
        ),
        sa.UniqueConstraint(
            "user_message_id",
            name="uq_chat_requests_user_message_id",
        ),
    )
    op.create_index(
        "ix_chat_requests_conversation_id",
        "chat_requests",
        ["conversation_id"],
    )


def downgrade() -> None:
    """요청 추적 테이블만 제거하고 원본 messages는 유지합니다."""

    op.drop_index("ix_chat_requests_conversation_id", table_name="chat_requests")
    op.drop_table("chat_requests")
