"""Body State의 실제 PostgreSQL 안전성, OpenAI 의미 경계, Chat E2E 검증입니다."""

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
from agent.body_state_schemas import BODY_AXES, RecordBodyStateArguments
from agent.executor_registry import ExecutorContext, register_executor
from agent.executor_service import _acquire_lease, _finish_failure, _finish_success
from agent.orchestrator import orchestrate_with_openai
from agent.record_body_state_executor import record_body_state_executor
from agent.schemas import OrchestratorMemoryContext
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal
from models.agent_action import AgentAction
from models.body_state_event import BodyStateEvent
from models.conversation import Conversation
from models.emotion_event import EmotionEvent
from models.message import Message
from models.user import User

PASSED = 0


def check(name, condition):
    """실패를 숨기지 않고 검증을 해당 항목에서 중단합니다."""
    global PASSED
    if not condition:
        raise AssertionError(name)
    PASSED += 1
    print(f"[PASS] {name}", flush=True)


def fixture():
    """기존 실제 사용자와 분리된 새로운 테스트 사용자만 생성합니다."""
    with SessionLocal() as db:
        marker = uuid4().hex
        user = User(name=f"__body_state_v1__{marker}", metadata_={"test": marker})
        other = User(name=f"__body_state_other__{marker}", metadata_={"test": marker})
        db.add_all([user, other]); db.flush()
        conversation = Conversation(user_id=user.id, title=marker, metadata_={"test": marker})
        db.add(conversation); db.commit()
        print(f"TEST_USER_ID={user.id}", flush=True)
        return user.id, other.id, conversation.id


def message(uid, cid, content, role="user"):
    """원문은 변경하지 않고 Message evidence로만 저장합니다."""
    with SessionLocal() as db:
        item = Message(user_id=uid if role == "user" else None, conversation_id=cid,
                       role=role, content=content, metadata_={"test": "body-state-v1"})
        db.add(item); db.commit()
        return item.id


def plan(arguments=None, confidence=.95):
    """기존 Gateway로 Body Record 후보를 만듭니다."""
    return create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
        type="body_state", intent="record_body_state", mode="record", reason="명시적 현재 신체 상태",
        confidence=confidence, requires_confirmation=False, execution_order=1,
        arguments=arguments if arguments is not None else {"fatigue": .85, "sleepiness": .8, "confidence": .95},
    )])).plans[0]


def save(client, uid, cid, mid, plans):
    """기존 Action Persistence API를 사용합니다."""
    response = client.post("/agent/actions/plan", json={
        "user_id": str(uid), "conversation_id": str(cid), "message_id": str(mid),
        "plans": [p.model_dump(mode="json") for p in plans],
    })
    assert response.status_code == 201, response.text
    return response.json()


def execute(client, uid, action_id):
    """새 실행 프레임워크 없이 기존 Common Executor API로 실행합니다."""
    return client.post(f"/agent/actions/{action_id}/execute", json={"user_id": str(uid)})


def rows(action_id):
    """별도 세션에서 영구 저장 상태를 확인합니다."""
    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == action_id))
        return action, list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.agent_action_id == action.id)).all())


def snapshot():
    """기존 도메인의 모든 컬럼 지문을 전후 비교합니다."""
    with SessionLocal() as db:
        return {table: db.execute(sql_text(
            f"SELECT count(*), md5(coalesce(string_agg(md5(row_to_json(snapshot_row)::text), '' ORDER BY id), '')) FROM {table} snapshot_row"
        )).one() for table in ("emotion_events", "daily_life_events", "dream_goals", "schedules", "place_events", "memories", "memory_evidence")}


def fail():
    """오류 전문이 외부 응답/DB 결과에 남지 않는지도 확인합니다."""
    raise RuntimeError("private body fault details")


def run_validation():
    """DB 쓰기 없이 모든 축과 신뢰도의 입력 범위를 검사합니다."""
    base = {"fatigue": .85, "confidence": .95}
    for field in (*BODY_AXES, "confidence"):
        for label, value in [("low", -.01), ("high", 1.01), ("nan", float("nan")),
                             ("inf", float("inf")), ("negative inf", float("-inf")), ("bool", True), ("string", "0.8")]:
            try:
                RecordBodyStateArguments.model_validate({**base, field: value})
            except ValidationError:
                check(f"validation {field}/{label}", True)
            else:
                raise AssertionError((field, label))
    for label, value in [("all unknown", {"confidence": .95}), ("extra", {**base, "diagnosis": "unsupported"}), ("missing confidence", {"fatigue": .8})]:
        try: RecordBodyStateArguments.model_validate(value)
        except ValidationError: check(f"validation {label}", True)
        else: raise AssertionError(label)
    values = RecordBodyStateArguments(energy=0, confidence=1)
    check("known zero is not unknown", values.energy == 0 and values.fatigue is None)
    check("gateway implemented record / no confirmation", plan().status == "ready" and plan().implemented and not plan().requires_confirmation)
    check("action confidence .40 boundary", plan(confidence=.39).status == "needs_review" and plan(confidence=.4).status == "ready")
    check("axis interpretation confidence gates execution", plan({"fatigue": .8, "confidence": .39}).status == "needs_review")
    try:
        GatewayAction(type="body_state", intent="record_body_state", mode="record", reason="test",
                      confidence=.95, requires_confirmation=False, execution_order=1)
    except ValidationError: check("gateway missing body arguments blocked", True)
    else: raise AssertionError("missing arguments accepted")


def run_database():
    """실제 DB의 NULL/범위/UNIQUE와 transaction 실패를 검증합니다."""
    baseline = snapshot(); uid, oid, cid = fixture(); client = TestClient(main.app)
    mid = message(uid, cid, "오늘 너무 피곤하고 졸려.")
    first = plan(); save(client, uid, cid, mid, [first])
    response = execute(client, uid, first.action_id); action, records = rows(first.action_id)
    check("DB body creates one", response.status_code == 200 and action.status == "completed" and len(records) == 1)
    item = records[0]
    check("exact nullable axes and evidence", item.fatigue == .85 and item.sleepiness == .8 and all(getattr(item, a) is None for a in ("energy", "hunger", "physical_tension", "discomfort")) and item.message_id == mid and item.conversation_id == cid and item.user_id == uid)
    repeated = execute(client, uid, first.action_id)
    check("completed reuse one row", not repeated.json()["executor_called"] and len(rows(first.action_id)[1]) == 1)
    detail = client.get(f"/body-state-events/{item.id}", params={"user_id": str(uid)})
    check("API null preserved / source", detail.status_code == 200 and detail.json()["hunger"] is None and detail.json()["source"] == "orchestrator")
    check("other owner read blocked", client.get(f"/body-state-events/{item.id}", params={"user_id": str(oid)}).status_code == 404)
    check("other owner execute blocked", execute(client, oid, first.action_id).status_code == 404)
    zero = plan({"energy": 0, "confidence": .9}); save(client, uid, cid, message(uid, cid, "몸에 힘이 하나도 없어."), [zero])
    execute(client, uid, zero.action_id)
    check("DB known zero vs unknown", rows(zero.action_id)[1][0].energy == 0 and rows(zero.action_id)[1][0].fatigue is None)
    unknown = plan({"fatigue": .8, "confidence": .9}); save(client, uid, cid, message(uid, cid, "피곤해."), [unknown])
    execute(client, uid, unknown.action_id)
    check("fatigue only preserves five unknown axes", all(getattr(rows(unknown.action_id)[1][0], a) is None for a in BODY_AXES if a != "fatigue"))

    concurrent = plan(); save(client, uid, cid, mid, [concurrent]); barrier = threading.Barrier(2); responses = []; errors = []
    def worker():
        """동시 실행의 예외와 미종료 상태도 검사합니다."""
        try:
            barrier.wait(timeout=10)
            responses.append(execute(TestClient(main.app), uid, concurrent.action_id))
        except Exception as error: errors.append(error)
    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=60)
    check("concurrent one attempt / one row", not errors and not any(t.is_alive() for t in threads) and len(responses) == 2 and all(r.status_code in {200,409} for r in responses) and len(rows(concurrent.action_id)[1]) == 1 and rows(concurrent.action_id)[0].attempt_count == 1)
    try:
        for hook in ("before_insert", "before_commit"):
            faulty = plan(); save(client, uid, cid, mid, [faulty])
            register_executor("record_body_state", lambda context, hook=hook: record_body_state_executor(context, **{hook: fail}))
            response = execute(client, uid, faulty.action_id); action, records = rows(faulty.action_id)
            check(f"{hook} rollback / sanitized failure", response.status_code == 200 and action.status == "failed" and action.error_message == "executor_failed:RuntimeError" and not records)
            register_executor("record_body_state", record_body_state_executor)
            check(f"{hook} retry succeeds", execute(client, uid, faulty.action_id).status_code == 200 and len(rows(faulty.action_id)[1]) == 1)
    finally: register_executor("record_body_state", record_body_state_executor)
    lost = plan(); save(client, uid, cid, mid, [lost]); _, lease = _acquire_lease(lost.action_id, uid)
    context = ExecutorContext(str(lost.action_id), str(uid), "record_body_state", lease.attempt_count)
    original = record_body_state_executor(context)
    check("domain commit preserved before finalize", rows(lost.action_id)[0].status == "processing" and len(rows(lost.action_id)[1]) == 1)
    with SessionLocal() as db:
        stale = db.scalar(select(AgentAction).where(AgentAction.action_id == lost.action_id))
        stale.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    response = execute(client, uid, lost.action_id); action, records = rows(lost.action_id)
    check("lost finalize retry reuses row", response.status_code == 200 and action.status == "completed" and action.attempt_count == 2 and len(records) == 1 and str(records[0].id) == original.data["body_state_event_id"] and not action.result["data"]["recorded"])
    _, success_fenced = _finish_success(lease, original); _, failure_fenced = _finish_failure(lease, RuntimeError("old"))
    check("late success/failure fenced", success_fenced and failure_fenced and rows(lost.action_id)[0].status == "completed")
    try: record_body_state_executor(context)
    except Exception: check("stale domain worker blocked", len(rows(lost.action_id)[1]) == 1)
    else: raise AssertionError("stale worker accepted")
    check("new client completed reuse", not execute(TestClient(main.app), uid, lost.action_id).json()["executor_called"])

    # API를 우회한 DB 직접 쓰기에도 범위/유한성/최소 한 축/UNIQUE를 검증합니다.
    for label, fields in [
        ("all null", {"confidence": .9}), ("range low", {"fatigue": -.01, "confidence": .9}),
        ("range high", {"fatigue": 1.01, "confidence": .9}),
        ("nan", {"fatigue": float("nan"), "confidence": .9}),
        ("inf", {"fatigue": float("inf"), "confidence": .9}),
        ("negative inf", {"fatigue": float("-inf"), "confidence": .9}),
        ("confidence nan", {"fatigue": .8, "confidence": float("nan")}),
        ("confidence inf", {"fatigue": .8, "confidence": float("inf")}),
    ]:
        candidate = plan(); save(client, uid, cid, mid, [candidate])
        with SessionLocal() as db:
            db.add(BodyStateEvent(user_id=uid, agent_action_id=rows(candidate.action_id)[0].id, **fields))
            try: db.commit()
            except IntegrityError: db.rollback(); check(f"DB CHECK {label}", True)
            else: raise AssertionError(label)
    with SessionLocal() as db:
        db.add(BodyStateEvent(user_id=uid, agent_action_id=item.agent_action_id, fatigue=.8, confidence=.9))
        try: db.commit()
        except IntegrityError: db.rollback(); check("DB UNIQUE action", True)
        else: raise AssertionError("duplicate body row")
    for label, role in [("assistant", "assistant"), ("system", "system")]:
        candidate = plan(); save(client, uid, cid, message(uid, cid, "피곤해.", role), [candidate])
        response = execute(client, uid, candidate.action_id)
        check(f"{label} evidence blocked", response.status_code == 200 and rows(candidate.action_id)[0].status == "failed" and not rows(candidate.action_id)[1])
    result = client.get(f"/users/{uid}/body-state-events")
    with SessionLocal() as db:
        expected = list(db.scalars(select(BodyStateEvent.id).where(BodyStateEvent.user_id == uid).order_by(BodyStateEvent.created_at.desc(), BodyStateEvent.id.desc())).all())
    check("ordered list / limit", result.status_code == 200 and [r["id"] for r in result.json()] == [str(i) for i in expected] and len(client.get(f"/users/{uid}/body-state-events?limit=1").json()) == 1 and client.get(f"/users/{uid}/body-state-events?limit=101").status_code == 422)
    # Gateway 이후 저장된 계획이 바뀌어도 Executor는 인자 신뢰도를 다시 확인합니다.
    low_confidence = plan(); save(client, uid, cid, mid, [low_confidence])
    with SessionLocal() as db:
        changed = db.scalar(select(AgentAction).where(AgentAction.action_id == low_confidence.action_id))
        changed.arguments = {**changed.arguments, "confidence": .39}; db.commit()
    response = execute(client, uid, low_confidence.action_id)
    check("ready plan low interpretation confidence blocked", response.status_code == 200 and rows(low_confidence.action_id)[0].status == "failed" and not rows(low_confidence.action_id)[1])
    check("existing domain fingerprints unchanged", snapshot() == baseline)
    check("db-health", client.get("/db-health").status_code == 200)


def run_routing():
    """실제 OpenAI로 근거 축, unknown, 타인/과거/감정/인지 경계를 수치 평가합니다."""
    uid, _, cid = fixture(); client = TestClient(main.app)
    # 기대값 H/L은 >=.7 / <.4이며 키가 없는 축은 반드시 NULL이어야 합니다.
    cases = [
        ("오늘 너무 피곤하고 졸려.", {"fatigue": "H", "sleepiness": "H"}, False),
        ("배고프고 기운이 없어.", {"hunger": "H", "energy": "L"}, False),
        ("어깨에 힘이 들어가고 뻐근해.", {"physical_tension": "H", "discomfort": "known"}, False),
        ("기분이 좋아.", None, True),
        ("기분은 좋은데 몸은 완전히 지쳤어.", {"fatigue": "H", "energy": "L"}, True),
        ("발표 때문에 긴장돼.", None, True),
        ("집중이 안 되고 머리가 복잡해.", None, False),
        ("개발하고 싶은데 몸에 힘이 없어.", {"energy": "L"}, False),
        ("친구가 너무 피곤하대.", None, False),
        ("피곤해.", {"fatigue": "known"}, False),
        ("불안해.", None, True),
        ("불안해서 어깨에 힘이 잔뜩 들어가.", {"physical_tension": "H"}, True),
        ("개발하고 싶어.", None, False),
        ("몸에 에너지가 넘쳐.", {"energy": "H"}, False),
        ("너무 졸려.", {"sleepiness": "H"}, False),
        ("피곤해서 집중이 안 돼.", {"fatigue": "known"}, False),
        ("머리가 아파.", {"discomfort": "known"}, False),
        ("어제는 피곤했는데 지금은 괜찮아.", "current", False),
        ("어제 너무 피곤했어.", None, False),
        ("오늘은 전혀 안 피곤해.", {"fatigue": "L"}, False),
        ("내일은 아마 피곤할 거야.", None, False),
        ("광안리 좋아해.", None, False),
    ]
    for index, (utterance, expected, emotion) in enumerate(cases, 1):
        memories = [OrchestratorMemoryContext(content="사용자는 항상 피곤하고 배고프다.", relevance=.9)] if index in {4,18} else []
        result = orchestrate_with_openai(utterance, memories)
        bodies = [a for a in result.actions if a.type == "body_state"]
        valid = not bodies if expected is None else len(bodies) == 1 and bodies[0].intent == "record_body_state"
        if expected == "current":
            valid = not bodies or (len(bodies) == 1 and bodies[0].arguments.fatigue is not None and bodies[0].arguments.fatigue < .4 and all(getattr(bodies[0].arguments, a) is None for a in BODY_AXES if a != "fatigue"))
        elif isinstance(expected, dict) and valid:
            arguments = bodies[0].arguments
            valid = all(
                getattr(arguments, a) is None if a not in expected else getattr(arguments, a) is not None
                and (expected[a] != "H" or getattr(arguments, a) >= .7)
                and (expected[a] != "L" or getattr(arguments, a) < .4)
                for a in BODY_AXES
            )
        if emotion:
            valid = valid and any(a.intent == "record_emotion" for a in result.actions)
        if not valid: print("ROUTING_MISMATCH", index, result.model_dump_json(), flush=True)
        check(f"live routing {index}", valid)
        mid = message(uid, cid, utterance)
        plans = create_tool_plan(ToolPlanRequest(actions=[GatewayAction.model_validate(a.model_dump()) for a in result.actions])).plans
        executable = [p for p in plans if p.tool_name in {"record_body_state", "record_emotion"} and p.status == "ready"]
        if executable:
            save(client, uid, cid, mid, executable)
            for item in executable:
                response = execute(client, uid, item.action_id)
                check(f"live domain {index}/{item.tool_name}", response.status_code == 200 and response.json()["action"]["status"] == "completed")
        with SessionLocal() as db:
            records = list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.message_id == mid)).all())
            emotions = list(db.scalars(select(EmotionEvent).where(EmotionEvent.message_id == mid)).all())
        check(f"live DB count {index}", len(records) == len(bodies) and (not emotion or len(emotions) == 1))
    print(f"ROUTING_CASES={len(cases)}/{len(cases)}", flush=True)


def run_live_chat():
    """실제 OpenAI 채팅/Agent/DB를 연결하고 Body 실패를 주입합니다."""
    uid, _, cid = fixture(); client = TestClient(main.app)
    with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(uid), "NOIE_DEV_CONVERSATION_ID": str(cid)}), \
         patch.object(main, "run_memory_extraction_background", lambda *args: None):
        body = {"text": "기분은 좋은데 너무 피곤하고 졸려.", "request_id": str(uuid4())}
        response = client.post("/chat", json=body)
        check("live /chat OpenAI 200", response.status_code == 200 and response.json()["source"] == "openai" and bool(response.json()["reply"]))
        with SessionLocal() as db:
            evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == body["request_id"]))
            records = list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.message_id == evidence.id)).all())
            emotions = list(db.scalars(select(EmotionEvent).where(EmotionEvent.message_id == evidence.id)).all())
            count_before = len(list(db.scalars(select(AgentAction.id).where(AgentAction.message_id == evidence.id)).all()))
        check("live /chat Body + Emotion same evidence", len(records) == 1 and len(emotions) == 1 and records[0].fatigue >= .7 and records[0].sleepiness >= .7 and records[0].energy is None and emotions[0].j >= .7)
        repeated = client.post("/chat", json=body)
        with SessionLocal() as db:
            count_after = len(list(db.scalars(select(AgentAction.id).where(AgentAction.message_id == evidence.id)).all()))
            body_after = list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.message_id == evidence.id)).all())
        check("live /chat idempotency unchanged", repeated.status_code == 200 and repeated.json() == response.json() and count_before == count_after and len(body_after) == 1)
        register_executor("record_body_state", lambda context: record_body_state_executor(context, before_insert=fail))
        try:
            faulty_body = {"text": "오늘 너무 피곤하고 기분도 안 좋아.", "request_id": str(uuid4())}
            response = client.post("/chat", json=faulty_body)
            with SessionLocal() as db:
                evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == faulty_body["request_id"]))
                action = db.scalar(select(AgentAction).where(AgentAction.message_id == evidence.id, AgentAction.tool_name == "record_body_state"))
                records = list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.message_id == evidence.id)).all())
                emotions = list(db.scalars(select(EmotionEvent).where(EmotionEvent.message_id == evidence.id)).all())
            check("Body failure isolated / Emotion preserved", response.status_code == 200 and action is not None and action.status == "failed" and not records and len(emotions) == 1)
        finally: register_executor("record_body_state", record_body_state_executor)


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
