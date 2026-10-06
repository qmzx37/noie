"""원문 없이 접근 사건만 append하는 감사 기록입니다. 수정/삭제 API는 없습니다."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class AdminAuditLog(Base):
    """대상 미존재 사건과 미래 계정 삭제 후에도 기록을 남기도록 UUID는 역사적 참조입니다."""

    __tablename__ = "admin_audit_logs"
    __table_args__ = (
        CheckConstraint("actor_kind IN ('user', 'operator')", name="ck_admin_audit_logs_actor_kind"),
        CheckConstraint("outcome IN ('success', 'denied', 'not_found', 'failed')", name="ck_admin_audit_logs_outcome"),
        # 0020은 계정 삭제 사건만 추가합니다. 사용자 원문이나 외부 identity는 감사에 넣지 않습니다.
        CheckConstraint("action IN ('admin_summary.read', 'break_glass.create', 'break_glass.revoke', 'memory.break_glass_read', 'conversation.break_glass_read', 'audit_log.read', 'admin_grant.provision', 'admin_grant.revoke', 'owner.memory.read', 'owner.conversation.read', 'owner.record.read', 'account.delete.request', 'account.delete.purge')", name="ck_admin_audit_logs_action"),
        CheckConstraint("reason_code IS NULL OR reason_code IN ('user_support_request', 'security_incident', 'account_recovery', 'other')", name="ck_admin_audit_logs_reason"),
        Index("ix_admin_audit_logs_created_at_id", "created_at", "id"),
        Index("ix_admin_audit_logs_actor_created_at", "actor_user_id", "created_at"),
        Index("ix_admin_audit_logs_target_created_at", "target_user_id", "created_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    outcome: Mapped[str] = mapped_column(String(12), nullable=False)
    reason_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    case_reference: Mapped[str | None] = mapped_column(String(17), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
