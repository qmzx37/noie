"""실제 PostgreSQL에서 /chat과 세 record Tool의 자동 연결을 검증합니다."""

import os
import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))

import main
import chat_agent_integration_service as integration
from agent.executor_registry import register_executor
from agent.record_daily_trace_executor import record_daily_trace_executor
from agent.schemas import OrchestratorAction, OrchestratorResult
from database import SessionLocal
from emotion_analyzer import analyze_with_rules
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.daily_life_event import DailyLifeEvent
from models.dream_goal import DreamGoal
from models.emotion_event import EmotionEvent
from models.message import Message
from models.user import User


RUN_ID = uuid4().hex
passed = 0


def check(name: str, condition: bool) -> None:
    global passed
    if not condition: raise AssertionError(name)
    passed += 1
    print(f"[PASS] {name}")


def emotion(order: int = 1) -> OrchestratorAction:
    return OrchestratorAction(type="emotion", intent="record_emotion", mode="record", reason="명시적 기쁨", confidence=.9, requires_confirmation=False, execution_order=order, arguments={"F":0,"A":0,"D":0,"J":.9,"C":.1,"G":.1,"T":0,"R":.6,"confidence":.9})


def daily(order: int = 1) -> OrchestratorAction:
    return OrchestratorAction(type="daily_life", intent="record_daily_trace", mode="record", reason="완료 행동", confidence=.9, requires_confirmation=False, execution_order=order, arguments={"summary":"오늘 운동함","category":"activity"})


def dream(order: int = 1) -> OrchestratorAction:
    return OrchestratorAction(type="dream_goal", intent="record_dream_goal", mode="record", reason="명시적 목표", confidence=.9, requires_confirmation=False, execution_order=order, arguments={"statement":"AI 개발자가 되는 것이 목표다","kind":"goal"})


def fake_orchestrate(text: str, memories=None, *, reference_time=None) -> OrchestratorResult:
    del memories
    mapping = {
        "오늘 기분이 좋아.": [emotion()],
        "오늘 운동했어.": [daily()],
        "오늘 운동했고 기분도 좋아.": [daily(1), emotion(2)],
        "AI 개발자가 되는 게 내 목표야.": [dream()],
        "내일 운동할 거야.": [],
        "세 도메인 격리 테스트": [emotion(1), daily(2), dream(3)],
    }
    actions = mapping.get(text, [])
    return OrchestratorResult(needs_action=bool(actions), actions=actions)


def counts_for_request(request_id):
    with SessionLocal() as db:
        message = db.scalar(select(Message).where(Message.metadata_["request_id"].astext == str(request_id), Message.role == "user"))
        if message is None: return 0, 0, 0, 0, 0
        actions = list(db.scalars(select(AgentAction).where(AgentAction.message_id == message.id)).all())
        ids = [action.id for action in actions]
        if not ids: return 0, 0, 0, 0, message.id
        return (
            len(actions),
            db.scalar(select(func.count(EmotionEvent.id)).where(EmotionEvent.agent_action_id.in_(ids))) or 0,
            db.scalar(select(func.count(DailyLifeEvent.id)).where(DailyLifeEvent.agent_action_id.in_(ids))) or 0,
            db.scalar(select(func.count(DreamGoal.id)).where(DreamGoal.agent_action_id.in_(ids))) or 0,
            message.id,
        )


def post(client: TestClient, text: str, request_id):
    return client.post("/chat", json={"text": text, "request_id": str(request_id), "messages": []})


def run() -> None:
    with SessionLocal() as db:
        user = User(name=f"__chat_agent_test__{RUN_ID}", metadata_={"test": RUN_ID}); db.add(user); db.flush()
        conversation = Conversation(user_id=user.id, title=RUN_ID, metadata_={}); db.add(conversation); db.commit()
        user_id, conversation_id = user.id, conversation.id
    old_user = os.environ.get("NOIE_DEV_USER_ID"); old_conversation = os.environ.get("NOIE_DEV_CONVERSATION_ID")
    os.environ["NOIE_DEV_USER_ID"] = str(user_id); os.environ["NOIE_DEV_CONVERSATION_ID"] = str(conversation_id)

    original_orchestrate = integration.orchestrate_with_openai
    original_retrieval = integration.retrieve_relevant_memories_safe
    original_analysis = main.analyze_text
    original_reply = main.generate_chat_reply_with_openai
    original_memory_task = main.run_memory_extraction_background
    try:
        integration.orchestrate_with_openai = fake_orchestrate
        integration.retrieve_relevant_memories_safe = lambda user, text: []
        main.analyze_text = lambda text: (main.build_response(text, analyze_with_rules(text), "rule_based"), "rule_based")
        main.generate_chat_reply_with_openai = lambda **kwargs: "테스트 assistant 답변"
        main.run_memory_extraction_background = lambda message_id: None
        client = TestClient(main.app)

        cases = [
            ("오늘 기분이 좋아.", (1,1,0,0)),
            ("오늘 운동했어.", (1,0,1,0)),
            ("오늘 운동했고 기분도 좋아.", (2,1,1,0)),
            ("AI 개발자가 되는 게 내 목표야.", (1,0,0,1)),
            ("내일 운동할 거야.", (0,0,0,0)),
        ]
        for index, (text, expected) in enumerate(cases, 1):
            request_id = uuid4(); response = post(client, text, request_id)
            actual = counts_for_request(request_id)[:4]
            check(f"{index} chat/domain routing", response.status_code == 200 and actual == expected)

        # Orchestrator 장애는 이미 완료된 user/assistant 원문과 chat 성공을 깨뜨리지 않습니다.
        integration.orchestrate_with_openai = lambda text, memories=None, **kwargs: (_ for _ in ()).throw(RuntimeError("forced"))
        failure_id = uuid4(); failure_response = post(client, "오케스트레이터 실패 테스트", failure_id)
        with SessionLocal() as db:
            message_count = db.scalar(select(func.count(Message.id)).where(Message.metadata_["request_id"].astext == str(failure_id)))
        check("6 orchestrator failure isolation", failure_response.status_code == 200 and message_count == 2 and counts_for_request(failure_id)[0] == 0)

        # Daily executor만 실패시켜도 앞뒤 Emotion/Dream transaction은 보존됩니다.
        integration.orchestrate_with_openai = fake_orchestrate
        register_executor("record_daily_trace", lambda context: (_ for _ in ()).throw(RuntimeError("forced daily")))
        isolation_id = uuid4(); isolation_response = post(client, "세 도메인 격리 테스트", isolation_id)
        isolated = counts_for_request(isolation_id)
        check("7 domain executor failure isolation", isolation_response.status_code == 200 and isolated[:4] == (3,1,0,1))
        register_executor("record_daily_trace", record_daily_trace_executor)

        duplicate_id = uuid4(); first = post(client, "오늘 운동했고 기분도 좋아.", duplicate_id); before = counts_for_request(duplicate_id)[:4]
        second = post(client, "오늘 운동했고 기분도 좋아.", duplicate_id); after = counts_for_request(duplicate_id)[:4]
        check("8 same request_id idempotency", first.status_code == 200 and second.status_code == 200 and before == after == (2,1,1,0))
        conflict = post(client, "다른 본문", duplicate_id)
        check("9 request_id text conflict", conflict.status_code == 409 and counts_for_request(duplicate_id)[:4] == after)
        print(f"TEST_USER_ID={user_id}")
        print(f"SUMMARY={passed}/9")
    finally:
        register_executor("record_daily_trace", record_daily_trace_executor)
        integration.orchestrate_with_openai = original_orchestrate
        integration.retrieve_relevant_memories_safe = original_retrieval
        main.analyze_text = original_analysis
        main.generate_chat_reply_with_openai = original_reply
        main.run_memory_extraction_background = original_memory_task
        if old_user is None: os.environ.pop("NOIE_DEV_USER_ID", None)
        else: os.environ["NOIE_DEV_USER_ID"] = old_user
        if old_conversation is None: os.environ.pop("NOIE_DEV_CONVERSATION_ID", None)
        else: os.environ["NOIE_DEV_CONVERSATION_ID"] = old_conversation


if __name__ == "__main__": run()
