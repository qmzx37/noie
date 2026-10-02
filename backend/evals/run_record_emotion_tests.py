"""실제 PostgreSQL에서 record_emotion v0.1을 검증합니다."""

from __future__ import annotations

import sys
import threading
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402
from agent.emotion_schemas import EmotionRecordArguments  # noqa: E402
from agent.tool_gateway import create_tool_plan  # noqa: E402
from agent.tool_schemas import GatewayAction, ToolPlanRequest  # noqa: E402
from database import SessionLocal  # noqa: E402
from models.agent_action import AgentAction  # noqa: E402
from models.conversation import Conversation  # noqa: E402
from models.emotion_event import EmotionEvent  # noqa: E402
from models.message import Message  # noqa: E402
from models.user import User  # noqa: E402


RUN_ID = uuid4().hex
PREFIX = f"__noie_record_emotion_test__{RUN_ID}"
PASSED = 0
AXIS = {"F": 0.11, "A": 0.22, "D": 0.33, "J": 0.74, "C": 0.45, "G": 0.36, "T": 0.82, "R": 0.28, "confidence": 0.91}


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        raise AssertionError(f"{name}: {detail}")
    PASSED += 1
    print(f"[PASS] {name}: {detail}")


def emotion_plan(arguments=AXIS):
    action = GatewayAction(
        type="emotion",
        intent="record_emotion",
        mode="record",
        reason="현재 발화의 순간 감정 기록",
        confidence=0.91,
        requires_confirmation=False,
        execution_order=1,
        arguments=arguments,
    )
    return create_tool_plan(ToolPlanRequest(actions=[action])).plans[0]


def persist(client, user_id, conversation_id, message_id, plan):
    return client.post(
        "/agent/actions/plan",
        json={
            "user_id": str(user_id),
            "conversation_id": str(conversation_id),
            "message_id": str(message_id),
            "plans": [plan.model_dump(mode="json")],
        },
    )


def execute(client, action_id, user_id):
    return client.post(f"/agent/actions/{action_id}/execute", json={"user_id": str(user_id)})


def event_count(action_db_id) -> int:
    with SessionLocal() as db:
        return db.scalar(
            select(func.count(EmotionEvent.id)).where(EmotionEvent.agent_action_id == action_db_id)
        ) or 0


def run() -> None:
    with SessionLocal() as db:
        user = User(name=PREFIX, metadata_={"test_run": RUN_ID})
        other = User(name=f"{PREFIX}:other", metadata_={"test_run": RUN_ID})
        db.add_all([user, other])
        db.flush()
        conversation = Conversation(user_id=user.id, title=PREFIX, metadata_={"test_run": RUN_ID})
        other_conversation = Conversation(user_id=other.id, title=PREFIX, metadata_={"test_run": RUN_ID})
        db.add_all([conversation, other_conversation])
        db.flush()
        message = Message(conversation_id=conversation.id, user_id=user.id, role="user", content="발표 전에 긴장했지만 끝나고 기분이 좋았어.", metadata_={"test_run": RUN_ID})
        other_message = Message(conversation_id=other_conversation.id, user_id=other.id, role="user", content="다른 사용자 원문", metadata_={"test_run": RUN_ID})
        db.add_all([message, other_message])
        db.commit()
        user_id, other_id = user.id, other.id
        conversation_id, message_id, other_message_id = conversation.id, message.id, other_message.id

    client = TestClient(main.app)
    plan = emotion_plan()
    saved_response = persist(client, user_id, conversation_id, message_id, plan)
    saved = saved_response.json()[0]
    executed = execute(client, saved["action_id"], user_id)
    body = executed.json()
    check("1 emotion action completed", saved_response.status_code == 201 and body["action"]["status"] == "completed")

    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == plan.action_id))
        event = db.scalar(select(EmotionEvent).where(EmotionEvent.agent_action_id == action.id))
        action_db_id = action.id
        check("2 Emotion Event row 생성", event is not None)
        stored_axis = {key: getattr(event, key.lower()) for key in "FADJCGTR"}
        check("3 8축 정확히 저장", all(stored_axis[key] == AXIS[key] for key in stored_axis), str(stored_axis))
        check("4 message evidence 연결", event.message_id == message_id)
        check("5 user 연결", event.user_id == user_id)
        check("6 Agent Action 연결", event.agent_action_id == action.id)

    repeated = execute(client, saved["action_id"], user_id)
    check("7 동일 action event 중복 없음", event_count(action_db_id) == 1)
    check("8 completed result 재사용", repeated.json()["executor_called"] is False and repeated.json()["action"]["result"] == body["action"]["result"])

    concurrent_plan = emotion_plan({**AXIS, "J": 0.8})
    concurrent_saved = persist(client, user_id, conversation_id, message_id, concurrent_plan).json()[0]
    responses = []
    barrier = threading.Barrier(2)

    def concurrent_execute():
        barrier.wait()
        responses.append(execute(TestClient(main.app), concurrent_saved["action_id"], user_id))

    threads = [threading.Thread(target=concurrent_execute) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
    with SessionLocal() as db:
        concurrent_action = db.scalar(select(AgentAction).where(AgentAction.action_id == concurrent_plan.action_id))
    check("9 동시 실행 event 1개", event_count(concurrent_action.id) == 1 and sorted(response.status_code for response in responses) == [200, 409])

    owned_plan = emotion_plan()
    owned = persist(client, user_id, conversation_id, message_id, owned_plan).json()[0]
    check("10 다른 사용자 action 실행 차단", execute(client, owned["action_id"], other_id).status_code == 404)

    wrong_owner = persist(client, user_id, conversation_id, other_message_id, emotion_plan())
    check("11 다른 사용자 message 연결 차단", wrong_owner.status_code == 400)
    missing_message = persist(client, user_id, conversation_id, uuid4(), emotion_plan())
    check("12 존재하지 않는 message 차단", missing_message.status_code == 400)

    base_action = {
        "type": "emotion", "intent": "record_emotion", "mode": "record",
        "reason": "validation", "confidence": 0.9, "requires_confirmation": False,
        "execution_order": 1,
    }
    invalid_low = client.post("/agent/tool-plan", json={"actions": [{**base_action, "arguments": {**AXIS, "F": -0.1}}]})
    invalid_high = client.post("/agent/tool-plan", json={"actions": [{**base_action, "arguments": {**AXIS, "A": 1.1}}]})
    check("13 0 미만 validation", invalid_low.status_code == 422)
    check("14 1 초과 validation", invalid_high.status_code == 422)

    for non_finite in (float("nan"), float("inf"), float("-inf")):
        try:
            EmotionRecordArguments.model_validate({**AXIS, "D": non_finite})
            finite_rejected = False
        except ValueError:
            finite_rejected = True
        check(f"15 non-finite {non_finite} 차단", finite_rejected)

    confidence_low = client.post("/agent/tool-plan", json={"actions": [{**base_action, "arguments": {**AXIS, "confidence": -0.1}}]})
    confidence_high = client.post("/agent/tool-plan", json={"actions": [{**base_action, "arguments": {**AXIS, "confidence": 1.1}}]})
    check("16 confidence 범위", confidence_low.status_code == 422 and confidence_high.status_code == 422)

    with SessionLocal() as db:
        invalid_action = AgentAction(
            user_id=user_id, conversation_id=conversation_id, message_id=message_id,
            action_id=uuid4(), tool_name="record_emotion", action_type="emotion",
            intent="record_emotion", mode="record", status="ready", confidence=0.9,
            requires_confirmation=False, execution_order=1, idempotency_key=uuid4().hex,
            confirmation_status="not_required", attempt_count=0,
            arguments={"F": 0.2}, metadata_={"test_run": RUN_ID},
        )
        db.add(invalid_action)
        db.commit()
        invalid_action_id, invalid_db_id = invalid_action.action_id, invalid_action.id
    failed = execute(client, invalid_action_id, user_id)
    check("17 executor 실패 partial row 없음", failed.json()["action"]["status"] == "failed" and event_count(invalid_db_id) == 0)
    check("18 domain commit 불일치 최소화", failed.json()["can_retry"] is True and failed.json()["action"]["result"] is None)

    restarted = execute(TestClient(main.app), saved["action_id"], user_id)
    check("19 재시작 후 completed 중복 없음", restarted.json()["executor_called"] is False and event_count(action_db_id) == 1)

    test_action = AgentAction(
        user_id=user_id, action_id=uuid4(), tool_name="test_success_tool", action_type="emotion",
        intent="test", mode="record", status="ready", confidence=1.0,
        requires_confirmation=False, execution_order=1, idempotency_key=uuid4().hex,
        confirmation_status="not_required", attempt_count=0, metadata_={"test_run": RUN_ID},
    )
    with SessionLocal() as db:
        db.add(test_action)
        db.commit()
        test_action_id = test_action.action_id
    test_result = execute(client, test_action_id, user_id)
    check("20 test executor 영향 없음", test_result.json()["action"]["status"] == "completed")

    print(f"TEST_RUN_ID={RUN_ID}")
    print(f"TEST_USER_ID={user_id}")
    print(f"SUMMARY={PASSED}/22")


if __name__ == "__main__":
    run()
