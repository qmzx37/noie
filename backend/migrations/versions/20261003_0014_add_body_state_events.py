"""원문과 감정에서 분리된 nullable 신체 상태 6축 테이블을 추가합니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261003_0014"
down_revision = "20261003_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """기존 데이터는 변경하지 않고 Body State 테이블만 추가합니다."""
    op.create_table(
        "body_state_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fatigue", sa.Float(), nullable=True),
        sa.Column("sleepiness", sa.Float(), nullable=True),
        sa.Column("energy", sa.Float(), nullable=True),
        sa.Column("hunger", sa.Float(), nullable=True),
        sa.Column("physical_tension", sa.Float(), nullable=True),
        sa.Column("discomfort", sa.Float(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(30), server_default=sa.text("'orchestrator'"), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_body_state_events_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_body_state_events_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_body_state_events_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_body_state_events_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_body_state_events"),
        sa.UniqueConstraint("agent_action_id", name="uq_body_state_events_agent_action_id"),
        sa.CheckConstraint(
            "(fatigue IS NULL OR (fatigue >= 0 AND fatigue <= 1)) AND "
            "(sleepiness IS NULL OR (sleepiness >= 0 AND sleepiness <= 1)) AND "
            "(energy IS NULL OR (energy >= 0 AND energy <= 1)) AND "
            "(hunger IS NULL OR (hunger >= 0 AND hunger <= 1)) AND "
            "(physical_tension IS NULL OR (physical_tension >= 0 AND physical_tension <= 1)) AND "
            "(discomfort IS NULL OR (discomfort >= 0 AND discomfort <= 1))",
            name="ck_body_state_events_axis_range",
        ),
        sa.CheckConstraint(
            "fatigue IS NOT NULL OR sleepiness IS NOT NULL OR energy IS NOT NULL OR "
            "hunger IS NOT NULL OR physical_tension IS NOT NULL OR discomfort IS NOT NULL",
            name="ck_body_state_events_has_axis",
        ),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_body_state_events_confidence_range"),
    )
    op.create_index("ix_body_state_events_user_id_created_at_id", "body_state_events", ["user_id", "created_at", "id"])


def downgrade() -> None:
    """Body 기록을 삭제하므로 실제 데이터가 있는 DB에서는 실행하지 않습니다."""
    op.drop_index("ix_body_state_events_user_id_created_at_id", table_name="body_state_events")
    op.drop_table("body_state_events")
