"""실제 PostgreSQL에서 Action/Confirmation persistence를 검증합니다."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402
from agent.tool_gateway import create_tool_plan  # noqa: E402
from agent.tool_schemas import GatewayAction, ToolPlanRequest  # noqa: E402
from database import SessionLocal  # noqa: E402
from models.agent_action import AgentAction  # noqa: E402
from models.conversation import Conversation  # noqa: E402
from models.message import Message  # noqa: E402
from models.user import User  # noqa: E402


RUN_ID = uuid4().hex
PREFIX = f"__noie_agent_action_test__{RUN_ID}"
PASSED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        raise AssertionError(f"{name}: {detail}")
    PASSED += 1
    print(f"[PASS] {name}: {detail}")


def gateway_action(action_type, intent, mode, order, confirmation=False, confidence=0.95):
    return GatewayAction(
        type=action_type,
        intent=intent,
        mode=mode,
        reason="persistence integration test",
        confidence=confidence,
        requires_confirmation=confirmation,
        execution_order=order,
    )


def request_body(user_id, conversation_id, message_id, plans):
    return {
        "user_id": str(user_id),
        "conversation_id": str(conversation_id),
        "message_id": str(message_id),
        "plans": [plan.model_dump(mode="json") for plan in plans],
    }


def action_count(user_id) -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count(AgentAction.id)).where(AgentAction.user_id == user_id)) or 0


def run() -> None:
    with SessionLocal() as db:
        user = User(name=PREFIX, metadata_={"test_run": RUN_ID})
        other = User(name=f"{PREFIX}:other", metadata_={"test_run": RUN_ID})
        db.add_all([user, other])
        db.flush()
        conversation = Conversation(user_id=user.id, title=PREFIX, metadata_={"test_run": RUN_ID})
        db.add(conversation)
        db.flush()
        message = Message(
            conversation_id=conversation.id,
            user_id=user.id,
            role="user",
            content=PREFIX,
            metadata_={"test_run": RUN_ID},
        )
        db.add(message)
        db.commit()
        user_id, other_id = user.id, other.id
        conversation_id, message_id = conversation.id, message.id

    client = TestClient(main.app)
    record_plan = create_tool_plan(
        ToolPlanRequest(actions=[gateway_action("emotion", "record_emotion", "record", 1)])
    ).plans
    record_response = client.post(
        "/agent/actions/plan",
        json=request_body(user_id, conversation_id, message_id, record_plan),
    )
    record_row = record_response.json()[0]
    check("1 record 저장 ready", record_response.status_code == 201 and record_row["status"] == "ready")

    execute_plan = create_tool_plan(
        ToolPlanRequest(actions=[gateway_action("schedule", "create_schedule", "execute", 1, True)])
    ).plans
    execute_response = client.post(
        "/agent/actions/plan",
        json=request_body(user_id, conversation_id, message_id, execute_plan),
    )
    execute_row = execute_response.json()[0]
    check("2 execute 저장 pending", execute_response.status_code == 201 and execute_row["status"] == "pending_confirmation")

    before_duplicate = action_count(user_id)
    duplicate_response = client.post(
        "/agent/actions/plan",
        json=request_body(user_id, conversation_id, message_id, execute_plan),
    )
    check(
        "3 idempotency key 재사용",
        action_count(user_id) == before_duplicate and duplicate_response.json()[0]["id"] == execute_row["id"],
    )

    check(
        "4 action_id 중복 방지",
        duplicate_response.json()[0]["action_id"] == execute_row["action_id"],
    )

    confirmation = {
        "user_id": str(user_id),
        "confirmation_id": execute_row["confirmation_id"],
    }
    confirmed = client.post(
        f"/agent/actions/{execute_row['action_id']}/confirm",
        json=confirmation,
    )
    check("5 pending 승인 ready", confirmed.status_code == 200 and confirmed.json()["status"] == "ready")

    reject_plan = create_tool_plan(
        ToolPlanRequest(actions=[gateway_action("schedule", "delete_schedule", "execute", 1, True)])
    ).plans
    reject_saved = client.post(
        "/agent/actions/plan",
        json=request_body(user_id, conversation_id, message_id, reject_plan),
    ).json()[0]
    rejected = client.post(
        f"/agent/actions/{reject_saved['action_id']}/reject",
        json={"user_id": str(user_id), "confirmation_id": reject_saved["confirmation_id"]},
    )
    check("6 pending 거절 rejected", rejected.status_code == 200 and rejected.json()["status"] == "rejected")

    reconfirm = client.post(f"/agent/actions/{execute_row['action_id']}/confirm", json=confirmation)
    check("7 승인 action 재승인 차단", reconfirm.status_code == 409, str(reconfirm.status_code))

    rejected_confirm = client.post(
        f"/agent/actions/{reject_saved['action_id']}/confirm",
        json={"user_id": str(user_id), "confirmation_id": reject_saved["confirmation_id"]},
    )
    check("8 rejected 재승인 차단", rejected_confirm.status_code == 409, str(rejected_confirm.status_code))

    cross_user = client.post(
        f"/agent/actions/{reject_saved['action_id']}/confirm",
        json={"user_id": str(other_id), "confirmation_id": reject_saved["confirmation_id"]},
    )
    check("9 다른 사용자 승인 차단", cross_user.status_code == 404, str(cross_user.status_code))

    missing = client.get(f"/agent/actions/{uuid4()}", params={"user_id": str(user_id)})
    check("10 없는 action 404", missing.status_code == 404, str(missing.status_code))

    check("11 record confirmation 없음", record_row["confirmation_id"] is None and not record_row["requires_confirmation"])
    check("12 execute confirmation 강제", execute_row["confirmation_id"] is not None and execute_row["requires_confirmation"])

    batch_plans = create_tool_plan(
        ToolPlanRequest(
            actions=[
                gateway_action("recommendation", "request_recommendation", "suggest", 3),
                gateway_action("emotion", "record_emotion", "record", 1),
                gateway_action("daily_life", "record_daily_trace", "record", 2),
            ]
        )
    ).plans
    batch = client.post(
        "/agent/actions/plan",
        json=request_body(user_id, conversation_id, message_id, batch_plans),
    )
    check("13 batch execution_order 보존", [row["execution_order"] for row in batch.json()] == [1, 2, 3])

    before_batch_duplicate = action_count(user_id)
    duplicate_batch = client.post(
        "/agent/actions/plan",
        json=request_body(user_id, conversation_id, message_id, [batch_plans[0], batch_plans[0]]),
    )
    check(
        "14 batch 내부 중복 재사용",
        duplicate_batch.status_code == 201 and action_count(user_id) == before_batch_duplicate,
    )

    pending_plan = create_tool_plan(
        ToolPlanRequest(actions=[gateway_action("dream_goal", "change_dream_goal", "execute", 1, True)])
    ).plans
    pending_saved = client.post(
        "/agent/actions/plan",
        json=request_body(user_id, conversation_id, message_id, pending_plan),
    ).json()[0]
    restarted_client = TestClient(main.app)
    restored = restarted_client.get(
        f"/agent/actions/{pending_saved['action_id']}",
        params={"user_id": str(user_id)},
    )
    check("15 서버 재시작 후 pending 복구", restored.status_code == 200 and restored.json()["status"] == "pending_confirmation")

    malformed = client.post("/agent/actions/plan", json={"user_id": str(user_id), "plans": []})
    check("16 malformed action 422", malformed.status_code == 422, str(malformed.status_code))

    with SessionLocal() as db:
        rows = list(db.scalars(select(AgentAction).where(AgentAction.user_id == user_id)).all())
    unsafe = any(
        row.error_message is not None
        or any(term in str(row.metadata_).lower() for term in ["api_key", "database_url", "authorization", "password", "secret"])
        for row in rows
    )
    check("17 secret/error 저장 없음", not unsafe, f"rows={len(rows)}")

    check("18 /orchestrate route 유지", "/orchestrate" in {route.path for route in main.app.routes})
    tool_plan = client.post(
        "/agent/tool-plan",
        json={"actions": [gateway_action("emotion", "record_emotion", "record", 1).model_dump(mode="json")]},
    )
    check("19 /agent/tool-plan 정상", tool_plan.status_code == 200, str(tool_plan.status_code))
    check("20 /chat route 유지", "/chat" in {route.path for route in main.app.routes})
    check("21 Memory Retrieval route 유지", "/memory-retrieval/preview" in {route.path for route in main.app.routes})

    print(f"TEST_RUN_ID={RUN_ID}")
    print(f"TEST_USER_ID={user_id}")
    print(f"TEST_CONVERSATION_ID={conversation_id}")
    print(f"TEST_AGENT_ACTIONS={action_count(user_id)}")
    print(f"SUMMARY={PASSED}/21")


if __name__ == "__main__":
    run()
