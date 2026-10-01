"""Agent action의 lease, retry, fencing을 담당하는 공통 실행 계층입니다."""

from __future__ import annotations

import os
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from agent.executor_registry import ExecutorContext, ExecutorResult, get_executor
from database import SessionLocal
from models.agent_action import AgentAction


PROCESSING_TIMEOUT_SECONDS = max(
    1, int(os.getenv("NOIE_AGENT_ACTION_PROCESSING_TIMEOUT_SECONDS", "300"))
)
MAX_ATTEMPTS = max(1, int(os.getenv("NOIE_AGENT_ACTION_MAX_ATTEMPTS", "3")))
MAX_RESULT_BYTES = 16_384
SENSITIVE_RESULT_MARKERS = (
    "authorization",
    "database_url",
    "openai_api_key",
    "api_key",
    "password",
    "secret",
)


class ExecutorNotFoundError(Exception):
    """요청한 사용자 소유의 action이 없을 때 사용합니다."""


class ExecutorConflictError(Exception):
    """현재 상태에서 실행하거나 재시도할 수 없을 때 사용합니다."""


class ExecutorBusyError(Exception):
    """다른 worker가 유효한 lease로 처리 중일 때 사용합니다."""


class ExecutorDatabaseError(Exception):
    """내부 DB 오류를 API 응답에 직접 노출하지 않기 위한 예외입니다."""


@dataclass(frozen=True)
class Lease:
    action_id: UUID
    user_id: UUID
    tool_name: str | None
    attempt_count: int


@dataclass(frozen=True)
class ExecutionOutcome:
    action: AgentAction
    executor_called: bool
    fenced: bool = False


def can_retry(action: AgentAction) -> bool:
    """실패 또는 만료 processing action이 시도 한도 안인지 계산합니다."""

    now = datetime.now(timezone.utc)
    stale = (
        action.status == "processing"
        and action.lease_expires_at is not None
        and action.lease_expires_at <= now
    )
    return (action.status == "failed" or stale) and action.attempt_count < MAX_ATTEMPTS


def _validate_result_for_storage(result: ExecutorResult) -> ExecutorResult:
    """JSONB 저장 가능 여부와 민감정보 포함 가능성을 보수적으로 검사합니다."""

    serialized = json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
    lowered = serialized.lower()
    if len(serialized.encode("utf-8")) > MAX_RESULT_BYTES:
        raise ValueError("executor result is too large")
    if any(marker in lowered for marker in SENSITIVE_RESULT_MARKERS):
        raise ValueError("executor result contains sensitive data")
    return result


def _acquire_lease(action_id: UUID, user_id: UUID) -> tuple[AgentAction, Lease | None]:
    """짧은 row lock transaction에서 한 worker만 실행 lease를 획득합니다."""

    if SessionLocal is None:
        raise ExecutorDatabaseError

    try:
        with SessionLocal() as db:
            action = db.scalar(
                select(AgentAction)
                .where(AgentAction.action_id == action_id, AgentAction.user_id == user_id)
                .with_for_update()
            )
            if action is None:
                raise ExecutorNotFoundError

            now = datetime.now(timezone.utc)
            if action.status == "completed":
                return action, None
            if action.status == "processing":
                if action.lease_expires_at is not None and action.lease_expires_at > now:
                    raise ExecutorBusyError("action이 다른 worker에서 처리 중입니다.")
            elif action.status not in {"ready", "failed"}:
                raise ExecutorConflictError("현재 action 상태에서는 실행할 수 없습니다.")

            if action.requires_confirmation and action.confirmation_status != "confirmed":
                raise ExecutorConflictError("사용자 승인이 완료되지 않았습니다.")
            if action.attempt_count >= MAX_ATTEMPTS:
                if action.status == "processing":
                    action.status = "failed"
                    action.lease_expires_at = None
                    action.error_message = "executor_retry_limit_reached"
                    db.commit()
                raise ExecutorConflictError("최대 실행 시도 횟수를 초과했습니다.")

            action.status = "processing"
            action.attempt_count += 1
            action.processing_started_at = now
            action.lease_expires_at = now + timedelta(seconds=PROCESSING_TIMEOUT_SECONDS)
            action.result = None
            action.error_message = None
            action.completed_at = None
            attempt_count = action.attempt_count
            db.commit()
            db.refresh(action)
            return action, Lease(action.action_id, action.user_id, action.tool_name, attempt_count)
    except (ExecutorNotFoundError, ExecutorConflictError, ExecutorBusyError):
        raise
    except SQLAlchemyError as error:
        raise ExecutorDatabaseError from error


def _finish_success(lease: Lease, result: ExecutorResult) -> tuple[AgentAction, bool]:
    """현재 attempt 소유자만 성공 결과를 반영합니다."""

    if SessionLocal is None:
        raise ExecutorDatabaseError
    try:
        with SessionLocal() as db:
            action = db.scalar(
                select(AgentAction).where(AgentAction.action_id == lease.action_id).with_for_update()
            )
            if action is None:
                raise ExecutorDatabaseError
            if action.status != "processing" or action.attempt_count != lease.attempt_count:
                return action, True
            action.status = "completed"
            action.result = result.model_dump(mode="json")
            action.error_message = None
            action.lease_expires_at = None
            action.completed_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(action)
            return action, False
    except SQLAlchemyError as error:
        raise ExecutorDatabaseError from error


def _finish_failure(lease: Lease, error: Exception) -> tuple[AgentAction, bool]:
    """예외 원문 대신 안전한 종류만 저장하고 현재 attempt만 실패 처리합니다."""

    if SessionLocal is None:
        raise ExecutorDatabaseError
    try:
        with SessionLocal() as db:
            action = db.scalar(
                select(AgentAction).where(AgentAction.action_id == lease.action_id).with_for_update()
            )
            if action is None:
                raise ExecutorDatabaseError
            if action.status != "processing" or action.attempt_count != lease.attempt_count:
                return action, True
            action.status = "failed"
            action.result = None
            action.error_message = f"executor_failed:{type(error).__name__}"
            action.lease_expires_at = None
            action.completed_at = None
            db.commit()
            db.refresh(action)
            return action, False
    except SQLAlchemyError as database_error:
        raise ExecutorDatabaseError from database_error


def execute_action(action_id: UUID, user_id: UUID) -> ExecutionOutcome:
    """lease 밖에서 executor를 호출하고 결과를 fencing과 함께 반영합니다."""

    action, lease = _acquire_lease(action_id, user_id)
    if lease is None:
        return ExecutionOutcome(action=action, executor_called=False)

    executor = get_executor(lease.tool_name)
    if executor is None:
        action, fenced = _finish_failure(lease, NotImplementedError())
        return ExecutionOutcome(action=action, executor_called=False, fenced=fenced)

    context = ExecutorContext(
        action_id=str(lease.action_id),
        user_id=str(lease.user_id),
        tool_name=lease.tool_name or "",
        attempt_count=lease.attempt_count,
    )
    try:
        result = executor(context)
        if not isinstance(result, ExecutorResult):
            result = ExecutorResult.model_validate(result)
        result = _validate_result_for_storage(result)
        action, fenced = _finish_success(lease, result)
        return ExecutionOutcome(action=action, executor_called=True, fenced=fenced)
    except Exception as error:
        action, fenced = _finish_failure(lease, error)
        return ExecutionOutcome(action=action, executor_called=True, fenced=fenced)
