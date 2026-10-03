"""추천 이력 테이블만 추가하고 기존 원문/기억/상태 데이터는 변경하지 않습니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261003_0016"
down_revision = "20261003_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """추천된 행동은 실행하지 않으며 추적 가능한 제안만 저장합니다."""
    op.create_table(
        "recommendations",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("primary_action", sa.String(240), nullable=False),
        sa.Column("alternative_action", sa.String(240), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("recommendation_kind", sa.String(30), nullable=False),
        sa.Column("reassess_after_minutes", sa.Integer(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_recommendations_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_recommendations_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_recommendations_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_recommendations_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_recommendations"),
        sa.UniqueConstraint("agent_action_id", name="uq_recommendations_agent_action_id"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_recommendations_confidence_range"),
        sa.CheckConstraint("length(trim(primary_action)) > 0 AND length(trim(rationale)) > 0", name="ck_recommendations_not_blank"),
        sa.CheckConstraint("recommendation_kind IN ('direct', 'two_step', 'recover_then_reassess', 'tradeoff')", name="ck_recommendations_kind"),
        sa.CheckConstraint("(recommendation_kind = 'tradeoff' AND alternative_action IS NOT NULL AND length(trim(alternative_action)) > 0 AND trim(alternative_action) <> trim(primary_action)) OR (recommendation_kind <> 'tradeoff' AND alternative_action IS NULL)", name="ck_recommendations_alternative"),
        sa.CheckConstraint("(reassess_after_minutes IS NULL OR reassess_after_minutes BETWEEN 1 AND 120) AND (recommendation_kind <> 'recover_then_reassess' OR reassess_after_minutes IS NOT NULL)", name="ck_recommendations_reassess"),
    )
    op.create_index("ix_recommendations_user_id_created_at_id", "recommendations", ["user_id", "created_at", "id"])


def downgrade() -> None:
    """추천 이력을 삭제하므로 실데이터가 있는 DB에서는 실행하지 않습니다."""
    op.drop_index("ix_recommendations_user_id_created_at_id", table_name="recommendations")
    op.drop_table("recommendations")
