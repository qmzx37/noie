"""Executor Common Layer가 호출할 안전한 실행 함수를 등록합니다.

v0.1에서는 실제 NOIE 데이터를 변경하는 Tool을 연결하지 않고 테스트용
executor만 제공합니다. 실제 Tool은 동일한 계약을 구현한 뒤 다음 단계에서
명시적으로 등록해야 합니다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ExecutorResult(BaseModel):
    """DB에 저장할 수 있는 제한된 executor 성공 결과입니다."""

    model_config = ConfigDict(extra="forbid")

    outcome: str = Field(min_length=1, max_length=50)
    data: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class ExecutorContext:
    """executor가 action을 식별하는 데 필요한 읽기 전용 정보입니다."""

    action_id: str
    user_id: str
    tool_name: str
    attempt_count: int


ExecutorFunction = Callable[[ExecutorContext], ExecutorResult]


_EXECUTORS: dict[str, ExecutorFunction] = {}
_REGISTRY_LOCK = Lock()


def register_executor(tool_name: str, executor: ExecutorFunction) -> None:
    """명시적인 이름으로 executor를 등록합니다."""

    with _REGISTRY_LOCK:
        _EXECUTORS[tool_name] = executor


def unregister_executor(tool_name: str) -> None:
    """테스트가 임시 등록한 executor를 안전하게 제거합니다."""

    with _REGISTRY_LOCK:
        _EXECUTORS.pop(tool_name, None)


def get_executor(tool_name: str | None) -> ExecutorFunction | None:
    """등록된 executor를 조회하며 미등록 Tool은 None을 반환합니다."""

    if tool_name is None:
        return None
    with _REGISTRY_LOCK:
        return _EXECUTORS.get(tool_name)


def _test_success_executor(context: ExecutorContext) -> ExecutorResult:
    return ExecutorResult(
        outcome="test_success",
        data={"action_id": context.action_id, "attempt": context.attempt_count},
    )


def _test_failure_executor(context: ExecutorContext) -> ExecutorResult:
    del context
    # 예외 원문은 DB에 저장하지 않고 executor_service에서 종류만 정제합니다.
    raise RuntimeError("forced test executor failure")


register_executor("test_success_tool", _test_success_executor)
register_executor("test_failure_tool", _test_failure_executor)

# 실제 업무 executor는 암묵적 fallback 없이 tool_name과 정확히 일치하게 등록합니다.
from agent.record_emotion_executor import record_emotion_executor  # noqa: E402

register_executor("record_emotion", record_emotion_executor)
from agent.record_daily_trace_executor import record_daily_trace_executor  # noqa: E402

register_executor("record_daily_trace", record_daily_trace_executor)
