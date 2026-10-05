"""공식 SDK의 검증된 claims만 사용합니다. payload를 직접 decode해서 신뢰하지 않습니다."""

import math
import os
import time
from urllib.parse import urlsplit
from uuid import UUID

from auth_context import VerifiedAuthIdentity


class TokenVerificationError(Exception):
    """설정/서명/claims 오류를 외부에 상세 노출하지 않는 검증 실패입니다."""


def verify_supabase_token(access_token: str) -> VerifiedAuthIdentity:
    """서명 검증 이후 issuer/audience/role/anonymous/subject를 추가 확인합니다."""
    try:
        url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        parsed = urlsplit(url)
        # 운영 설정만 사용하며 service_role/secret/JWT signing secret은 받지 않습니다.
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment or not key.startswith("sb_publishable_")):
            raise TokenVerificationError
        if not isinstance(access_token, str) or not access_token or any(c.isspace() for c in access_token):
            raise TokenVerificationError
        from supabase import ClientOptions, create_client
        import httpx

        # 인증 네트워크 호출 중 DB 세션을 열지 않고, session 저장/자동 refresh도 사용하지 않습니다.
        with httpx.Client(timeout=10.0, trust_env=False) as transport:
            client = create_client(url, key, options=ClientOptions(
                persist_session=False, auto_refresh_token=False, httpx_client=transport,
            ))
            response = client.auth.get_claims(access_token)
        claims = response.get("claims") if isinstance(response, dict) else None
        if not isinstance(claims, dict):
            raise TokenVerificationError
        now = time.time()
        exp = claims.get("exp")
        if type(exp) not in (int, float) or not math.isfinite(exp) or exp <= now:
            raise TokenVerificationError
        nbf = claims.get("nbf")
        if nbf is not None and (type(nbf) not in (int, float) or not math.isfinite(nbf) or nbf > now):
            raise TokenVerificationError
        aud = claims.get("aud")
        if aud != "authenticated" and not (isinstance(aud, list) and "authenticated" in aud):
            raise TokenVerificationError
        if (claims.get("iss") != url + "/auth/v1" or claims.get("role") != "authenticated"
                or claims.get("is_anonymous") is not False):
            raise TokenVerificationError
        subject = claims.get("sub")
        if not isinstance(subject, str) or str(UUID(subject)) != subject.lower() or UUID(subject).int == 0:
            raise TokenVerificationError
        return VerifiedAuthIdentity(provider="supabase", subject=str(UUID(subject)))
    except Exception:
        # SDK 예외에는 token/claims가 포함될 수 있으므로 출력하거나 재전달하지 않습니다.
        raise TokenVerificationError from None
