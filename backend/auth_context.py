"""외부 provider와 독립된 인증 계약입니다. 클라이언트 UUID나 미검증 token은 신뢰하지 않습니다."""

import os
from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, status


@dataclass(frozen=True)
class AuthPrincipal:
    """미래 verifier가 검증한 내부 사용자 UUID만 담는 불변 신원입니다."""

    user_id: UUID

    def __post_init__(self):
        # 타입 표기만으로는 dataclass의 런타임 검증이 되지 않으므로 UUID 객체를 확인합니다.
        if not isinstance(self.user_id, UUID):
            raise TypeError("AuthPrincipal requires a verified UUID")


def auth_enabled() -> bool:
    """명시적 ON 값만 허용합니다. 미설정/잘못된 값은 기존 개발 모드입니다."""
    return os.getenv("NOIE_AUTH_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def resolve_auth_principal() -> AuthPrincipal | None:
    """OFF는 개발 경로를 유지하고 ON은 verifier 미연결 상태에서 반드시 거부합니다."""
    if not auth_enabled():
        return None
    # TODO Phase 10.2: 실제 token 검증과 서버 측 사용자 매핑 후에만 Principal을 반환합니다.
    # 임의 header/body/query나 미검증 JWT의 UUID를 Principal로 만들지 않습니다.
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증이 필요합니다.")
