"""프로세스별 비용 남용 제한입니다. 인증/소유권 또는 분산 DDoS 방어를 대체하지 않습니다."""

import hashlib
import math
import os
import threading
import time
from collections import OrderedDict
from uuid import UUID

from fastapi import HTTPException, Request
from starlette.responses import JSONResponse

from security_config import rate_limit_enabled, rate_limit_number


RATE_LIMIT_MESSAGE = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
# 숫자는 endpoint별로 흩어 놓지 않고 논리 그룹 단위로 관리합니다.
LIMITS = {
    "EXPENSIVE_AI": ("NOIE_RATE_LIMIT_EXPENSIVE_PER_MINUTE", 30),
    "PROTECTED_STANDARD": ("NOIE_RATE_LIMIT_STANDARD_PER_MINUTE", 120),
    "AUTH_BOOTSTRAP": ("NOIE_RATE_LIMIT_BOOTSTRAP_PER_MINUTE", 10),
    "PRE_AUTH": ("NOIE_RATE_LIMIT_PRE_AUTH_PER_MINUTE", 300),
    "PRE_AUTH_BOOTSTRAP": ("NOIE_RATE_LIMIT_PRE_AUTH_BOOTSTRAP_PER_MINUTE", 30),
    "PUBLIC_HEALTH": ("NOIE_RATE_LIMIT_HEALTH_PER_MINUTE", 600),
    "INTERNAL": ("NOIE_RATE_LIMIT_INTERNAL_PER_MINUTE", 10),
}
AI_PATHS = frozenset({"/chat", "/orchestrate", "/agent/tool-plan", "/generate-title",
                      "/analyze-emotion", "/extract-daily-trace"})


def request_group(path: str) -> str:
    """직접 Memory 추출/Tool 실행도 OpenAI 비용이 생길 수 있어 같은 비용 한도를 씁니다."""
    if path in AI_PATHS or (path.startswith("/messages/") and path.endswith("/extract-memory")) or (
        path.startswith("/agent/actions/") and path.endswith("/execute")
    ):
        return "EXPENSIVE_AI"
    if path == "/auth/bootstrap":
        return "AUTH_BOOTSTRAP"
    if path == "/internal/background-probe":
        return "INTERNAL"
    return "PROTECTED_STANDARD"


class InMemoryRateLimiter:
    """monotonic 고정 창과 짧은 lock입니다. 활성 bucket을 퇴출해 한도를 초기화하지 않습니다."""

    def __init__(self, *, max_buckets: int = 10000, clock=time.monotonic, window_seconds: float = 60):
        if max_buckets < 1 or window_seconds <= 0:
            raise ValueError("Invalid limiter capacity")
        self._max_buckets = max_buckets
        self._clock = clock
        self._window = window_seconds
        self._lock = threading.Lock()
        self._buckets = OrderedDict()

    def consume(self, group: str, identity: str, limit: int) -> int | None:
        """허용은 None, 거부는 Retry-After 초입니다. 카운트/정리/생성은 원자적으로 수행합니다."""
        with self._lock:
            now = self._clock()
            # 모든 창 길이가 같아 생성 순서가 만료 순서입니다. 요청당 전체 map을 스캔하지 않습니다.
            while self._buckets and next(iter(self._buckets.values()))[0] <= now:
                self._buckets.popitem(last=False)
            key = (group, identity)
            bucket = self._buckets.get(key)
            if bucket is None:
                if len(self._buckets) >= self._max_buckets:
                    # 용량 포화에서 fail-closed; 기존 활성 사용자의 bucket은 그대로 보존합니다.
                    return max(1, math.ceil(next(iter(self._buckets.values()))[0] - now))
                bucket = [now + self._window, 0]
                self._buckets[key] = bucket
            if bucket[1] >= limit:
                return max(1, math.ceil(bucket[0] - now))
            bucket[1] += 1
            return None


limiter = InMemoryRateLimiter(max_buckets=rate_limit_number("NOIE_RATE_LIMIT_MAX_BUCKETS", 10000, 50000))


def _digest(kind: str, value: bytes) -> str:
    """bucket에는 token/UUID/IP 원문 대신 목적별 digest만 보관하고 로그는 남기지 않습니다."""
    return hashlib.sha256(kind.encode("ascii") + b":" + value).hexdigest()


def _peer_identity(scope) -> str:
    """Forwarded/X-Forwarded-For를 직접 읽지 않습니다. ASGI server의 peer 신뢰 설정은 별도 책임입니다."""
    client = scope.get("client")
    return _digest("peer", str(client[0] if client else "unknown-peer").encode("utf-8"))


def _consume(group: str, identity: str) -> int | None:
    name, default = LIMITS[group]
    return limiter.consume(group, identity, rate_limit_number(name, default))


def enforce_user_limit(request: Request | None, user_id: UUID | None) -> None:
    """호출자는 JWT/매핑 성공 후만 전달합니다. None은 명시적 auth-OFF 개발 peer 경로입니다."""
    if request is None or not rate_limit_enabled():
        return
    identity = _digest("local-user", user_id.bytes) if user_id is not None else _peer_identity(request.scope)
    retry = _consume(request_group(request.url.path), identity)
    if retry is not None:
        raise HTTPException(429, RATE_LIMIT_MESSAGE, headers={"Retry-After": str(retry)})


def enforce_bootstrap_limit(request: Request | None, provider: str, subject: str) -> None:
    """미매핑 신규 계정도 있으므로 bootstrap만 검증된 external identity digest를 사용합니다."""
    if request is None or not rate_limit_enabled():
        return
    retry = _consume("AUTH_BOOTSTRAP", _digest("verified-bootstrap", f"{provider}:{subject}".encode("utf-8")))
    if retry is not None:
        raise HTTPException(429, RATE_LIMIT_MESSAGE, headers={"Retry-After": str(retry)})


class PreAuthRateLimitMiddleware:
    """본문/토큰을 읽지 않는 ASGI coarse guard입니다. response/background dispatch를 감싸지 않습니다."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] != "OPTIONS" and rate_limit_enabled():
            path = scope["path"]
            # 비활성 내부 진단은 항상 기존 404 경로가 우선합니다. 문서도 자체 OFF 정책을 유지합니다.
            probe_off = path == "/internal/background-probe" and os.getenv(
                "NOIE_BG_PROBE_ENDPOINT_ENABLED", ""
            ).strip().lower() not in {"1", "true", "yes", "on"}
            docs_path = path in {"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"}
            if not probe_off and not docs_path:
                group = "PUBLIC_HEALTH" if path in {"/", "/db-health"} else (
                    "PRE_AUTH_BOOTSTRAP" if path == "/auth/bootstrap" else "PRE_AUTH"
                )
                retry = _consume(group, _peer_identity(scope))
                if retry is not None:
                    await JSONResponse({"detail": RATE_LIMIT_MESSAGE}, status_code=429,
                                       headers={"Retry-After": str(retry)})(scope, receive, send)
                    return
        await self.app(scope, receive, send)
