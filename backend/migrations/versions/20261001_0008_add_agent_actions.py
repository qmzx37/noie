"""agent action 계획과 confirmation 상태 테이블을 추가합니다.

Revision ID: 20261001_0008
Revises: 20261001_0007
Create Date: 2026-10-01
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20261001_0008"
down_revision: str | None = "20261001_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tool_name", sa.String(length=100), nullable=True),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("intent", sa.String(length=100), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("requires_confirmation", sa.Boolean(), nullable=False),
        sa.Column("execution_order", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("confirmation_status", sa.String(length=20), nullable=False),
        sa.Column("confirmation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('planned', 'pending_confirmation', 'ready', 'needs_review', 'not_implemented', 'processing', 'completed', 'failed', 'cancelled', 'rejected')", name="ck_agent_actions_status"),
        sa.CheckConstraint("mode IN ('record', 'suggest', 'execute')", name="ck_agent_actions_mode"),
        sa.CheckConstraint("confirmation_status IN ('not_required', 'pending', 'confirmed', 'rejected')", name="ck_agent_actions_confirmation_status"),
        sa.CheckConstraint("confidence >= 0.0 AND confidence <= 1.0", name="ck_agent_actions_confidence_range"),
        sa.CheckConstraint("attempt_count >= 0", name="ck_agent_actions_attempt_count_nonnegative"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_agent_actions_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_agent_actions_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_agent_actions_message_id_messages", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_agent_actions"),
        sa.UniqueConstraint("action_id", name="uq_agent_actions_action_id"),
        sa.UniqueConstraint("idempotency_key", name="uq_agent_actions_idempotency_key"),
        sa.UniqueConstraint("confirmation_id", name="uq_agent_actions_confirmation_id"),
    )
    op.create_index("ix_agent_actions_user_id_status_created_at", "agent_actions", ["user_id", "status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_actions_user_id_status_created_at", table_name="agent_actions")
    op.drop_table("agent_actions")
