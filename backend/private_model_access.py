"""한 요청의 검증된 소유권을 후속 모델 전송 직전에도 확인합니다."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar


class PrivateModelAccessDenied(Exception):
    """신원/계정 검사 실패를 일반 모델 장애 fallback과 구분하는 고정 예외입니다."""


_access_check: ContextVar[Callable[[], None] | None] = ContextVar("private_model_access_check", default=None)


@contextmanager
def private_model_access_scope(check: Callable[[], None] | None) -> Iterator[None]:
    """요청별 검사를 격리하고 중첩 작업도 원래 Principal의 권한을 유지합니다."""
    parent = _access_check.get()

    def combined_check() -> None:
        """내부 Agent의 검사가 기존 인증 사용자 검사를 대체하지 않도록 함께 실행합니다."""
        if parent is not None:
            parent()
        if check is not None:
            check()

    token = _access_check.set(combined_check if parent is not None or check is not None else None)
    try:
        yield
    finally:
        # 성공/실패와 관계없이 다른 요청이나 background에 이 요청의 신원을 남기지 않습니다.
        _access_check.reset(token)


def require_private_model_access() -> None:
    """SDK 전송 직전에 짧은 검사만 수행합니다. 이 함수는 DB 세션을 유지하지 않습니다."""
    check = _access_check.get()
    if check is not None:
        try:
            check()
        except Exception:
            # 상세 예외/UUID/DB 정보는 모델 입력, 사용자 응답, 로그에 복사하지 않습니다.
            raise PrivateModelAccessDenied from None
