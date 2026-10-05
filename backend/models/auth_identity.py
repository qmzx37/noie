"""외부 인증 신원과 NOIE 내부 사용자의 연결만 저장합니다. 원문/기억과 독립적입니다."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class AuthIdentity(Base):
    """이메일 없이 provider/subject로 연결하며 한 provider의 local user 연결을 유일하게 유지합니다."""

    __tablename__ = "auth_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_auth_identities_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_auth_identities_user_provider"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
        default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
