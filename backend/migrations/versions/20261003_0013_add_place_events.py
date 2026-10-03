"""Place 해석을 원문과 분리하여 저장하는 테이블 하나를 추가합니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261003_0013"
down_revision = "20261003_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """기존 원문/Memory/도메인 테이블을 변경하지 않습니다."""
    op.create_table(
        "place_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("place_name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("preference", sa.String(20), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(30), server_default=sa.text("'orchestrator'"), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_place_events_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_place_events_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_place_events_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_place_events_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_place_events"),
        sa.UniqueConstraint("agent_action_id", name="uq_place_events_agent_action_id"),
        sa.CheckConstraint("kind IN ('visit', 'context', 'preference')", name="ck_place_events_kind"),
        sa.CheckConstraint("(kind = 'preference' AND preference IS NOT NULL AND preference IN ('like', 'dislike')) OR (kind IN ('visit', 'context') AND preference IS NULL)", name="ck_place_events_preference"),
        sa.CheckConstraint("length(trim(place_name)) > 0", name="ck_place_events_place_name_not_blank"),
    )
    op.create_index("ix_place_events_user_id_created_at_id", "place_events", ["user_id", "created_at", "id"])


def downgrade() -> None:
    """Place 기록이 삭제되므로 실제 데이터가 있는 DB에서는 실행하지 않습니다."""
    op.drop_index("ix_place_events_user_id_created_at_id", table_name="place_events")
    op.drop_table("place_events")
