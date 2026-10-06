"""한 관리자/대상/읽기 scope에 고정된 짧은 비상 접근 허가입니다."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class AdminBreakGlassSession(Base):
    """UUID를 아는 것만으로 권한이 되지 않으며 사용 시 grant를 재검증합니다."""

    __tablename__ = "admin_break_glass_sessions"
    __table_args__ = (
        CheckConstraint("scope IN ('memory_read', 'conversation_read')", name="ck_admin_break_glass_sessions_scope"),
        CheckConstraint("reason_code IN ('user_support_request', 'security_incident', 'account_recovery', 'other')", name="ck_admin_break_glass_sessions_reason"),
        CheckConstraint("expires_at > created_at", name="ck_admin_break_glass_sessions_expiry"),
        Index("ix_admin_break_glass_sessions_admin_user_id", "admin_user_id"),
        Index("ix_admin_break_glass_sessions_target_user_id", "target_user_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    admin_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    target_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    scope: Mapped[str] = mapped_column(String(30), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(30), nullable=False)
    # 자유 텍스트가 아닌 CASE-숫자 형식만 service에서 허용합니다.
    case_reference: Mapped[str | None] = mapped_column(String(17), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
