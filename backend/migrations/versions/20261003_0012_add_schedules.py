"""확인된 내부 일정 테이블을 추가합니다.

Revision ID: 20261003_0012
Revises: 20261002_0011
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261003_0012"
down_revision = "20261002_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """기존 테이블과 원문을 변경하지 않고 일정 테이블 하나를 생성합니다."""
    op.create_table(
        "schedules",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(30), server_default=sa.text("'orchestrator'"), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_schedules_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_schedules_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_schedules_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_schedules_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_schedules"),
        sa.UniqueConstraint("agent_action_id", name="uq_schedules_agent_action_id"),
        sa.CheckConstraint("end_at IS NULL OR end_at > start_at", name="ck_schedules_end_after_start"),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_schedules_title_not_blank"),
    )
    op.create_index("ix_schedules_user_id_start_at_id", "schedules", ["user_id", "start_at", "id"])


def downgrade() -> None:
    """일정 데이터가 삭제되므로 운영 DB에서 downgrade를 실행하지 않습니다."""
    op.drop_index("ix_schedules_user_id_start_at_id", table_name="schedules")
    op.drop_table("schedules")
