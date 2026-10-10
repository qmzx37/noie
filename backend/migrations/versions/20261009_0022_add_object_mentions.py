"""Add source mentions only; no identity resolution or existing-data backfill."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261009_0022"
down_revision = "20261008_0021"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("object_mentions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_action_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("label", sa.String(500), nullable=False),
        sa.Column("source_start", sa.Integer(), nullable=False),
        sa.Column("source_end", sa.Integer(), nullable=False),
        sa.Column("kind_basis", sa.String(20), server_default=sa.text("'user_selected'"), nullable=False),
        sa.Column("identity_status", sa.String(20), server_default=sa.text("'unresolved'"), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), server_default=sa.text("'active'"), nullable=False),
        sa.Column("supersedes_mention_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_object_mentions"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT", name="fk_object_mentions_user_id_users"),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="RESTRICT", name="fk_object_mentions_activity_id_activities"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="RESTRICT", name="fk_object_mentions_message_id_messages"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="RESTRICT", name="fk_object_mentions_conversation_id_conversations"),
        sa.ForeignKeyConstraint(["agent_action_id"], ["agent_actions.id"], ondelete="RESTRICT", name="fk_object_mentions_agent_action_id_agent_actions"),
        sa.ForeignKeyConstraint(["supersedes_mention_id"], ["object_mentions.id"], ondelete="RESTRICT", name="fk_object_mentions_supersedes_mention_id_object_mentions"),
        sa.UniqueConstraint("agent_action_id", name="uq_object_mentions_action"),
        sa.UniqueConstraint("supersedes_mention_id", name="uq_object_mentions_supersedes"),
        sa.CheckConstraint("kind IN ('person','place','thing','project')", name="ck_object_mentions_kind"),
        sa.CheckConstraint("length(trim(label)) > 0 AND length(label) <= 500", name="ck_object_mentions_label"),
        sa.CheckConstraint("source_start >= 0 AND source_end > source_start AND length(label) = source_end - source_start", name="ck_object_mentions_span"),
        sa.CheckConstraint("kind_basis = 'user_selected'", name="ck_object_mentions_basis"),
        sa.CheckConstraint("identity_status = 'unresolved'", name="ck_object_mentions_identity"),
        sa.CheckConstraint("status IN ('active','superseded')", name="ck_object_mentions_status"),
        sa.CheckConstraint("supersedes_mention_id IS NULL OR supersedes_mention_id != id", name="ck_object_mentions_not_self"),
    )
    op.create_index("ix_object_mentions_user_created_id", "object_mentions", ["user_id", "created_at", "id"])
    for field in ("activity_id", "message_id", "conversation_id"):
        op.create_index("ix_object_mentions_" + field, "object_mentions", [field])


def downgrade():
    """Destructive for mention records only; original messages/activities remain."""
    op.drop_table("object_mentions")
