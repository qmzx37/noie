"""관리자 grant/비상 읽기 허가/감사 테이블만 추가합니다. 기존 원문과 Memory는 변경하지 않습니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261006_0019"
down_revision = "20261005_0018"
branch_labels = None
depends_on = None


def _id():
    """새 보안 테이블도 기존 PostgreSQL UUID 기본값 정책을 유지합니다."""
    return sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()"))


def _uuid(name, nullable=False):
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def _time(name, nullable=False, default=False):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable,
                     server_default=sa.text("now()") if default else None)


def upgrade():
    """데이터를 이동/삭제하지 않고 constraint와 조회용 index를 함께 생성합니다."""
    op.create_table("admin_grants", _id(), _uuid("user_id"),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        _time("created_at", default=True), _time("revoked_at", nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_admin_grants"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_admin_grants_user_id_users", ondelete="RESTRICT"),
        sa.UniqueConstraint("user_id", "role", name="uq_admin_grants_user_role"),
        sa.CheckConstraint("role IN ('owner', 'security_admin', 'support_admin')", name="ck_admin_grants_role"),
        sa.CheckConstraint("(is_active AND revoked_at IS NULL) OR (NOT is_active AND revoked_at IS NOT NULL)", name="ck_admin_grants_revocation"))
    op.create_table("admin_break_glass_sessions", _id(), _uuid("admin_user_id"), _uuid("target_user_id"),
        sa.Column("scope", sa.String(30), nullable=False),
        sa.Column("reason_code", sa.String(30), nullable=False),
        sa.Column("case_reference", sa.String(17), nullable=True),
        _time("created_at", default=True), _time("expires_at"), _time("revoked_at", nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_admin_break_glass_sessions"),
        sa.ForeignKeyConstraint(["admin_user_id"], ["users.id"], name="fk_admin_break_glass_sessions_admin_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], name="fk_admin_break_glass_sessions_target_user_id_users", ondelete="RESTRICT"),
        sa.CheckConstraint("scope IN ('memory_read', 'conversation_read')", name="ck_admin_break_glass_sessions_scope"),
        sa.CheckConstraint("reason_code IN ('user_support_request', 'security_incident', 'account_recovery', 'other')", name="ck_admin_break_glass_sessions_reason"),
        sa.CheckConstraint("expires_at > created_at", name="ck_admin_break_glass_sessions_expiry"))
    op.create_index("ix_admin_break_glass_sessions_admin_user_id", "admin_break_glass_sessions", ["admin_user_id"])
    op.create_index("ix_admin_break_glass_sessions_target_user_id", "admin_break_glass_sessions", ["target_user_id"])
    op.create_table("admin_audit_logs", _id(), _uuid("actor_user_id", nullable=True),
        sa.Column("actor_kind", sa.String(10), nullable=False), _uuid("target_user_id", nullable=True),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("resource_type", sa.String(30), nullable=True), _uuid("resource_id", nullable=True),
        sa.Column("outcome", sa.String(12), nullable=False),
        sa.Column("reason_code", sa.String(30), nullable=True),
        sa.Column("case_reference", sa.String(17), nullable=True), _time("created_at", default=True),
        sa.PrimaryKeyConstraint("id", name="pk_admin_audit_logs"),
        sa.CheckConstraint("actor_kind IN ('user', 'operator')", name="ck_admin_audit_logs_actor_kind"),
        sa.CheckConstraint("outcome IN ('success', 'denied', 'not_found', 'failed')", name="ck_admin_audit_logs_outcome"),
        sa.CheckConstraint("action IN ('admin_summary.read', 'break_glass.create', 'break_glass.revoke', 'memory.break_glass_read', 'conversation.break_glass_read', 'audit_log.read', 'admin_grant.provision', 'admin_grant.revoke', 'owner.memory.read', 'owner.conversation.read', 'owner.record.read')", name="ck_admin_audit_logs_action"),
        sa.CheckConstraint("reason_code IS NULL OR reason_code IN ('user_support_request', 'security_incident', 'account_recovery', 'other')", name="ck_admin_audit_logs_reason"))
    op.create_index("ix_admin_audit_logs_created_at_id", "admin_audit_logs", ["created_at", "id"])
    op.create_index("ix_admin_audit_logs_actor_created_at", "admin_audit_logs", ["actor_user_id", "created_at"])
    op.create_index("ix_admin_audit_logs_target_created_at", "admin_audit_logs", ["target_user_id", "created_at"])


def downgrade():
    """감사/허가 기록을 삭제하는 파괴적 rollback입니다. 운영 실행 전 보존/백업이 필요합니다."""
    op.drop_table("admin_audit_logs")
    op.drop_table("admin_break_glass_sessions")
    op.drop_table("admin_grants")
