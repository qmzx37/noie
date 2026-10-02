"""record_emotion action payload와 emotion_events를 추가합니다.

Revision ID: 20261002_0009
Revises: 20261001_0008
Create Date: 2026-10-02
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20261002_0009"
down_revision: str | None = "20261001_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_actions", sa.Column("arguments", postgresql.JSONB(), nullable=True))
    op.create_table(
        "emotion_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("f", sa.Float(), nullable=False),
        sa.Column("a", sa.Float(), nullable=False),
        sa.Column("d", sa.Float(), nullable=False),
        sa.Column("j", sa.Float(), nullable=False),
        sa.Column("c", sa.Float(), nullable=False),
        sa.Column("g", sa.Float(), nullable=False),
        sa.Column("t", sa.Float(), nullable=False),
        sa.Column("r", sa.Float(), nullable=False),
        sa.Column("dominant_emotion", sa.String(length=1), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=30), server_default=sa.text("'agent'"), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("f >= 0 AND f <= 1 AND a >= 0 AND a <= 1 AND d >= 0 AND d <= 1 AND j >= 0 AND j <= 1 AND c >= 0 AND c <= 1 AND g >= 0 AND g <= 1 AND t >= 0 AND t <= 1 AND r >= 0 AND r <= 1", name="ck_emotion_events_axis_range"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_emotion_events_confidence_range"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_emotion_events_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_emotion_events_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_emotion_events_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_emotion_events_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_emotion_events"),
        sa.UniqueConstraint("agent_action_id", name="uq_emotion_events_agent_action_id"),
    )
    op.create_index("ix_emotion_events_user_id_created_at", "emotion_events", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_emotion_events_user_id_created_at", table_name="emotion_events")
    op.drop_table("emotion_events")
    op.drop_column("agent_actions", "arguments")
