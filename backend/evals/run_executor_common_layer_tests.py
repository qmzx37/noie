"""실제 PostgreSQL에서 Executor Common Layer v0.1을 검증합니다."""

from __future__ import annotations

import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402
from agent.executor_registry import (  # noqa: E402
    ExecutorResult,
    register_executor,
    unregister_executor,
)
from agent.executor_service import Lease, _acquire_lease, _finish_success  # noqa: E402
from database import SessionLocal  # noqa: E402
from models.agent_action import AgentAction  # noqa: E402
from models.user import User  # noqa: E402


RUN_ID = uuid4().hex
PREFIX = f"__noie_executor_test__{RUN_ID}"
PASSED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        raise AssertionError(f"{name}: {detail}")
    PASSED += 1
    print(f"[PASS] {name}: {detail}")


def seed_action(
    user_id,
    *,
    tool_name="test_success_tool",
    status="ready",
    attempts=0,
    requires_confirmation=False,
    confirmation_status="not_required",
    lease_expires_at=None,
):
    with SessionLocal() as db:
        action = AgentAction(
            user_id=user_id,
            action_id=uuid4(),
            tool_name=tool_name,
            action_type="emotion",
            intent=f"test_{RUN_ID}",
            mode="record",
            status=status,
            confidence=1.0,
            requires_confirmation=requires_confirmation,
            execution_order=1,
            idempotency_key=uuid4().hex,
            confirmation_status=confirmation_status,
            attempt_count=attempts,
            processing_started_at=(datetime.now(timezone.utc) if status == "processing" else None),
            lease_expires_at=lease_expires_at,
            metadata_={"test_run": RUN_ID},
        )
        db.add(action)
        db.commit()
        db.refresh(action)
        return action.action_id


def row(action_id):
    with SessionLocal() as db:
        return db.scalar(select(AgentAction).where(AgentAction.action_id == action_id))


def execute(client, action_id, user_id):
    return client.post(
        f"/agent/actions/{action_id}/execute",
        json={"user_id": str(user_id)},
    )


def run() -> None:
    with SessionLocal() as db:
        user = User(name=PREFIX, metadata_={"test_run": RUN_ID})
        other = User(name=f"{PREFIX}:other", metadata_={"test_run": RUN_ID})
        db.add_all([user, other])
        db.commit()
        user_id, other_id = user.id, other.id

    client = TestClient(main.app)

    success_id = seed_action(user_id)
    success = execute(client, success_id, user_id)
    success_body = success.json()
    check("1 ready -> completed", success.status_code == 200 and success_body["action"]["status"] == "completed")

    repeated = execute(client, success_id, user_id)
    check(
        "2 completed 결과 재사용",
        repeated.status_code == 200
        and repeated.json()["executor_called"] is False
        and repeated.json()["action"]["attempt_count"] == 1,
    )

    pending_id = seed_action(
        user_id,
        status="pending_confirmation",
        requires_confirmation=True,
        confirmation_status="pending",
    )
    check("3 pending 실행 차단", execute(client, pending_id, user_id).status_code == 409)

    rejected_id = seed_action(
        user_id,
        status="rejected",
        requires_confirmation=True,
        confirmation_status="rejected",
    )
    check("4 rejected 실행 차단", execute(client, rejected_id, user_id).status_code == 409)

    cancelled_id = seed_action(user_id, status="cancelled")
    check("5 cancelled 실행 차단", execute(client, cancelled_id, user_id).status_code == 409)

    active_id = seed_action(
        user_id,
        status="processing",
        attempts=1,
        lease_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    check("6 유효 processing lease 차단", execute(client, active_id, user_id).status_code == 409)

    stale_id = seed_action(
        user_id,
        status="processing",
        attempts=1,
        lease_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    stale = execute(client, stale_id, user_id)
    check("7 stale processing retry", stale.status_code == 200 and stale.json()["action"]["attempt_count"] == 2)
    check("8 stale retry completed", stale.json()["action"]["status"] == "completed")

    failed_id = seed_action(user_id, tool_name="test_failure_tool")
    failed = execute(client, failed_id, user_id)
    check("9 executor 실패", failed.status_code == 200 and failed.json()["action"]["status"] == "failed")

    register_executor("test_failure_tool", lambda context: ExecutorResult(outcome="retry_success", data={"attempt": context.attempt_count}))
    retried = execute(client, failed_id, user_id)
    check("10 failed retry", retried.status_code == 200 and retried.json()["action"]["status"] == "completed")

    maxed_id = seed_action(user_id, status="failed", attempts=3)
    check("11 max attempts 차단", execute(client, maxed_id, user_id).status_code == 409)

    calls = {"count": 0}
    entered = threading.Event()
    release = threading.Event()

    def slow_executor(context):
        calls["count"] += 1
        entered.set()
        release.wait(timeout=10)
        return ExecutorResult(outcome="slow_success", data={"attempt": context.attempt_count})

    register_executor("test_slow_tool", slow_executor)
    concurrent_id = seed_action(user_id, tool_name="test_slow_tool")
    first_response = {}

    def run_first():
        first_response["response"] = execute(TestClient(main.app), concurrent_id, user_id)

    thread = threading.Thread(target=run_first)
    thread.start()
    if not entered.wait(timeout=10):
        raise AssertionError("slow executor가 시작되지 않았습니다.")
    second = execute(client, concurrent_id, user_id)
    release.set()
    thread.join(timeout=10)
    check(
        "12 동시 execute 1회 호출",
        second.status_code == 409
        and first_response["response"].json()["action"]["status"] == "completed"
        and calls["count"] == 1,
        f"second={second.status_code}, calls={calls['count']}",
    )

    fencing_id = seed_action(
        user_id,
        status="processing",
        attempts=1,
        lease_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    old_lease = Lease(fencing_id, user_id, "test_success_tool", 1)
    _, new_lease = _acquire_lease(fencing_id, user_id)
    new_result, new_fenced = _finish_success(
        new_lease, ExecutorResult(outcome="new_worker", data={})
    )
    old_result, old_fenced = _finish_success(
        old_lease, ExecutorResult(outcome="old_worker", data={})
    )
    check(
        "13 attempt fencing",
        not new_fenced
        and old_fenced
        and old_result.result["outcome"] == "new_worker"
        and new_result.attempt_count == 2,
    )

    owned_id = seed_action(user_id)
    check("14 다른 사용자 실행 차단", execute(client, owned_id, other_id).status_code == 404)
    check("15 없는 action 404", execute(client, uuid4(), user_id).status_code == 404)

    unknown_id = seed_action(user_id, tool_name="not_registered_test_tool")
    unknown = execute(client, unknown_id, user_id)
    check("16 미등록 executor 안전 실패", unknown.status_code == 200 and unknown.json()["action"]["status"] == "failed")

    stored = row(success_id)
    check("17 result 저장", stored.result["outcome"] == "test_success" and stored.completed_at is not None)
    failed_stored = row(unknown_id)
    unsafe_text = str(failed_stored.error_message).lower()
    check(
        "18 error secret 미포함",
        failed_stored.error_message == "executor_failed:NotImplementedError"
        and not any(word in unsafe_text for word in ("password", "api_key", "authorization", "database_url")),
    )

    restart_id = seed_action(
        user_id,
        status="processing",
        attempts=1,
        lease_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    restarted = execute(TestClient(main.app), restart_id, user_id)
    check("19 재시작 후 stale 복구", restarted.status_code == 200 and restarted.json()["action"]["status"] == "completed")

    isolated_success = seed_action(user_id)
    isolated_failure = seed_action(user_id, tool_name="not_registered_isolated_tool")
    fail_response = execute(client, isolated_failure, user_id)
    success_response = execute(client, isolated_success, user_id)
    check(
        "20 action별 상태 격리",
        fail_response.json()["action"]["status"] == "failed"
        and success_response.json()["action"]["status"] == "completed",
    )

    unregister_executor("test_slow_tool")
    print(f"TEST_RUN_ID={RUN_ID}")
    print(f"TEST_USER_ID={user_id}")
    print(f"SUMMARY={PASSED}/20")


if __name__ == "__main__":
    run()
