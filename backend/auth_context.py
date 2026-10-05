"""외부 provider와 독립된 인증 계약입니다. 클라이언트 UUID나 미검증 token은 신뢰하지 않습니다."""

import os
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Header, HTTPException, status


@dataclass(frozen=True)
class AuthPrincipal:
    """미래 verifier가 검증한 내부 사용자 UUID만 담는 불변 신원입니다."""

    user_id: UUID

    def __post_init__(self):
        # 타입 표기만으로는 dataclass의 런타임 검증이 되지 않으므로 UUID 객체를 확인합니다.
        if not isinstance(self.user_id, UUID):
            raise TypeError("AuthPrincipal requires a verified UUID")


@dataclass(frozen=True)
class VerifiedAuthIdentity:
    """서명 검증을 마친 provider/subject입니다. 이메일이나 local user UUID를 담지 않습니다."""

    provider: str
    subject: str

    def __post_init__(self):
        if not isinstance(self.provider, str) or not self.provider.strip() or len(self.provider) > 50:
            raise ValueError("Invalid verified provider")
        if not isinstance(self.subject, str) or not self.subject.strip() or len(self.subject) > 255:
            raise ValueError("Invalid verified subject")


def auth_enabled() -> bool:
    """명시적 ON 값만 허용합니다. 미설정/잘못된 값은 기존 개발 모드입니다."""
    return os.getenv("NOIE_AUTH_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def resolve_auth_principal(
    authorization: Annotated[str | None, Header()] = None,
) -> AuthPrincipal | None:
    """OFF는 개발 경로, ON은 verified token -> 기존 local user 매핑만 허용합니다."""
    if not auth_enabled():
        return None
    from supabase_auth_verifier import TokenVerificationError, verify_supabase_token
    from auth_identity_service import IdentityMappingError, resolve_identity_principal

    parts = authorization.split() if isinstance(authorization, str) else []
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="인증이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})
    try:
        identity = verify_supabase_token(parts[1])
    except TokenVerificationError:
        # token/claim/SDK 오류를 응답이나 로그로 출력하지 않습니다.
        raise HTTPException(status_code=401, detail="인증이 필요합니다.", headers={"WWW-Authenticate": "Bearer"}) from None
    try:
        return resolve_identity_principal(identity)
    except IdentityMappingError:
        # unmapped/inactive/DB 장애 모두 fallback 없이 같은 안전 응답으로 숨깁니다.
        raise HTTPException(status_code=403, detail="인증된 사용자로 요청을 처리할 수 없습니다.") from None
