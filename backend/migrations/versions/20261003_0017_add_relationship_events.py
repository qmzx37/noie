"""기존 원문/기억을 변경하지 않고 사람 관련 append-only 근거 테이블만 추가합니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261003_0017"
down_revision = "20261003_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """한 action의 여러 근거를 record_index로 중복 없이 보존합니다."""
    op.create_table(
        "relationship_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("record_index", sa.Integer(), nullable=False),
        sa.Column("person_label", sa.String(120), nullable=False),
        sa.Column("identity_kind", sa.String(20), nullable=False),
        sa.Column("record_kind", sa.String(30), nullable=False),
        sa.Column("relationship_type", sa.String(20), nullable=True),
        sa.Column("meaning_relation_type", sa.String(20), nullable=True),
        sa.Column("relationship_statement", sa.Text(), nullable=False),
        sa.Column("temporal_scope", sa.String(10), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_relationship_events_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_relationship_events_conversation_id_conversations", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_relationship_events_message_id_messages", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], name="fk_relationship_events_agent_action_id_agent_actions", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name="pk_relationship_events"),
        sa.UniqueConstraint("agent_action_id", "record_index", name="uq_relationship_events_action_record"),
        sa.CheckConstraint("record_index BETWEEN 0 AND 7", name="ck_relationship_events_record_index"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_relationship_events_confidence"),
        sa.CheckConstraint("identity_kind IN ('named','temporary')", name="ck_relationship_events_identity"),
        sa.CheckConstraint("temporal_scope IN ('past','current')", name="ck_relationship_events_temporal"),
        sa.CheckConstraint("length(trim(person_label)) > 0 AND length(trim(relationship_statement)) > 0 AND length(relationship_statement) <= 500", name="ck_relationship_events_not_blank"),
        sa.CheckConstraint(
            "(record_kind = 'social_relation' AND relationship_type IS NOT NULL AND relationship_type IN ('family','friend','colleague','acquaintance','partner','other') AND meaning_relation_type IS NULL) OR "
            "(record_kind = 'meaning_relation' AND meaning_relation_type IS NOT NULL AND meaning_relation_type IN ('fan_of','role_model','inspired_by','follows','likes') AND relationship_type IS NULL) OR "
            "(record_kind IN ('relationship_state','observation') AND relationship_type IS NULL AND meaning_relation_type IS NULL)",
            name="ck_relationship_events_kind_fields",
        ),
    )
    op.create_index("ix_relationship_events_user_id_created_at_id", "relationship_events", ["user_id", "created_at", "id"])


def downgrade() -> None:
    """근거 데이터가 손실되므로 실데이터 DB에서는 downgrade하지 않습니다."""
    op.drop_index("ix_relationship_events_user_id_created_at_id", table_name="relationship_events")
    op.drop_table("relationship_events")
