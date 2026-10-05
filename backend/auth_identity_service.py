"""검증된 외부 신원을 기존 local user에 읽기 전용으로 매핑합니다. 자동 연결/생성은 없습니다."""

from sqlalchemy import select
from auth_context import AuthPrincipal, VerifiedAuthIdentity
from database import SessionLocal
from models.auth_identity import AuthIdentity
from models.user import User


class IdentityMappingError(Exception):
    """고정된 내부 실패 코드만 담고 provider subject/DB 상세는 노출하지 않습니다."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def resolve_identity_principal(identity: VerifiedAuthIdentity) -> AuthPrincipal:
    """유일한 provider/subject 연결과 활성 사용자 확인 후에만 Principal을 반환합니다."""
    if not isinstance(identity, VerifiedAuthIdentity):
        raise IdentityMappingError("INVALID_VERIFIED_IDENTITY")
    if SessionLocal is None:
        raise IdentityMappingError("AUTH_DATABASE_UNAVAILABLE")
    try:
        with SessionLocal() as db:
            mapping = db.scalar(select(AuthIdentity).where(
                AuthIdentity.provider == identity.provider, AuthIdentity.subject == identity.subject,
            ))
            if mapping is None:
                raise IdentityMappingError("UNMAPPED_AUTH_IDENTITY")
            owner = db.scalar(select(User.id).where(User.id == mapping.user_id, User.deleted_at.is_(None)))
            if owner is None:
                raise IdentityMappingError("INACTIVE_AUTH_USER")
            return AuthPrincipal(owner)
    except IdentityMappingError:
        raise
    except Exception:
        # 세션은 context manager로 close/rollback하며 실패를 dev-user로 대체하지 않습니다.
        raise IdentityMappingError("AUTH_DATABASE_UNAVAILABLE") from None
