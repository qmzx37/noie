"""daily_life_events를 추가합니다.

Revision ID: 20261002_0010
Revises: 20261002_0009
"""
from typing import Sequence
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20261002_0010"
down_revision: str | None = "20261002_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    op.create_table(
        "daily_life_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False), sa.Column("category", sa.String(50), nullable=True),
        sa.Column("source", sa.String(30), server_default=sa.text("'orchestrator'"), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_daily_life_events_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_daily_life_events_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_daily_life_events_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_daily_life_events_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_daily_life_events"),
        sa.UniqueConstraint("agent_action_id", name="uq_daily_life_events_agent_action_id"),
    )
    op.create_index("ix_daily_life_events_user_id_created_at", "daily_life_events", ["user_id", "created_at"])

def downgrade() -> None:
    op.drop_index("ix_daily_life_events_user_id_created_at", table_name="daily_life_events")
    op.drop_table("daily_life_events")
