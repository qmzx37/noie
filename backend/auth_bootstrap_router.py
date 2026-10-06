"""아직 mapping이 없는 사용자도 검증된 Supabase JWT로만 onboarding할 수 있습니다."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from security_rate_limit import enforce_bootstrap_limit
from sqlalchemy.orm import Session

from auth_bootstrap_service import BootstrapError, bootstrap_auth_identity
from auth_context import VerifiedAuthIdentity
from database import get_db
from supabase_auth_verifier import TokenVerificationError, verify_supabase_token

router = APIRouter(tags=['auth'])


def require_bootstrap_identity(
    authorization: Annotated[str | None, Header()] = None,
    request: Request = None,
) -> VerifiedAuthIdentity:
    """Auth OFF에서도 JWT 검증을 생략하지 않습니다. 기존 Principal mapping은 요구하지 않습니다."""
    parts = authorization.split() if isinstance(authorization, str) else []
    if len(parts) != 2 or parts[0].lower() != 'bearer':
        raise HTTPException(401, '인증이 필요합니다.', headers={'WWW-Authenticate': 'Bearer'})
    try:
        identity = verify_supabase_token(parts[1])
    except TokenVerificationError:
        raise HTTPException(401, '인증이 필요합니다.', headers={'WWW-Authenticate': 'Bearer'}) from None
    # JWT 성공 뒤, bootstrap DB 쓰기 dependency/업무 실행 전에 제한합니다.
    enforce_bootstrap_limit(request, identity.provider, identity.subject)
    return identity


@router.post('/auth/bootstrap')
def post_auth_bootstrap(
    identity: VerifiedAuthIdentity = Depends(require_bootstrap_identity),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """body의 user_id/email은 받지 않으며 최초/반복 호출 모두 status-only 200입니다."""
    try:
        bootstrap_auth_identity(db, identity)
    except BootstrapError as error:
        if error.code in {'INACTIVE_AUTH_USER', 'INVALID_VERIFIED_IDENTITY'}:
            raise HTTPException(403, '인증된 사용자로 요청을 처리할 수 없습니다.') from None
        raise HTTPException(503, '계정 준비를 완료하지 못했습니다. 다시 시도해 주세요.') from None
    return {'status': 'ready'}
