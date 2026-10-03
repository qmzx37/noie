"""원문과 감정에서 분리된 nullable 인지 상태 5축 테이블을 추가합니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261003_0015"
down_revision = "20261003_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """기존 데이터는 변경하지 않고 Cognitive State 테이블만 추가합니다."""
    op.create_table(
        "cognitive_state_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("focus", sa.Float(), nullable=True),
        sa.Column("mental_load", sa.Float(), nullable=True),
        sa.Column("motivation", sa.Float(), nullable=True),
        sa.Column("uncertainty", sa.Float(), nullable=True),
        sa.Column("clarity", sa.Float(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(30), server_default=sa.text("'orchestrator'"), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_cognitive_state_events_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_cognitive_state_events_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_cognitive_state_events_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_cognitive_state_events_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_cognitive_state_events"),
        sa.UniqueConstraint("agent_action_id", name="uq_cognitive_state_events_agent_action_id"),
        sa.CheckConstraint(
            "(focus IS NULL OR (focus >= 0 AND focus <= 1)) AND "
            "(mental_load IS NULL OR (mental_load >= 0 AND mental_load <= 1)) AND "
            "(motivation IS NULL OR (motivation >= 0 AND motivation <= 1)) AND "
            "(uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 1)) AND "
            "(clarity IS NULL OR (clarity >= 0 AND clarity <= 1))",
            name="ck_cognitive_state_events_axis_range",
        ),
        sa.CheckConstraint(
            "focus IS NOT NULL OR mental_load IS NOT NULL OR motivation IS NOT NULL OR "
            "uncertainty IS NOT NULL OR clarity IS NOT NULL",
            name="ck_cognitive_state_events_has_axis",
        ),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_cognitive_state_events_confidence_range"),
    )
    op.create_index("ix_cognitive_state_events_user_id_created_at_id", "cognitive_state_events", ["user_id", "created_at", "id"])


def downgrade() -> None:
    """Cognitive 기록을 삭제하므로 실제 데이터가 있는 DB에서는 실행하지 않습니다."""
    op.drop_index("ix_cognitive_state_events_user_id_created_at_id", table_name="cognitive_state_events")
    op.drop_table("cognitive_state_events")
