"""Place v0.1의 실제 PostgreSQL fault 검증과 선택적 OpenAI/E2E 평가입니다."""

import argparse
from datetime import datetime, timedelta, timezone
import os
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
from sqlalchemy.exc import IntegrityError
import main
from agent.executor_registry import ExecutorContext, register_executor
from agent.executor_service import _acquire_lease, _finish_success, _finish_failure
from agent.orchestrator import orchestrate_with_openai
from agent.place_schemas import RecordPlaceEventArguments
from agent.record_place_event_executor import record_place_event_executor
from agent.schemas import OrchestratorMemoryContext
from agent.tool_gateway import create_tool_plan
from agent.tool_registry import find_tool
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.daily_life_event import DailyLifeEvent
from models.message import Message
from models.place_event import PlaceEvent
from models.user import User

PASSED = 0


def check(name, condition):
    """실패를 숨기지 않고 해당 항목에서 검증을 중단합니다."""
    global PASSED
    if not condition:
        raise AssertionError(name)
    PASSED += 1
    print(f"[PASS] {name}", flush=True)


def fixture():
    """실제 사용자와 명확히 분리된 새 테스트 사용자만 생성합니다."""
    with SessionLocal() as db:
        marker = uuid4().hex
        user = User(name=f"__place_v1__{marker}", metadata_={"test": marker})
        other = User(name=f"__place_other__{marker}", metadata_={"test": marker})
        db.add_all([user, other]); db.flush()
        conversation = Conversation(user_id=user.id, title=marker, metadata_={"test": marker})
        db.add(conversation); db.commit()
        print(f"TEST_USER_ID={user.id}", flush=True)
        return user.id, other.id, conversation.id


def message(uid, cid, content, role="user"):
    """원문을 변경하지 않고 테스트 근거로 저장합니다."""
    with SessionLocal() as db:
        item = Message(user_id=uid if role == "user" else None, conversation_id=cid,
                       role=role, content=content, metadata_={"test": "place-v1"})
        db.add(item); db.commit()
        return item.id


def plan(kind="visit", preference=None, confidence=.95):
    """실제 Gateway를 통해 record 후보를 만듭니다."""
    return create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
        type="place", intent="record_place_event", mode="record", reason="명시적 장소",
        confidence=confidence, requires_confirmation=False, execution_order=1,
        arguments={"place_name": "광안리", "kind": kind, "preference": preference, "occurred_at": None},
    )])).plans[0]


def save(client, uid, cid, mid, plans):
    """기존 Action Persistence API의 transaction을 사용합니다."""
    response = client.post("/agent/actions/plan", json={
        "user_id": str(uid), "conversation_id": str(cid), "message_id": str(mid),
        "plans": [item.model_dump(mode="json") for item in plans],
    })
    assert response.status_code == 201, response.text
    return response.json()


def execute(client, uid, action_id):
    """기존 Common Executor API로 실행합니다."""
    return client.post(f"/agent/actions/{action_id}/execute", json={"user_id": str(uid)})


def rows(action_id):
    """새 세션에서 저장된 Action과 Place를 확인합니다."""
    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == action_id))
        return action, list(db.scalars(select(PlaceEvent).where(PlaceEvent.agent_action_id == action.id)).all())


def snapshot():
    """기존 도메인 데이터의 전체 컬럼 지문을 비교합니다."""
    with SessionLocal() as db:
        return {
            table: db.execute(sql_text(
                f"SELECT count(*), md5(coalesce(string_agg(md5(row_to_json(snapshot_row)::text), '' ORDER BY id), '')) FROM {table} snapshot_row"
            )).one()
            for table in ("emotion_events", "daily_life_events", "dream_goals", "schedules", "memories", "memory_evidence")
        }


def fail():
    """오류 전문이 저장되지 않는지도 확인하는 fault hook입니다."""
    raise RuntimeError("private injected place fault")


def run_validation():
    """DB 쓰기 없이 입력 계약과 Gateway 경계를 검사합니다."""
    base = {"place_name": "광안리", "kind": "visit"}
    invalid = [
        {**base, "place_name": ""}, {**base, "place_name": "   "},
        {**base, "place_name": "x" * 121}, {**base, "place_name": "거기"},
        {**base, "kind": "future"}, {**base, "preference": "like"},
        {**base, "kind": "preference"}, {**base, "kind": "preference", "preference": "unknown"},
        {**base, "occurred_at": "2026-10-03T12:00:00"}, {**base, "latitude": 35},
    ]
    for index, value in enumerate(invalid, 1):
        try:
            RecordPlaceEventArguments.model_validate(value)
        except ValidationError:
            check(f"validation {index}", True)
        else:
            raise AssertionError(value)
    check("gateway ready record / no confirmation", plan().status == "ready" and plan().implemented and not plan().requires_confirmation)
    check("record .40 threshold unchanged", plan(confidence=.39).status == "needs_review" and plan(confidence=.40).status == "ready")
    check("legacy place interest remains unimplemented", not find_tool("place", "record_place_interest").implemented)
    try:
        GatewayAction(type="place", intent="record_place_event", mode="record", reason="test",
                      confidence=.95, requires_confirmation=False, execution_order=1)
    except ValidationError:
        check("gateway missing arguments blocked", True)
    else:
        raise AssertionError("missing Place arguments accepted")


def run_database():
    """동시 실행, rollback, fencing을 실제 PostgreSQL에서 검증합니다."""
    baseline = snapshot()
    uid, oid, cid = fixture()
    client = TestClient(main.app)
    mid = message(uid, cid, "오늘 광안리 갔어.")
    first = plan(); save(client, uid, cid, mid, [first])
    response = execute(client, uid, first.action_id)
    action, records = rows(first.action_id)
    check("DB visit creates one", response.status_code == 200 and action.status == "completed" and len(records) == 1)
    item = records[0]
    check("evidence / nullable time / source", item.user_id == uid and item.message_id == mid and item.conversation_id == cid and item.place_name == "광안리" and item.occurred_at is None and item.source == "orchestrator")
    repeated = execute(client, uid, first.action_id)
    check("completed reuse / one row", not repeated.json()["executor_called"] and len(rows(first.action_id)[1]) == 1)
    check("owner read 200 / other owner 404", client.get(f"/place-events/{item.id}", params={"user_id": str(uid)}).status_code == 200 and client.get(f"/place-events/{item.id}", params={"user_id": str(oid)}).status_code == 404)
    check("other owner execute blocked", execute(client, oid, first.action_id).status_code == 404)

    concurrent = plan(); save(client, uid, cid, mid, [concurrent])
    barrier = threading.Barrier(2); responses = []; errors = []
    def worker():
        """스레드 예외와 미종료 상태를 놓치지 않도록 수집합니다."""
        try:
            barrier.wait(timeout=10)
            responses.append(execute(TestClient(main.app), uid, concurrent.action_id))
        except Exception as error:
            errors.append(error)
    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=60)
    check("concurrent execution one row", not errors and not any(thread.is_alive() for thread in threads) and len(responses) == 2 and all(r.status_code in {200,409} for r in responses) and len(rows(concurrent.action_id)[1]) == 1)

    try:
        for hook in ("before_insert", "before_commit"):
            faulty = plan(); save(client, uid, cid, mid, [faulty])
            register_executor("record_place_event", lambda context, hook=hook: record_place_event_executor(context, **{hook: fail}))
            response = execute(client, uid, faulty.action_id)
            action, records = rows(faulty.action_id)
            check(f"{hook} rollback / sanitized failure", response.status_code == 200 and action.status == "failed" and action.error_message == "executor_failed:RuntimeError" and len(records) == 0)
            register_executor("record_place_event", record_place_event_executor)
            check(f"{hook} retry succeeds", execute(client, uid, faulty.action_id).status_code == 200 and len(rows(faulty.action_id)[1]) == 1)
    finally:
        register_executor("record_place_event", record_place_event_executor)

    lost = plan(); save(client, uid, cid, mid, [lost])
    _, lease = _acquire_lease(lost.action_id, uid)
    context = ExecutorContext(str(lost.action_id), str(uid), "record_place_event", lease.attempt_count)
    original = record_place_event_executor(context)
    check("domain commit before finalize preserved", rows(lost.action_id)[0].status == "processing" and len(rows(lost.action_id)[1]) == 1)
    with SessionLocal() as db:
        stale = db.scalar(select(AgentAction).where(AgentAction.action_id == lost.action_id))
        stale.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    recovered = execute(client, uid, lost.action_id)
    action, records = rows(lost.action_id)
    check("lost finalize retry reuses row", recovered.status_code == 200 and action.status == "completed" and action.attempt_count == 2 and len(records) == 1 and str(records[0].id) == original.data["place_event_id"] and not action.result["data"]["recorded"])
    _, success_fenced = _finish_success(lease, original)
    _, failure_fenced = _finish_failure(lease, RuntimeError("old attempt"))
    check("late worker success/failure fenced", success_fenced and failure_fenced and rows(lost.action_id)[0].status == "completed")
    try:
        record_place_event_executor(context)
    except Exception:
        check("late worker domain insert fenced", len(rows(lost.action_id)[1]) == 1)
    else:
        raise AssertionError("stale executor accepted")
    check("new client completed reuse", not execute(TestClient(main.app), uid, lost.action_id).json()["executor_called"])

    # CHECK의 NULL 처리와 UNIQUE를 직접 insert로 검사합니다.
    for label, fields in [
        ("preference null", {"kind": "preference", "preference": None}),
        ("visit preference", {"kind": "visit", "preference": "like"}),
        ("invalid kind", {"kind": "future", "preference": None}),
    ]:
        candidate = plan(); save(client, uid, cid, mid, [candidate]); action = rows(candidate.action_id)[0]
        with SessionLocal() as db:
            db.add(PlaceEvent(user_id=uid, agent_action_id=action.id, place_name="광안리", **fields))
            try: db.commit()
            except IntegrityError:
                db.rollback(); check(f"DB CHECK {label}", True)
            else: raise AssertionError(label)
    with SessionLocal() as db:
        db.add(PlaceEvent(user_id=uid, agent_action_id=item.agent_action_id, place_name="광안리", kind="visit"))
        try: db.commit()
        except IntegrityError:
            db.rollback(); check("DB UNIQUE action", True)
        else: raise AssertionError("duplicate DB row")
    # 장소를 원문 밖에서 보충하거나 assistant를 근거로 삼으면 기록하지 않습니다.
    for label, evidence in [("invented place", message(uid, cid, "거기 좋았어.")),
                            ("assistant evidence", message(uid, cid, "광안리", role="assistant"))]:
        candidate = plan(); save(client, uid, cid, evidence, [candidate])
        result = execute(client, uid, candidate.action_id)
        check(f"{label} blocked", result.status_code == 200 and rows(candidate.action_id)[0].status == "failed" and not rows(candidate.action_id)[1])
    result = client.get(f"/users/{uid}/place-events")
    with SessionLocal() as db:
        expected = list(db.scalars(select(PlaceEvent.id).where(PlaceEvent.user_id == uid).order_by(PlaceEvent.created_at.desc(), PlaceEvent.id.desc())).all())
    check("read list ordered / limit", result.status_code == 200 and [r["id"] for r in result.json()] == [str(i) for i in expected] and len(client.get(f"/users/{uid}/place-events?limit=1").json()) == 1 and client.get(f"/users/{uid}/place-events?limit=101").status_code == 422)
    check("existing domains fingerprint unchanged", snapshot() == baseline)
    check("db-health", client.get("/db-health").status_code == 200)


def run_routing():
    """실제 OpenAI 출력을 저장 경로에 전달해 부정 예시의 기록이 없는지 확인합니다."""
    uid, _, cid = fixture(); client = TestClient(main.app)
    cases = [
        ("오늘 광안리 갔어.", "visit", "광안리", None, True),
        ("지금 서면이야.", "context", "서면", None, False),
        ("해운대 좋아해.", "preference", "해운대", "like", False),
        ("해운대 별로야.", "preference", "해운대", "dislike", False),
        ("오늘 광안리에서 산책했어.", "visit", "광안리", None, True),
        ("내일 광안리 갈 거야.", None, None, None, False),
        ("광안리 갈까?", None, None, None, False),
        ("친구가 광안리 갔어.", None, None, None, False),
        ("부산 맛집 추천해줘.", None, None, None, False),
        ("거기 좋았어.", None, None, None, False),
        ("광안리에 가고 싶어.", None, None, None, False),
        ("바닷가 갔어.", "visit", "바닷가", None, True),
    ]
    for index, (utterance, kind, name, preference, daily) in enumerate(cases, 1):
        memories = [OrchestratorMemoryContext(content="사용자는 광안리를 좋아한다.", relevance=.9)] if index == 10 else []
        result = orchestrate_with_openai(utterance, memories)
        places = [a for a in result.actions if a.type == "place"]
        daily_actions = [a for a in result.actions if a.intent == "record_daily_trace"]
        valid = (len(places) == 1 and places[0].intent == "record_place_event"
                 and places[0].arguments.kind == kind and places[0].arguments.place_name == name
                 and places[0].arguments.preference == preference and places[0].arguments.occurred_at is None) if kind else not places
        if not valid or (daily and not daily_actions) or (index == 2 and daily_actions):
            print("ROUTING_MISMATCH", index, result.model_dump_json(), flush=True)
        check(f"live routing {index}", valid and (not daily or bool(daily_actions)) and (index != 2 or not daily_actions))
        mid = message(uid, cid, utterance)
        actions = [GatewayAction.model_validate(a.model_dump()) for a in result.actions]
        plans = create_tool_plan(ToolPlanRequest(actions=actions)).plans
        executable = [p for p in plans if p.tool_name in {"record_place_event", "record_daily_trace"} and p.status == "ready"]
        if executable:
            save(client, uid, cid, mid, executable)
            for item in executable:
                response = execute(client, uid, item.action_id)
                check(f"live domain {index}/{item.tool_name}", response.status_code == 200 and response.json()["action"]["status"] == "completed")
        with SessionLocal() as db:
            records = list(db.scalars(select(PlaceEvent).where(PlaceEvent.message_id == mid)).all())
            daily_rows = list(db.scalars(select(DailyLifeEvent).where(DailyLifeEvent.message_id == mid)).all())
        check(f"live place count {index}", len(records) == (1 if kind else 0) and (not daily or len(daily_rows) == 1) and (index != 2 or not daily_rows))


def run_live_chat():
    """Chat과 Orchestrator는 실제 OpenAI를 호출하고 Memory 자동 추출만 제외합니다."""
    uid, _, cid = fixture(); client = TestClient(main.app)
    with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(uid), "NOIE_DEV_CONVERSATION_ID": str(cid)}), \
         patch.object(main, "run_memory_extraction_background", lambda *args: None):
        body = {"text": "오늘 광안리 갔어.", "request_id": str(uuid4())}
        response = client.post("/chat", json=body)
        check("live /chat OpenAI 200", response.status_code == 200 and response.json()["source"] == "openai" and bool(response.json()["reply"]))
        with SessionLocal() as db:
            evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == body["request_id"]))
            places = list(db.scalars(select(PlaceEvent).where(PlaceEvent.message_id == evidence.id)).all())
            daily = list(db.scalars(select(DailyLifeEvent).where(DailyLifeEvent.message_id == evidence.id)).all())
            count_before = len(list(db.scalars(select(AgentAction.id).where(AgentAction.message_id == evidence.id)).all()))
        check("live /chat Place + Daily exact evidence", len(places) == 1 and len(daily) == 1 and places[0].place_name == "광안리")
        duplicate = client.post("/chat", json=body)
        with SessionLocal() as db:
            count_after = len(list(db.scalars(select(AgentAction.id).where(AgentAction.message_id == evidence.id)).all()))
            place_after = list(db.scalars(select(PlaceEvent).where(PlaceEvent.message_id == evidence.id)).all())
        check("live /chat cached idempotency", duplicate.status_code == 200 and duplicate.json() == response.json() and count_after == count_before and len(place_after) == 1)
        register_executor("record_place_event", lambda context: record_place_event_executor(context, before_insert=fail))
        try:
            faulty_body = {"text": "오늘 광안리에서 산책했어.", "request_id": str(uuid4())}
            faulty_response = client.post("/chat", json=faulty_body)
            with SessionLocal() as db:
                faulty_message = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == faulty_body["request_id"]))
                place_action = db.scalar(select(AgentAction).where(AgentAction.message_id == faulty_message.id, AgentAction.tool_name == "record_place_event"))
                places = list(db.scalars(select(PlaceEvent).where(PlaceEvent.message_id == faulty_message.id)).all())
                daily = list(db.scalars(select(DailyLifeEvent).where(DailyLifeEvent.message_id == faulty_message.id)).all())
            check("live Place failure isolated / Daily preserved", faulty_response.status_code == 200 and place_action is not None and place_action.status == "failed" and not places and len(daily) == 1)
        finally:
            register_executor("record_place_event", record_place_event_executor)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-routing", action="store_true")
    parser.add_argument("--routing-only", action="store_true")
    parser.add_argument("--live-chat-only", action="store_true")
    args = parser.parse_args()
    if not args.routing_only and not args.live_chat_only:
        run_validation(); run_database()
    if args.live_routing or args.routing_only:
        run_routing()
    if args.live_routing or args.live_chat_only:
        run_live_chat()
    print(f"SUMMARY={PASSED} passed", flush=True)
