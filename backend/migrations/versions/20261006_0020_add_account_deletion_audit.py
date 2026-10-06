"""계정 삭제 감사 action만 추가합니다. 기존 테이블/데이터와 0019는 변경하지 않습니다."""

from alembic import op

revision = "20261006_0020"
down_revision = "20261006_0019"
branch_labels = None
depends_on = None

OLD_ACTIONS = "'admin_summary.read', 'break_glass.create', 'break_glass.revoke', 'memory.break_glass_read', 'conversation.break_glass_read', 'audit_log.read', 'admin_grant.provision', 'admin_grant.revoke', 'owner.memory.read', 'owner.conversation.read', 'owner.record.read'"


def upgrade():
    """확장된 CHECK는 기존 감사 행을 모두 허용합니다."""
    op.drop_constraint("ck_admin_audit_logs_action", "admin_audit_logs", type_="check")
    op.create_check_constraint("ck_admin_audit_logs_action", "admin_audit_logs",
        "action IN (" + OLD_ACTIONS + ", 'account.delete.request', 'account.delete.purge')")


def downgrade():
    """삭제 audit가 있으면 거부합니다. 감사 행을 삭제해서 downgrade를 강행하지 않습니다."""
    op.drop_constraint("ck_admin_audit_logs_action", "admin_audit_logs", type_="check")
    op.create_check_constraint("ck_admin_audit_logs_action", "admin_audit_logs", "action IN (" + OLD_ACTIONS + ")")
