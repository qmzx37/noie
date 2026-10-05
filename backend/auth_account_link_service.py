"""명시적 관리 작업에서만 인증 연결을 만듭니다. UUID 형식 확인은 계정 소유 증명이 아닙니다."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from models.auth_identity import AuthIdentity
from models.user import User


class AccountLinkError(Exception):
    """식별자/DB 상세 없이 고정 코드로 관리 작업 실패를 알립니다."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _existing_link(db, *, user_id: UUID, provider: str, subject: str):
    """외부 신원과 local user 양쪽의 유일성 충돌을 확인하며 기존 링크는 수정하지 않습니다."""
    external = db.scalar(select(AuthIdentity).where(
        AuthIdentity.provider == provider, AuthIdentity.subject == subject,
    ))
    if external is not None:
        if external.user_id != user_id:
            raise AccountLinkError("IDENTITY_ALREADY_LINKED")
        return external
    local = db.scalar(select(AuthIdentity).where(
        AuthIdentity.user_id == user_id, AuthIdentity.provider == provider,
    ))
    if local is not None:
        if local.subject != subject:
            raise AccountLinkError("USER_ALREADY_LINKED")
        return local
    return None


def link_auth_identity(db, *, user_id: UUID, provider: str, subject: str, dry_run: bool = False) -> AuthIdentity | None:
    """검증된 신원을 명시적으로 연결합니다. flush만 하며 commit/rollback은 호출자가 담당합니다."""
    if not isinstance(user_id, UUID) or user_id.int == 0 or provider != "supabase":
        raise AccountLinkError("INVALID_LINK_INPUT")
    try:
        if not isinstance(subject, str) or str(UUID(subject)) != subject or UUID(subject).int == 0:
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise AccountLinkError("INVALID_LINK_INPUT") from None

    statement = select(User.id).where(User.id == user_id, User.deleted_at.is_(None))
    if not dry_run:
        # 실제 쓰기 동안 같은 local user의 연결/삭제와 경쟁하지 않도록 짧게 잠급니다.
        statement = statement.with_for_update()
    if db.scalar(statement) is None:
        raise AccountLinkError("ACTIVE_LOCAL_USER_REQUIRED")
    existing = _existing_link(db, user_id=user_id, provider=provider, subject=subject)
    if existing is not None or dry_run:
        # dry-run에서 None은 생성 가능하다는 뜻이며 어떤 행도 추가하지 않습니다.
        return existing

    candidate = AuthIdentity(user_id=user_id, provider=provider, subject=subject)
    try:
        # 서로 다른 local user가 같은 subject를 동시에 연결해도 DB UNIQUE가 최종 차단합니다.
        with db.begin_nested():
            db.add(candidate)
            db.flush()
    except IntegrityError:
        # savepoint rollback 후 승자의 링크를 읽어 동일 링크면 재사용하고 충돌이면 거부합니다.
        existing = _existing_link(db, user_id=user_id, provider=provider, subject=subject)
        if existing is not None:
            return existing
        raise AccountLinkError("LINK_WRITE_FAILED") from None
    return candidate
