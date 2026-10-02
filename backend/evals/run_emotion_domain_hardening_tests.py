"""Emotion v0.2 조회와 transaction fault 경계를 실제 PostgreSQL에서 검증합니다."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402
from agent.emotion_schemas import EmotionRecordArguments  # noqa: E402
from agent.executor_registry import register_executor  # noqa: E402
from agent.executor_service import _acquire_lease  # noqa: E402
from agent.record_emotion_executor import record_emotion_executor  # noqa: E402
from agent.tool_gateway import create_tool_plan  # noqa: E402
from agent.tool_schemas import GatewayAction, ToolPlanRequest  # noqa: E402
from database import SessionLocal  # noqa: E402
from models.agent_action import AgentAction  # noqa: E402
from models.conversation import Conversation  # noqa: E402
from models.emotion_event import EmotionEvent  # noqa: E402
from models.message import Message  # noqa: E402
from models.user import User  # noqa: E402


RUN_ID = uuid4().hex
PREFIX = f"__noie_emotion_hardening__{RUN_ID}"
PASSED = 0
AXIS = {"F": 0.1, "A": 0.8, "D": 0.2, "J": 0.1, "C": 0.2, "G": 0.3, "T": 0.6, "R": 0.1, "confidence": 0.9}


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        raise AssertionError(f"{name}: {detail}")
    PASSED += 1
    print(f"[PASS] {name}: {detail}")


def make_plan(arguments=AXIS, confidence=0.9):
    return create_tool_plan(
        ToolPlanRequest(actions=[GatewayAction(
            type="emotion", intent="record_emotion", mode="record",
            reason="emotion hardening test", confidence=confidence,
            requires_confirmation=False, execution_order=1, arguments=arguments,
        )])
    ).plans[0]


def persist(client, user_id, conversation_id, message_id, plan):
    response = client.post("/agent/actions/plan", json={
        "user_id": str(user_id), "conversation_id": str(conversation_id),
        "message_id": str(message_id), "plans": [plan.model_dump(mode="json")],
    })
    return response


def execute(client, action_id, user_id):
    return client.post(f"/agent/actions/{action_id}/execute", json={"user_id": str(user_id)})


def action_and_event(action_id):
    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == action_id))
        event = db.scalar(select(EmotionEvent).where(EmotionEvent.agent_action_id == action.id))
        return action, event


def event_count(action_db_id):
    with SessionLocal() as db:
        return db.scalar(select(func.count(EmotionEvent.id)).where(EmotionEvent.agent_action_id == action_db_id)) or 0


def fail_hook():
    raise RuntimeError("injected transaction failure")


def run() -> None:
    with SessionLocal() as db:
        user = User(name=PREFIX, metadata_={"test_run": RUN_ID})
        other = User(name=f"{PREFIX}:other", metadata_={"test_run": RUN_ID})
        db.add_all([user, other])
        db.flush()
        conversation = Conversation(user_id=user.id, title=PREFIX, metadata_={"test_run": RUN_ID})
        db.add(conversation)
        db.flush()
        messages = []
        for index in range(6):
            message = Message(
                conversation_id=conversation.id, user_id=user.id, role="user",
                content=f"감정 테스트 {index}", metadata_={"test_run": RUN_ID},
            )
            db.add(message)
            messages.append(message)
        db.commit()
        user_id, other_id, conversation_id = user.id, other.id, conversation.id
        message_ids = [message.id for message in messages]

    client = TestClient(main.app)
    events = []
    for index in range(3):
        plan = make_plan({**AXIS, "A": 0.6 + index * 0.1})
        saved = persist(client, user_id, conversation_id, message_ids[index], plan).json()[0]
        executed = execute(client, saved["action_id"], user_id)
        if executed.status_code != 200:
            raise AssertionError(executed.text)
        _, event = action_and_event(plan.action_id)
        events.append(event)

    latest = events[-1]
    single = client.get(f"/emotion-events/{latest.id}", params={"user_id": str(user_id)})
    check("1 본인 단건 조회", single.status_code == 200 and single.json()["id"] == str(latest.id))

    listing = client.get(f"/users/{user_id}/emotion-events", params={"limit": 10})
    listed = listing.json()
    check("2 본인 목록 조회", listing.status_code == 200 and len(listed) >= 3)
    ordering = [(item["created_at"], item["id"]) for item in listed]
    check("3 최신순 deterministic ordering", ordering == sorted(ordering, reverse=True))
    limited = client.get(f"/users/{user_id}/emotion-events", params={"limit": 2})
    check("4 limit 적용", limited.status_code == 200 and len(limited.json()) == 2)
    cross = client.get(f"/emotion-events/{latest.id}", params={"user_id": str(other_id)})
    check("5 다른 사용자 단건 차단", cross.status_code == 404)
    missing = client.get(f"/emotion-events/{uuid4()}", params={"user_id": str(user_id)})
    check("6 없는 event 404", missing.status_code == 404)
    check("7 불변 event 조회", "deleted_at" not in single.json())
    check("8 message FK 유지", single.json()["message_id"] == str(message_ids[2]))
    check("9 agent_action FK 유지", single.json()["agent_action_id"] == str(latest.agent_action_id))
    check("10 8축 그대로 응답", all(single.json()[key] == getattr(latest, key.lower()) for key in "FADJCGTR"))
    check("11 confidence 응답", single.json()["confidence"] == AXIS["confidence"])
    check(
        "12 source/version 추적",
        single.json()["source"] == "orchestrator"
        and single.json()["metadata"]["extractor_version"] == "emotion-v1",
    )
    other_list = client.get(f"/users/{other_id}/emotion-events").json()
    check("13 다른 사용자 목록 혼입 없음", other_list == [])

    low_plan = make_plan(confidence=0.39)
    check("14 저신뢰 needs_review", low_plan.status == "needs_review")

    # Case A: INSERT 전에 실패하면 Common Layer는 action만 failed로 전환합니다.
    register_executor("record_emotion", lambda context: record_emotion_executor(context, before_insert=fail_hook))
    before_plan = make_plan()
    before_saved = persist(client, user_id, conversation_id, message_ids[3], before_plan).json()[0]
    before_result = execute(client, before_saved["action_id"], user_id)
    before_action, _ = action_and_event(before_plan.action_id)
    check("15 INSERT 전 실패 rollback", before_result.json()["action"]["status"] == "failed" and event_count(before_action.id) == 0)

    # Case B: INSERT가 flush된 뒤 commit 전에 실패해도 session rollback으로 row가 남지 않습니다.
    register_executor("record_emotion", lambda context: record_emotion_executor(context, before_commit=fail_hook))
    commit_plan = make_plan()
    commit_saved = persist(client, user_id, conversation_id, message_ids[4], commit_plan).json()[0]
    commit_result = execute(client, commit_saved["action_id"], user_id)
    commit_action, _ = action_and_event(commit_plan.action_id)
    check("16 commit 전 실패 rollback", commit_result.json()["action"]["status"] == "failed" and event_count(commit_action.id) == 0)

    # Case C: domain commit 뒤 old worker finalize가 유실돼도 retry가 기존 Event를 재사용합니다.
    register_executor("record_emotion", record_emotion_executor)
    race_plan = make_plan()
    persist(client, user_id, conversation_id, message_ids[5], race_plan)
    _, lease = _acquire_lease(race_plan.action_id, user_id)
    first_result = record_emotion_executor(
        context=type("Context", (), {
            "action_id": str(lease.action_id), "user_id": str(lease.user_id),
            "tool_name": lease.tool_name, "attempt_count": lease.attempt_count,
        })()
    )
    with SessionLocal() as db:
        race_action = db.scalar(select(AgentAction).where(AgentAction.action_id == race_plan.action_id))
        race_action.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        race_db_id = race_action.id
    retried = execute(client, race_plan.action_id, user_id)
    check(
        "17 finalize 경합 후 Event 재사용",
        first_result.data["recorded"] is True
        and retried.json()["action"]["status"] == "completed"
        and retried.json()["action"]["result"]["data"]["recorded"] is False
        and event_count(race_db_id) == 1,
    )

    print(f"TEST_RUN_ID={RUN_ID}")
    print(f"TEST_USER_ID={user_id}")
    print(f"SUMMARY={PASSED}/17")


if __name__ == "__main__":
    run()
