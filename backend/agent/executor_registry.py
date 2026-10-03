"""Executor Common Layer가 호출할 안전한 실행 함수를 등록합니다.

테스트용 Tool과 구현된 업무 Tool 모두 동일한 실행 계약을 사용합니다.
새 업무 Tool은 아래 registry에 명시적으로 등록해야 하며 암묵적인
fallback executor는 제공하지 않습니다.
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
from agent.record_dream_goal_executor import record_dream_goal_executor  # noqa: E402

register_executor("record_dream_goal", record_dream_goal_executor)
from agent.create_schedule_executor import create_schedule_executor  # noqa: E402

register_executor("create_schedule", create_schedule_executor)
from agent.record_place_event_executor import record_place_event_executor  # noqa: E402

# Place도 공통 lease/retry/fencing 경로에서만 실행합니다.
register_executor("record_place_event", record_place_event_executor)
from agent.record_body_state_executor import record_body_state_executor  # noqa: E402

# 새로운 실행 framework 없이 기존 lease/retry/fencing을 사용합니다.
register_executor("record_body_state", record_body_state_executor)
