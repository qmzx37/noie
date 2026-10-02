"""record_dream_goal을 실제 PostgreSQL에서 검증합니다."""

import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))

import main
from agent.executor_registry import ExecutorContext, register_executor
from agent.executor_service import _acquire_lease, _finish_failure
from agent.record_dream_goal_executor import record_dream_goal_executor
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal
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


def plan(statement: str, kind: str = "goal"):
    action = GatewayAction(type="dream_goal", intent="record_dream_goal", mode="record", reason="현재 장기 목표 선언", confidence=0.92, requires_confirmation=False, execution_order=1, arguments={"statement": statement, "kind": kind})
    return create_tool_plan(ToolPlanRequest(actions=[action])).plans[0]


def fail() -> None:
    raise RuntimeError("injected dream goal fault")


def action_and_rows(action_id):
    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == action_id))
        rows = list(db.scalars(select(DreamGoal).where(DreamGoal.agent_action_id == action.id)).all())
        return action, rows


def run() -> None:
    with SessionLocal() as db:
        user = User(name=f"__dream_goal_test__{RUN_ID}", metadata_={"test": RUN_ID})
        other = User(name=f"__dream_goal_other__{RUN_ID}", metadata_={"test": RUN_ID})
        db.add_all([user, other]); db.flush()
        conversation = Conversation(user_id=user.id, title=RUN_ID, metadata_={})
        other_conversation = Conversation(user_id=other.id, title=RUN_ID, metadata_={})
        db.add_all([conversation, other_conversation]); db.flush()
        message = Message(conversation_id=conversation.id, user_id=user.id, role="user", content="내 목표는 NOIE를 완성하는 거야", metadata_={})
        other_message = Message(conversation_id=other_conversation.id, user_id=other.id, role="user", content="다른 사람 목표", metadata_={})
        db.add_all([message, other_message]); db.commit()
        user_id, other_id, conversation_id, message_id, other_message_id = user.id, other.id, conversation.id, message.id, other_message.id

    client = TestClient(main.app)
    first = plan("NOIE를 완성해 사람의 기억을 돕는 서비스를 만들고 싶다")
    saved = client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(message_id), "plans": [first.model_dump(mode="json")]})
    executed = client.post(f"/agent/actions/{first.action_id}/execute", json={"user_id": str(user_id)})
    check("1 action 완료", saved.status_code == 201 and executed.json()["action"]["status"] == "completed")
    with SessionLocal() as db:
        rows = list(db.scalars(select(DreamGoal).where(DreamGoal.user_id == user_id)).all())
        item = rows[0]
    check("2 Dream Goal 1건", len(rows) == 1)
    check("3 필드와 원문 연결", item.statement.startswith("NOIE를 완성해") and item.kind == "goal" and item.message_id == message_id)
    repeated = client.post(f"/agent/actions/{first.action_id}/execute", json={"user_id": str(user_id)})
    with SessionLocal() as db: count = db.scalar(select(func.count(DreamGoal.id)).where(DreamGoal.user_id == user_id))
    check("4 completed 재호출 중복 없음", repeated.json()["executor_called"] is False and count == 1)

    second = plan("NOIE를 완성해 사람의 기억을 돕는 서비스를 만들고 싶다")
    client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(message_id), "plans": [second.model_dump(mode="json")]})
    client.post(f"/agent/actions/{second.action_id}/execute", json={"user_id": str(user_id)})
    with SessionLocal() as db: count = db.scalar(select(func.count(DreamGoal.id)).where(DreamGoal.user_id == user_id))
    check("5 다른 action의 같은 진술 허용", count == 2)

    third = plan("언젠가 나만의 연구소를 만들고 싶다", "dream")
    client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(message_id), "plans": [third.model_dump(mode="json")]})
    responses = []; barrier = threading.Barrier(2)
    def execute_concurrently():
        barrier.wait(); responses.append(TestClient(main.app).post(f"/agent/actions/{third.action_id}/execute", json={"user_id": str(user_id)}))
    threads = [threading.Thread(target=execute_concurrently) for _ in range(2)]
    [thread.start() for thread in threads]; [thread.join() for thread in threads]
    with SessionLocal() as db: third_count = db.scalar(select(func.count(DreamGoal.id)).where(DreamGoal.user_id == user_id, DreamGoal.statement == "언젠가 나만의 연구소를 만들고 싶다"))
    check("6 동시 실행 중복 없음", third_count == 1 and sorted(response.status_code for response in responses) == [200, 409])
    check("7 타 사용자 실행 차단", client.post(f"/agent/actions/{first.action_id}/execute", json={"user_id": str(other_id)}).status_code == 404)
    invalid_owner = plan("내 목표")
    check("8 타 사용자 message 차단", client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(other_message_id), "plans": [invalid_owner.model_dump(mode="json")]}).status_code == 400)
    missing = plan("내 꿈")
    check("9 없는 message 차단", client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(uuid4()), "plans": [missing.model_dump(mode="json")]}).status_code == 400)
    listed = client.get(f"/users/{user_id}/dream-goals")
    detail = client.get(f"/dream-goals/{item.id}?user_id={user_id}")
    check("10 목록/상세 조회", listed.status_code == 200 and detail.status_code == 200 and detail.json()["statement"] == item.statement)
    check("11 조회 소유권 차단", client.get(f"/dream-goals/{item.id}?user_id={other_id}").status_code == 404)
    check("12 db-health", client.get("/db-health").status_code == 200)
    with SessionLocal() as db:
        action_ids = list(db.scalars(select(AgentAction.id).where(AgentAction.action_id.in_([first.action_id, second.action_id, third.action_id]))).all())
        emotion_count = db.scalar(select(func.count(EmotionEvent.id)).where(EmotionEvent.agent_action_id.in_(action_ids)))
        daily_count = db.scalar(select(func.count(DailyLifeEvent.id)).where(DailyLifeEvent.agent_action_id.in_(action_ids)))
        check("13 기존 도메인 비간섭", emotion_count == 0 and daily_count == 0)

    # INSERT 직전 예외는 도메인 row를 남기지 않고 공통 계층에서 정제된 failed가 됩니다.
    insert_fault = plan("실패 주입 전용 목표")
    client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(message_id), "plans": [insert_fault.model_dump(mode="json")]})
    register_executor("record_dream_goal", lambda context: record_dream_goal_executor(context, before_insert=fail))
    insert_response = client.post(f"/agent/actions/{insert_fault.action_id}/execute", json={"user_id": str(user_id)})
    insert_action, insert_rows = action_and_rows(insert_fault.action_id)
    check("14 INSERT failure rollback", insert_response.json()["action"]["status"] == "failed" and insert_action.error_message == "executor_failed:RuntimeError" and len(insert_rows) == 0)

    # INSERT 뒤 commit 직전 예외도 Session context rollback으로 partial row를 남기지 않습니다.
    commit_fault = plan("커밋 실패 주입 전용 꿈", "dream")
    client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(message_id), "plans": [commit_fault.model_dump(mode="json")]})
    register_executor("record_dream_goal", lambda context: record_dream_goal_executor(context, before_commit=fail))
    commit_response = client.post(f"/agent/actions/{commit_fault.action_id}/execute", json={"user_id": str(user_id)})
    commit_action, commit_rows = action_and_rows(commit_fault.action_id)
    check("15 commit failure rollback", commit_response.json()["action"]["status"] == "failed" and commit_action.error_message == "executor_failed:RuntimeError" and len(commit_rows) == 0)

    # 도메인 commit 뒤 finalize가 유실된 상태를 만들고 만료 lease로 재시도합니다.
    register_executor("record_dream_goal", record_dream_goal_executor)
    finalize_loss = plan("파이널라이즈 유실 재시도 목표")
    client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(message_id), "plans": [finalize_loss.model_dump(mode="json")]})
    _, old_lease = _acquire_lease(finalize_loss.action_id, user_id)
    first_result = record_dream_goal_executor(ExecutorContext(action_id=str(old_lease.action_id), user_id=str(user_id), tool_name=old_lease.tool_name or "", attempt_count=old_lease.attempt_count))
    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == finalize_loss.action_id))
        action.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    retry_response = client.post(f"/agent/actions/{finalize_loss.action_id}/execute", json={"user_id": str(user_id)})
    final_action, final_rows = action_and_rows(finalize_loss.action_id)
    check("16 finalize loss 기존 row 재사용", first_result.data["recorded"] is True and retry_response.json()["action"]["result"]["data"]["recorded"] is False and len(final_rows) == 1)
    check("17 retry 정상 완료", final_action.status == "completed" and final_action.attempt_count == 2)

    # 늦게 돌아온 이전 attempt는 최신 completed 결과를 덮어쓸 수 없습니다.
    fenced_action, fenced = _finish_failure(old_lease, RuntimeError("late stale worker"))
    check("18 stale attempt fencing", fenced is True and fenced_action.status == "completed" and fenced_action.attempt_count == 2)
    restart_response = TestClient(main.app).post(f"/agent/actions/{finalize_loss.action_id}/execute", json={"user_id": str(user_id)})
    _, restart_rows = action_and_rows(finalize_loss.action_id)
    check("19 restart-like completed 재사용", restart_response.json()["executor_called"] is False and len(restart_rows) == 1)

    with SessionLocal() as db:
        fault_action_ids = list(db.scalars(select(AgentAction.id).where(AgentAction.action_id.in_([insert_fault.action_id, commit_fault.action_id, finalize_loss.action_id]))).all())
        emotion_fault_count = db.scalar(select(func.count(EmotionEvent.id)).where(EmotionEvent.agent_action_id.in_(fault_action_ids)))
        daily_fault_count = db.scalar(select(func.count(DailyLifeEvent.id)).where(DailyLifeEvent.agent_action_id.in_(fault_action_ids)))
    check("20 fault 도메인 비간섭", emotion_fault_count == 0 and daily_fault_count == 0)
    print(f"TEST_USER_ID={user_id}")
    print(f"SUMMARY={passed}/20")


if __name__ == "__main__": run()
