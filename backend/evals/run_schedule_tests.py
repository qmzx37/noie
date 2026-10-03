"""Schedule v0.1의 입력 검증, 실제 PostgreSQL, 확인 흐름, 선택적 OpenAI 평가입니다."""

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import threading
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, text as sql_text

import main
import chat_agent_integration_service as integration
from agent.create_schedule_executor import create_schedule_executor
from agent.executor_registry import ExecutorContext, register_executor
from agent.executor_service import _acquire_lease, _finish_failure, _finish_success
from agent.orchestrator import orchestrate_with_openai, schedule_time_context
from agent.schedule_schemas import CreateScheduleArguments
from agent.schemas import OrchestratorAction, OrchestratorResult
from agent.tool_gateway import create_tool_plan
from agent.tool_registry import find_tool
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal
from emotion_analyzer import analyze_with_rules
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.schedule import Schedule
from models.user import User

PASSED = 0


def check(name, condition):
    """확인 항목을 출력하고 실패를 명시적으로 중단합니다."""
    global PASSED
    if not condition:
        raise AssertionError(name)
    PASSED += 1
    print(f"[PASS] {name}", flush=True)


def arguments():
    """테스트 실행일과 무관하게 미래의 offset 포함 시각을 만듭니다."""
    return {"title": "운동", "start_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(), "end_at": None}


def plan(confidence=.95, confirmation=True):
    """기존 Gateway로 일정 execute 후보를 만듭니다."""
    return create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
        type="schedule", intent="create_schedule", mode="execute", reason="명시적 미래 일정",
        confidence=confidence, requires_confirmation=confirmation, execution_order=1,
        arguments=arguments(),
    )])).plans[0]


def rows(action_id):
    """Action과 해당 일정만 새 세션에서 조회합니다."""
    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == action_id))
        schedules = list(db.scalars(select(Schedule).where(Schedule.agent_action_id == action.id)).all())
        return action, schedules


def preserve_snapshot():
    """기존 Emotion/Daily/Dream/Memory 원문과 구조의 전후 지문을 비교합니다."""
    with SessionLocal() as db:
        return {
            table: db.execute(sql_text(
                f"SELECT count(*), md5(coalesce(string_agg(md5(row_to_json(snapshot_row)::text), '' ORDER BY id), '')) FROM {table} snapshot_row"
            )).one()
            for table in ("emotion_events", "daily_life_events", "dream_goals", "memories", "memory_evidence")
        }


def fail():
    """외부 오류 전문이 사용자/DB에 노출되지 않는지 함께 검사합니다."""
    raise RuntimeError("injected schedule fault: private details")


def run_database():
    """분리된 테스트 사용자로 일정 transaction과 API를 검증합니다."""
    baseline = preserve_snapshot()
    client = TestClient(main.app)
    with SessionLocal() as db:
        run_id = uuid4().hex
        user = User(name=f"__schedule_v1__{run_id}", metadata_={"test": run_id})
        other = User(name=f"__schedule_other__{run_id}", metadata_={"test": run_id})
        db.add_all([user, other]); db.flush()
        conversation = Conversation(user_id=user.id, title=run_id, metadata_={})
        db.add(conversation); db.flush()
        message = Message(user_id=user.id, conversation_id=conversation.id, role="user", content="내일 오후 3시에 운동할 거야.", metadata_={"test": run_id})
        db.add(message); db.commit()
        uid, oid, cid, mid = user.id, other.id, conversation.id, message.id

    def save(item):
        """기존 Action Persistence API를 통해 계획을 저장합니다."""
        result = client.post("/agent/actions/plan", json={"user_id": str(uid), "conversation_id": str(cid), "message_id": str(mid), "plans": [item.model_dump(mode="json")]})
        assert result.status_code == 201, result.text
        return result.json()[0]

    def confirm(item):
        """기존 confirmation_id 기반 승인 API를 사용합니다."""
        response = client.post(f"/agent/actions/{item['action_id']}/confirm", json={"user_id": str(uid), "confirmation_id": item["confirmation_id"]})
        assert response.status_code == 200 and response.json()["status"] == "ready", response.text

    def execute(action_id):
        """기존 Common Executor API로 실행합니다."""
        return client.post(f"/agent/actions/{action_id}/execute", json={"user_id": str(uid)})

    first = plan(); saved = save(first)
    check("01 candidate pending / schedule zero", saved["status"] == "pending_confirmation" and len(rows(first.action_id)[1]) == 0)
    check("02 execute before confirm blocked", execute(first.action_id).status_code == 409)
    wrong = client.post(f"/agent/actions/{first.action_id}/confirm", json={"user_id": str(uid), "confirmation_id": str(uuid4())})
    check("03 wrong confirmation blocked", wrong.status_code == 403)
    confirm(saved); result = execute(first.action_id)
    action, records = rows(first.action_id)
    check("04 approved execute creates one", result.status_code == 200 and action.status == "completed" and len(records) == 1)
    schedule = records[0]
    check("05 exact structured fields / evidence", schedule.title == "운동" and schedule.user_id == uid and schedule.conversation_id == cid and schedule.message_id == mid and schedule.start_at == first.arguments.start_at and schedule.end_at is None)
    duplicate = execute(first.action_id)
    check("06 completed reuse / same id", not duplicate.json()["executor_called"] and len(rows(first.action_id)[1]) == 1 and duplicate.json()["action"]["result"]["data"]["schedule_id"] == str(schedule.id))
    check("07 gateway forces confirmation", plan(confirmation=False).requires_confirmation and plan(confirmation=False).status == "pending_confirmation")
    check("08 low confidence held", plan(confidence=.79).status == "needs_review")
    check("09 update/delete planning preserved", not find_tool("schedule", "update_schedule").implemented and not find_tool("schedule", "delete_schedule").implemented)

    concurrent = plan(); confirm(save(concurrent)); responses = []; errors = []; barrier = threading.Barrier(2)
    def worker():
        """동시에 실행하더라도 worker 예외를 테스트에서 놓치지 않습니다."""
        try:
            barrier.wait(timeout=10)
            responses.append(TestClient(main.app).post(f"/agent/actions/{concurrent.action_id}/execute", json={"user_id": str(uid)}))
        except Exception as error:
            errors.append(error)
    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=60)
    check("10 concurrent one row", not errors and not any(thread.is_alive() for thread in threads) and len(responses) == 2 and all(response.status_code in {200,409} for response in responses) and len(rows(concurrent.action_id)[1]) == 1)
    check("11 other user read blocked", client.get(f"/schedules/{schedule.id}", params={"user_id": str(oid)}).status_code == 404)
    check("12 read/list APIs", client.get(f"/schedules/{schedule.id}", params={"user_id": str(uid)}).status_code == 200 and len(client.get(f"/users/{uid}/schedules").json()) == 2)
    check("13 other user execute blocked", client.post(f"/agent/actions/{first.action_id}/execute", json={"user_id": str(oid)}).status_code == 404)

    try:
        for number, hook in ((14, "before_insert"), (15, "before_commit")):
            faulty = plan(); confirm(save(faulty))
            register_executor("create_schedule", lambda context, hook=hook: create_schedule_executor(context, **{hook: fail}))
            failed = execute(faulty.action_id); faulty_action, faulty_records = rows(faulty.action_id)
            check(f"{number} {hook} rollback", failed.status_code == 200 and faulty_action.status == "failed" and faulty_action.error_message == "executor_failed:RuntimeError" and len(faulty_records) == 0)
    finally:
        register_executor("create_schedule", create_schedule_executor)

    lost = plan(); confirm(save(lost))
    _, lease = _acquire_lease(lost.action_id, uid)
    context = ExecutorContext(str(lease.action_id), str(uid), "create_schedule", lease.attempt_count)
    initial = create_schedule_executor(context)
    check("16 domain commit before finalize", initial.data["created"] and rows(lost.action_id)[0].status == "processing" and len(rows(lost.action_id)[1]) == 1)
    with SessionLocal() as db:
        stale = db.scalar(select(AgentAction).where(AgentAction.action_id == lost.action_id))
        stale.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    recovered = execute(lost.action_id)
    recovered_action, recovered_rows = rows(lost.action_id)
    check("17 lost finalize retry reuses row", recovered.status_code == 200 and recovered_action.status == "completed" and recovered_action.attempt_count == 2 and not recovered.json()["action"]["result"]["data"]["created"] and len(recovered_rows) == 1 and initial.data["schedule_id"] == str(recovered_rows[0].id))
    _, success_fenced = _finish_success(lease, initial)
    _, failure_fenced = _finish_failure(lease, RuntimeError("old worker"))
    check("18 old success/failure fenced", success_fenced and failure_fenced and rows(lost.action_id)[0].status == "completed")
    restart = TestClient(main.app).post(f"/agent/actions/{lost.action_id}/execute", json={"user_id": str(uid)})
    check("19 restart-like reuse", restart.status_code == 200 and not restart.json()["executor_called"] and len(rows(lost.action_id)[1]) == 1)

    # chat/OpenAI 응답은 고정하지만 background -> Gateway -> DB 확인 흐름은 실제 호출합니다.
    def route(text, memories=None, **kwargs):
        """정확한 현재 Message와 시각이 전달됐는지 확인합니다."""
        assert text == "내일 오후 3시에 운동할 거야."
        assert kwargs["reference_time"].tzinfo is not None
        return OrchestratorResult(needs_action=True, actions=[OrchestratorAction(type="schedule", intent="create_schedule", mode="execute", reason="일정", confidence=.95, requires_confirmation=True, execution_order=1, arguments=arguments())])
    import os
    with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(uid), "NOIE_DEV_CONVERSATION_ID": str(cid)}), \
        patch.object(integration, "orchestrate_with_openai", route), \
        patch.object(integration, "retrieve_relevant_memories_safe", lambda *args: []), \
        patch.object(main, "retrieve_relevant_memories_safe", lambda *args: []), \
        patch.object(main, "analyze_text", lambda text: (main.build_response(text, analyze_with_rules(text), "rule_based"), "rule_based")), \
        patch.object(main, "generate_chat_reply_with_openai", lambda **kwargs: "일정 후보를 확인해 주세요."), \
        patch.object(main, "run_memory_extraction_background", lambda *args: None):
        request_id = uuid4(); body = {"text": "내일 오후 3시에 운동할 거야.", "request_id": str(request_id)}
        response = client.post("/chat", json=body)
        with SessionLocal() as db:
            evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == str(request_id)))
            chat_actions = list(db.scalars(select(AgentAction).where(AgentAction.message_id == evidence.id)).all())
        check("20 /chat pending only", response.status_code == 200 and len(chat_actions) == 1 and chat_actions[0].status == "pending_confirmation" and len(rows(chat_actions[0].action_id)[1]) == 0)
        repeat = client.post("/chat", json=body)
        with SessionLocal() as db:
            chat_actions_after = list(db.scalars(select(AgentAction).where(AgentAction.message_id == evidence.id)).all())
        check("21 /chat idempotency", repeat.status_code == 200 and len(chat_actions_after) == 1 and rows(chat_actions_after[0].action_id)[0].confirmation_id == chat_actions[0].confirmation_id)
    check("22 existing domains unchanged", preserve_snapshot() == baseline)
    check("23 db-health", client.get("/db-health").status_code == 200)
    print(f"TEST_USER_ID={uid}", flush=True)


def run_validation():
    """DB 쓰기 없이 잘못된 시각/제목과 timezone 부재를 검사합니다."""
    bad_values = [
        {**arguments(), "title": "   "},
        {**arguments(), "title": "x" * 121},
        {**arguments(), "start_at": "2030-10-03T15:00:00"},
        {**arguments(), "end_at": "2020-01-01T00:00:00Z"},
        {**arguments(), "unexpected": "x"},
    ]
    for index, value in enumerate(bad_values):
        try:
            CreateScheduleArguments.model_validate(value)
        except ValidationError:
            check(f"validation {index + 1}", True)
        else:
            raise AssertionError(value)
    import os
    with patch.dict(os.environ, {"NOIE_SCHEDULE_TIMEZONE": ""}):
        check("timezone unset has no guessed user zone", schedule_time_context()["timezone"] is None)
    with patch.dict(os.environ, {"NOIE_SCHEDULE_TIMEZONE": "Asia/Seoul"}):
        check("explicit timezone context", schedule_time_context()["reference_datetime"].endswith("+09:00"))


def run_routing():
    """실제 OpenAI로 구체 일정과 질문/부정/기존 도메인 경계를 확인합니다."""
    import os
    reference = datetime.now(timezone.utc)
    cases = [
        ("내일 오후 3시에 운동할 거야.", True, None),
        ("10월 10일 오전 9시에 병원 가야 해.", True, None),
        ("오늘 운동했어.", False, "daily_life"),
        ("내일 운동할 거야.", False, None),
        ("내일 운동할까?", False, None),
        ("AI 개발자가 되는 게 목표야.", False, "dream_goal"),
        ("내일 오후 3시에 운동 안 할 거야.", False, None),
        ("내일 뭐 하지?", False, None),
    ]
    with patch.dict(os.environ, {"NOIE_SCHEDULE_TIMEZONE": "Asia/Seoul"}):
        for index, (text, expected, domain) in enumerate(cases, 1):
            result = orchestrate_with_openai(text, reference_time=reference)
            schedules = [action for action in result.actions if action.intent == "create_schedule"]
            if bool(schedules) != expected or (domain is not None and not any(action.type == domain for action in result.actions)):
                print("ROUTING_MISMATCH", result.model_dump_json(), flush=True)
            check(f"live routing {index}", bool(schedules) == expected and (domain is None or any(action.type == domain for action in result.actions)))
            if schedules:
                args = schedules[0].arguments
                check(f"live datetime {index}", isinstance(args, CreateScheduleArguments) and args.start_at > reference and schedules[0].requires_confirmation)
                if index == 1:
                    from zoneinfo import ZoneInfo
                    expected_day = reference.astimezone(ZoneInfo("Asia/Seoul")).date() + timedelta(days=1)
                    local = args.start_at.astimezone(ZoneInfo("Asia/Seoul"))
                    check("tomorrow 15:00 exact", local.date() == expected_day and local.hour == 15 and local.minute == 0)
    with patch.dict(os.environ, {"NOIE_SCHEDULE_TIMEZONE": ""}):
        result = orchestrate_with_openai("내일 오후 3시에 운동할 거야.", reference_time=reference)
        check("live timezone missing holds candidate", all(action.arguments is None and action.confidence < .8 for action in result.actions if action.intent == "create_schedule"))


def run_live_chat():
    """실제 chat 응답과 Orchestrator 호출로 확인 대기 저장을 끝까지 확인합니다."""
    import os
    with SessionLocal() as db:
        run_id = uuid4().hex
        user = User(name=f"__schedule_live_chat__{run_id}", metadata_={"test": run_id})
        db.add(user); db.flush()
        conversation = Conversation(user_id=user.id, title=run_id, metadata_={})
        db.add(conversation); db.commit()
        uid, cid = user.id, conversation.id
    # Memory 추출만 생략해 이 테스트는 새 일정 후보의 증거 연결에 집중합니다.
    with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(uid), "NOIE_DEV_CONVERSATION_ID": str(cid), "NOIE_SCHEDULE_TIMEZONE": "Asia/Seoul"}), \
        patch.object(main, "run_memory_extraction_background", lambda *args: None):
        client = TestClient(main.app)
        request_id = uuid4()
        body = {"text": "내일 오후 3시에 운동할 거야.", "request_id": str(request_id)}
        response = client.post("/chat", json=body)
        with SessionLocal() as db:
            evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == str(request_id)))
            actions = list(db.scalars(select(AgentAction).where(AgentAction.message_id == evidence.id, AgentAction.tool_name == "create_schedule")).all())
        check("live /chat OpenAI response", response.status_code == 200 and response.json()["source"] == "openai" and bool(response.json()["reply"]))
        check("live /chat schedule pending without insert", len(actions) == 1 and actions[0].status == "pending_confirmation" and len(rows(actions[0].action_id)[1]) == 0)
        repeated = client.post("/chat", json=body)
        check("live /chat cached response reuse", repeated.status_code == 200 and repeated.json() == response.json())
        print(f"LIVE_CHAT_USER_ID={uid}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-routing", action="store_true")
    parser.add_argument("--routing-only", action="store_true")
    parser.add_argument("--live-chat-only", action="store_true")
    parsed = parser.parse_args()
    if not parsed.routing_only and not parsed.live_chat_only:
        run_validation()
        run_database()
    if parsed.live_routing or parsed.routing_only:
        run_routing()
    if parsed.live_routing or parsed.live_chat_only:
        run_live_chat()
    print(f"SUMMARY={PASSED} passed", flush=True)
