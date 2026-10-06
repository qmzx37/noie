"""JWT가 아닌 NOIE DB에 명시적으로 부여한 관리자 권한입니다."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class AdminGrant(Base):
    """동일 user/role은 한 행만 유지하고 철회 시 행을 삭제하지 않습니다."""

    __tablename__ = "admin_grants"
    __table_args__ = (
        UniqueConstraint("user_id", "role", name="uq_admin_grants_user_role"),
        CheckConstraint("role IN ('owner', 'security_admin', 'support_admin')", name="ck_admin_grants_role"),
        CheckConstraint("(is_active AND revoked_at IS NULL) OR (NOT is_active AND revoked_at IS NOT NULL)", name="ck_admin_grants_revocation"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
