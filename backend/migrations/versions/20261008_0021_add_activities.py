"""Activity만 추가합니다. 기존 원문/Memory/domain 데이터는 수정하거나 backfill하지 않습니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261008_0021"
down_revision = "20261006_0020"
branch_labels = None
depends_on = None


def upgrade():
    """NULL 시각과 source Message별 UNIQUE를 가진 최소 PostgreSQL 구조입니다."""
    op.create_table("activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("record_index", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(500), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("activity_date", sa.Date(), nullable=True),
        sa.Column("start_time", sa.Time(timezone=False), nullable=True),
        sa.Column("end_time", sa.Time(timezone=False), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_activities"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT", name="fk_activities_user_id_users"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="RESTRICT", name="fk_activities_conversation_id_conversations"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="RESTRICT", name="fk_activities_message_id_messages"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], ondelete="RESTRICT", name="fk_activities_agent_action_id_agent_actions"),
        sa.UniqueConstraint("message_id", "record_index", name="uq_activities_message_record"),
        sa.CheckConstraint("record_index BETWEEN 0 AND 15", name="ck_activities_record_index"),
        sa.CheckConstraint("status IN ('performed','ongoing')", name="ck_activities_status"),
        sa.CheckConstraint("length(trim(action)) > 0 AND length(action) <= 500", name="ck_activities_action"),
        sa.CheckConstraint("duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 525600", name="ck_activities_duration"),
        sa.CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="ck_activities_confidence"),
        sa.CheckConstraint("status != 'ongoing' OR end_time IS NULL", name="ck_activities_ongoing"),
    )
    op.create_index("ix_activities_user_observed_id", "activities", ["user_id", "observed_at", "id"])
    op.create_index("ix_activities_conversation_id", "activities", ["conversation_id"])
    op.create_index("ix_activities_agent_action_id", "activities", ["agent_action_id"])


def downgrade():
    """Activity 데이터만 제거합니다. 실행 시 이 신규 기록은 파괴되며 원문/기존 domain은 보존됩니다."""
    op.drop_table("activities")
