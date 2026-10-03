"""Cognitive State의 실제 PostgreSQL 안전성, OpenAI 의미 경계, Chat E2E 검증입니다."""

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
from agent.cognitive_state_schemas import COGNITIVE_AXES, RecordCognitiveStateArguments
from agent.executor_registry import ExecutorContext, register_executor
from agent.executor_service import _acquire_lease, _finish_failure, _finish_success
from agent.orchestrator import discard_unknown_state_candidates, orchestrate_with_openai
from agent.record_cognitive_state_executor import record_cognitive_state_executor
from agent.schemas import OrchestratorMemoryContext, OrchestratorResult
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal
from models.agent_action import AgentAction
from models.cognitive_state_event import CognitiveStateEvent
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
        user = User(name=f"__cognitive_state_v1__{marker}", metadata_={"test": marker})
        other = User(name=f"__cognitive_state_other__{marker}", metadata_={"test": marker})
        db.add_all([user, other]); db.flush()
        conversation = Conversation(user_id=user.id, title=marker, metadata_={"test": marker})
        db.add(conversation); db.commit()
        print(f"TEST_USER_ID={user.id}", flush=True)
        return user.id, other.id, conversation.id


def message(uid, cid, content, role="user"):
    """원문은 변경하지 않고 Message evidence로만 저장합니다."""
    with SessionLocal() as db:
        item = Message(user_id=uid if role == "user" else None, conversation_id=cid,
                       role=role, content=content, metadata_={"test": "cognitive-state-v1"})
        db.add(item); db.commit()
        return item.id


def plan(arguments=None, confidence=.95):
    """기존 Gateway로 Cognitive Record 후보를 만듭니다."""
    return create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
        type="cognitive_state", intent="record_cognitive_state", mode="record", reason="명시적 현재 인지 상태",
        confidence=confidence, requires_confirmation=False, execution_order=1,
        arguments=arguments if arguments is not None else {"focus": .85, "mental_load": .8, "confidence": .95},
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
        return action, list(db.scalars(select(CognitiveStateEvent).where(CognitiveStateEvent.agent_action_id == action.id)).all())


def snapshot():
    """기존 도메인의 모든 컬럼 지문을 전후 비교합니다."""
    with SessionLocal() as db:
        return {table: db.execute(sql_text(
            f"SELECT count(*), md5(coalesce(string_agg(md5(row_to_json(snapshot_row)::text), '' ORDER BY id), '')) FROM {table} snapshot_row"
        )).one() for table in ("body_state_events", "emotion_events", "daily_life_events", "dream_goals", "schedules", "place_events", "memories", "memory_evidence")}


def fail():
    """오류 전문이 외부 응답/DB 결과에 남지 않는지도 확인합니다."""
    raise RuntimeError("private cognitive fault details")


def run_validation():
    """DB 쓰기 없이 모든 축과 신뢰도의 입력 범위를 검사합니다."""
    base = {"focus": .85, "confidence": .95}
    for field in (*COGNITIVE_AXES, "confidence"):
        for label, value in [("low", -.01), ("high", 1.01), ("nan", float("nan")),
                             ("inf", float("inf")), ("negative inf", float("-inf")), ("bool", True), ("string", "0.8")]:
            try:
                RecordCognitiveStateArguments.model_validate({**base, field: value})
            except ValidationError:
                check(f"validation {field}/{label}", True)
            else:
                raise AssertionError((field, label))
    for label, value in [("all unknown", {"confidence": .95}), ("extra", {**base, "diagnosis": "unsupported"}), ("missing confidence", {"focus": .8})]:
        try: RecordCognitiveStateArguments.model_validate(value)
        except ValidationError: check(f"validation {label}", True)
        else: raise AssertionError(label)
    values = RecordCognitiveStateArguments(motivation=0, confidence=1)
    check("known zero is not unknown", values.motivation == 0 and values.focus is None)
    check("gateway implemented record / no confirmation", plan().status == "ready" and plan().implemented and not plan().requires_confirmation)
    check("action confidence .40 boundary", plan(confidence=.39).status == "needs_review" and plan(confidence=.4).status == "ready")
    check("axis interpretation confidence gates execution", plan({"focus": .8, "confidence": .39}).status == "needs_review")
    try:
        GatewayAction(type="cognitive_state", intent="record_cognitive_state", mode="record", reason="test",
                      confidence=.95, requires_confirmation=False, execution_order=1)
    except ValidationError: check("gateway missing cognitive arguments blocked", True)
    else: raise AssertionError("missing arguments accepted")


def run_database():
    """실제 DB의 NULL/범위/UNIQUE와 transaction 실패를 검증합니다."""
    baseline = snapshot(); uid, oid, cid = fixture(); client = TestClient(main.app)
    mid = message(uid, cid, "머리가 복잡하지만 코딩에 엄청 집중돼.")
    first = plan(); save(client, uid, cid, mid, [first])
    response = execute(client, uid, first.action_id); action, records = rows(first.action_id)
    check("DB cognitive creates one", response.status_code == 200 and action.status == "completed" and len(records) == 1)
    item = records[0]
    check("exact nullable axes and evidence", item.focus == .85 and item.mental_load == .8 and all(getattr(item, a) is None for a in ("motivation", "uncertainty", "clarity")) and item.message_id == mid and item.conversation_id == cid and item.user_id == uid)
    repeated = execute(client, uid, first.action_id)
    check("completed reuse one row", not repeated.json()["executor_called"] and len(rows(first.action_id)[1]) == 1)
    detail = client.get(f"/cognitive-state-events/{item.id}", params={"user_id": str(uid)})
    check("API null preserved / source", detail.status_code == 200 and detail.json()["uncertainty"] is None and detail.json()["source"] == "orchestrator")
    check("other owner read blocked", client.get(f"/cognitive-state-events/{item.id}", params={"user_id": str(oid)}).status_code == 404)
    check("other owner execute blocked", execute(client, oid, first.action_id).status_code == 404)
    zero = plan({"motivation": 0, "confidence": .9}); save(client, uid, cid, message(uid, cid, "개발하고 싶은 마음이 하나도 없어."), [zero])
    execute(client, uid, zero.action_id)
    check("DB known zero vs unknown", rows(zero.action_id)[1][0].motivation == 0 and rows(zero.action_id)[1][0].focus is None)
    unknown = plan({"focus": .8, "confidence": .9}); save(client, uid, cid, message(uid, cid, "집중이 잘 돼."), [unknown])
    execute(client, uid, unknown.action_id)
    check("focus only preserves four unknown axes", all(getattr(rows(unknown.action_id)[1][0], a) is None for a in COGNITIVE_AXES if a != "focus"))

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
            register_executor("record_cognitive_state", lambda context, hook=hook: record_cognitive_state_executor(context, **{hook: fail}))
            response = execute(client, uid, faulty.action_id); action, records = rows(faulty.action_id)
            check(f"{hook} rollback / sanitized failure", response.status_code == 200 and action.status == "failed" and action.error_message == "executor_failed:RuntimeError" and not records)
            register_executor("record_cognitive_state", record_cognitive_state_executor)
            check(f"{hook} retry succeeds", execute(client, uid, faulty.action_id).status_code == 200 and len(rows(faulty.action_id)[1]) == 1)
    finally: register_executor("record_cognitive_state", record_cognitive_state_executor)
    lost = plan(); save(client, uid, cid, mid, [lost]); _, lease = _acquire_lease(lost.action_id, uid)
    context = ExecutorContext(str(lost.action_id), str(uid), "record_cognitive_state", lease.attempt_count)
    original = record_cognitive_state_executor(context)
    check("domain commit preserved before finalize", rows(lost.action_id)[0].status == "processing" and len(rows(lost.action_id)[1]) == 1)
    with SessionLocal() as db:
        stale = db.scalar(select(AgentAction).where(AgentAction.action_id == lost.action_id))
        stale.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    response = execute(client, uid, lost.action_id); action, records = rows(lost.action_id)
    check("lost finalize retry reuses row", response.status_code == 200 and action.status == "completed" and action.attempt_count == 2 and len(records) == 1 and str(records[0].id) == original.data["cognitive_state_event_id"] and not action.result["data"]["recorded"])
    _, success_fenced = _finish_success(lease, original); _, failure_fenced = _finish_failure(lease, RuntimeError("old"))
    check("late success/failure fenced", success_fenced and failure_fenced and rows(lost.action_id)[0].status == "completed")
    try: record_cognitive_state_executor(context)
    except Exception: check("stale domain worker blocked", len(rows(lost.action_id)[1]) == 1)
    else: raise AssertionError("stale worker accepted")
    check("new client completed reuse", not execute(TestClient(main.app), uid, lost.action_id).json()["executor_called"])

    # API를 우회한 DB 직접 쓰기에도 범위/유한성/최소 한 축/UNIQUE를 검증합니다.
    for label, fields in [
        ("all null", {"confidence": .9}), ("range low", {"focus": -.01, "confidence": .9}),
        ("range high", {"focus": 1.01, "confidence": .9}),
        ("nan", {"focus": float("nan"), "confidence": .9}),
        ("inf", {"focus": float("inf"), "confidence": .9}),
        ("negative inf", {"focus": float("-inf"), "confidence": .9}),
        ("confidence nan", {"focus": .8, "confidence": float("nan")}),
        ("confidence inf", {"focus": .8, "confidence": float("inf")}),
    ]:
        candidate = plan(); save(client, uid, cid, mid, [candidate])
        with SessionLocal() as db:
            db.add(CognitiveStateEvent(user_id=uid, agent_action_id=rows(candidate.action_id)[0].id, **fields))
            try: db.commit()
            except IntegrityError: db.rollback(); check(f"DB CHECK {label}", True)
            else: raise AssertionError(label)
    with SessionLocal() as db:
        db.add(CognitiveStateEvent(user_id=uid, agent_action_id=item.agent_action_id, focus=.8, confidence=.9))
        try: db.commit()
        except IntegrityError: db.rollback(); check("DB UNIQUE action", True)
        else: raise AssertionError("duplicate cognitive row")
    for label, role in [("assistant", "assistant"), ("system", "system")]:
        candidate = plan(); save(client, uid, cid, message(uid, cid, "집중이 잘 돼.", role), [candidate])
        response = execute(client, uid, candidate.action_id)
        check(f"{label} evidence blocked", response.status_code == 200 and rows(candidate.action_id)[0].status == "failed" and not rows(candidate.action_id)[1])
    result = client.get(f"/users/{uid}/cognitive-state-events")
    with SessionLocal() as db:
        expected = list(db.scalars(select(CognitiveStateEvent.id).where(CognitiveStateEvent.user_id == uid).order_by(CognitiveStateEvent.created_at.desc(), CognitiveStateEvent.id.desc())).all())
    check("ordered list / limit", result.status_code == 200 and [r["id"] for r in result.json()] == [str(i) for i in expected] and len(client.get(f"/users/{uid}/cognitive-state-events?limit=1").json()) == 1 and client.get(f"/users/{uid}/cognitive-state-events?limit=101").status_code == 422)
    # Gateway 이후 저장된 계획이 바뀌어도 Executor는 인자 신뢰도를 다시 확인합니다.
    low_confidence = plan(); save(client, uid, cid, mid, [low_confidence])
    with SessionLocal() as db:
        changed = db.scalar(select(AgentAction).where(AgentAction.action_id == low_confidence.action_id))
        changed.arguments = {**changed.arguments, "confidence": .39}; db.commit()
    response = execute(client, uid, low_confidence.action_id)
    check("ready plan low interpretation confidence blocked", response.status_code == 200 and rows(low_confidence.action_id)[0].status == "failed" and not rows(low_confidence.action_id)[1])
    check("existing domain fingerprints unchanged", snapshot() == baseline)
    check("db-health", client.get("/db-health").status_code == 200)


def run_output_contract():
    """같은 발화의 호환 축만 모으고 충돌/원문/다른 도메인을 임의 변경하지 않습니다."""
    def candidate(arguments, order):
        """오직 현재 인지 Record 출력 후보를 생성합니다."""
        return {"type": "cognitive_state", "intent": "record_cognitive_state", "mode": "record",
                "reason": "현재 발화의 직접 근거", "confidence": .95,
                "requires_confirmation": False, "execution_order": order, "arguments": arguments}
    first = candidate({"focus": .8, "confidence": .9}, 1)
    duplicate = candidate({"focus": .8, "mental_load": .9, "confidence": .8}, 3)
    body = {"type": "body_state", "intent": "record_body_state", "mode": "record",
            "reason": "몸에 힘이 없음", "confidence": .9, "requires_confirmation": False,
            "execution_order": 2, "arguments": {"energy": .1, "confidence": .9}}
    result = OrchestratorResult.model_validate({"needs_action": True, "actions": [first, body, duplicate]})
    check("compatible Cognitive actions become one / independent axes", len(result.actions) == 2 and
          result.actions[0].arguments.focus == .8 and result.actions[0].arguments.mental_load == .9 and
          result.actions[0].arguments.clarity is None)
    check("normalization keeps lowest confidence", result.actions[0].confidence == .8 and result.actions[0].arguments.confidence == .8)
    check("normalization preserves Body / order", result.actions[1].type == "body_state" and result.actions[1].arguments.energy == .1 and
          [a.execution_order for a in result.actions] == [1,2])
    check("normalization does not mutate inputs", first["arguments"] == {"focus": .8, "confidence": .9} and duplicate["execution_order"] == 3)
    try:
        OrchestratorResult.model_validate({"needs_action": True, "actions": [
            first, candidate({"focus": .2, "confidence": .9}, 2)]})
    except ValidationError:
        check("contradictory same-axis values rejected / not averaged", True)
    else:
        raise AssertionError("conflicting Cognitive values accepted")
    check("canonical output remains stable", OrchestratorResult.model_validate(result.model_dump()).model_dump() == result.model_dump())
    # 전부 unknown인 OpenAI placeholder만 제외합니다. 직접 입력 validation은 완화하지 않습니다.
    from agent.body_state_schemas import BODY_AXES
    unknown = candidate({**{a: None for a in COGNITIVE_AXES}, "confidence": 0.0}, 1)
    payload = {"needs_action": True, "actions": [unknown, body]}
    adapted = discard_unknown_state_candidates(payload)
    check("unknown Cognitive does not cancel valid Body", len(adapted["actions"]) == 1 and
          OrchestratorResult.model_validate(adapted).actions[0].arguments.energy == .1)
    check("unknown filtering does not mutate input", payload["actions"][1]["execution_order"] == 2 and len(payload["actions"]) == 2)
    unknown_body = {**body, "execution_order": 1, "arguments": {**{a: None for a in BODY_AXES}, "confidence": 1.0}}
    known = candidate({"focus": 0, "confidence": .9}, 2)
    adapted = discard_unknown_state_candidates({"needs_action": True, "actions": [unknown_body, known]})
    check("unknown Body does not cancel known zero Cognitive", len(adapted["actions"]) == 1 and
          OrchestratorResult.model_validate(adapted).actions[0].arguments.focus == 0)
    adapted = discard_unknown_state_candidates({"needs_action": True, "actions": [unknown, {**unknown_body, "execution_order": 2}]})
    check("only unknown states mean no action", adapted == {"needs_action": False, "actions": []})
    extra = {**unknown, "arguments": {**unknown["arguments"], "diagnosis": "unsupported"}}
    check("malformed extra arguments are not silently dropped", len(discard_unknown_state_candidates({"needs_action": True, "actions": [extra]})["actions"]) == 1)
    bad_order = {"needs_action": True, "actions": [unknown, {**body, "execution_order": 1}]}
    check("unknown filter does not repair malformed sequence", discard_unknown_state_candidates(bad_order) is bad_order)
    # 명시적 null과 필드 누락은 다릅니다. 누락된 계약을 임의 복구하지 않습니다.
    adapted = discard_unknown_state_candidates({"needs_action": True, "actions": [{**unknown, "arguments": None}, body]})
    check("explicit null placeholder preserves valid Body", len(adapted["actions"]) == 1 and
          OrchestratorResult.model_validate(adapted).actions[0].type == "body_state")
    missing = {key: value for key, value in unknown.items() if key != "arguments"}
    check("missing argument field is not silently dropped", len(discard_unknown_state_candidates({"needs_action": True, "actions": [missing]})["actions"]) == 1)
    bad_flag = {"needs_action": False, "actions": [unknown, body]}
    check("unknown filter does not repair invalid action flag", discard_unknown_state_candidates(bad_flag) is bad_flag)



def run_routing():
    """실제 OpenAI Structured Output의 축/시제/주체 경계를 저장까지 검증합니다."""
    from agent.body_state_schemas import BODY_AXES
    from models.body_state_event import BodyStateEvent

    uid, _, cid = fixture(); client = TestClient(main.app); failures = []
    # H/L: >=.7 / <.4. 목록에 없는 인지 축은 반드시 NULL이어야 합니다.
    cases = [
        ("오늘 코딩에 엄청 집중돼.", {"focus": "H"}, None, False),
        ("집중이 하나도 안 돼.", {"focus": "L"}, None, False),
        ("자꾸 딴생각 나.", {"focus": "L"}, None, False),
        ("할 일이 너무 많아서 머리가 복잡해.", {"mental_load": "H"}, None, False),
        ("생각할 게 너무 많아.", {"mental_load": "H"}, None, False),
        ("생각할 부담이 없어져서 머리가 한결 가벼워.", {"mental_load": "L"}, None, False),
        ("개발하고 싶은 마음이 엄청 커.", {"motivation": "H"}, None, False),
        ("개발하고 싶은 마음이 없어.", {"motivation": "L"}, None, False),
        ("아무것도 하기 싫어.", {"motivation": "L"}, None, False),
        ("이 방향이 맞는지 모르겠어.", {"uncertainty": "H"}, None, False),
        ("둘 중 뭘 선택해야 할지 모르겠어.", {"uncertainty": "H"}, None, False),
        ("이제 뭘 해야 할지 확실히 알겠어.", {"clarity": "H"}, None, False),
        ("생각이 하나도 정리가 안 돼.", {"clarity": "L"}, None, False),
        ("해야 할 건 정확히 아는데 이 방법이 맞는지는 모르겠어.", {"clarity": "H", "uncertainty": "H"}, None, False),
        ("개발하고 싶은데 몸에 힘이 없어.", {"motivation": "H"}, {"energy": "L"}, False),
        ("기분이 좋아.", None, None, True),
        ("몸이 너무 피곤해.", None, {"fatigue": "H"}, False),
        ("집중이 안 되고 너무 피곤해.", {"focus": "L"}, {"fatigue": "H"}, False),
        ("친구가 머리가 복잡하대.", None, None, False),
        ("어제는 복잡했는데 지금은 생각이 정리됐어.", {"clarity": "H"}, None, False),
        ("불안해.", None, None, True),
        ("불안해서 무슨 선택을 해야 할지 모르겠어.", {"uncertainty": "H"}, None, True),
        ("몸에 힘이 없어.", None, {"energy": "L"}, False),
        ("개발하고 싶은 마음은 엄청 큰데 집중이 하나도 안 돼.", {"motivation": "H", "focus": "L"}, None, False),
        ("머리는 너무 복잡하지만 이 작업에는 엄청 집중 중이야.", {"mental_load": "H", "focus": "H"}, None, False),
        ("어제는 머리가 복잡했어.", None, None, False),
        ("내일은 집중 잘해야지.", None, None, False),
        ("친구가 집중이 안 된대.", None, None, False),
        ("오늘 부산 날씨가 어떻게 돼?", None, None, False),
    ]

    def axes_match(arguments, expected, axes):
        """언급 없는 축도 검사해 높은 recall만으로 성공을 선언하지 않습니다."""
        return all(getattr(arguments, a) is None if a not in expected else
                   getattr(arguments, a) is not None and
                   (expected[a] != "H" or getattr(arguments, a) >= .7) and
                   (expected[a] != "L" or getattr(arguments, a) < .4) for a in axes)

    for index, (utterance, expected, body_expected, emotion) in enumerate(cases, 1):
        memories = [OrchestratorMemoryContext(content="사용자는 늘 집중이 안 되고 머리가 복잡하며 의욕이 없다.", relevance=.9)] if index in {16,20,29} else []
        result = orchestrate_with_openai(utterance, memories)
        cognitive = [a for a in result.actions if a.type == "cognitive_state"]
        bodies = [a for a in result.actions if a.type == "body_state"]
        valid = not cognitive if expected is None else (
            len(cognitive) == 1 and cognitive[0].intent == "record_cognitive_state"
            and axes_match(cognitive[0].arguments, expected, COGNITIVE_AXES))
        valid = valid and (not bodies if body_expected is None else len(bodies) == 1
                           and axes_match(bodies[0].arguments, body_expected, BODY_AXES))
        if emotion:
            valid = valid and any(a.intent == "record_emotion" for a in result.actions)
        if not valid:
            failures.append(index)
            print("ROUTING_MISMATCH", index, utterance, result.model_dump_json(), flush=True)
        else:
            check(f"live routing {index}", True)
        mid = message(uid, cid, utterance)
        plans = create_tool_plan(ToolPlanRequest(actions=[GatewayAction.model_validate(a.model_dump()) for a in result.actions])).plans
        executable = [p for p in plans if p.tool_name in {"record_cognitive_state", "record_body_state", "record_emotion"} and p.status == "ready"]
        if executable:
            save(client, uid, cid, mid, executable)
            for item in executable:
                response = execute(client, uid, item.action_id)
                check(f"live domain {index}/{item.tool_name}", response.status_code == 200 and response.json()["action"]["status"] == "completed")
        with SessionLocal() as db:
            records = list(db.scalars(select(CognitiveStateEvent).where(CognitiveStateEvent.message_id == mid)).all())
            body_records = list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.message_id == mid)).all())
            emotions = list(db.scalars(select(EmotionEvent).where(EmotionEvent.message_id == mid)).all())
        check(f"live DB count {index}", len(records) == len(cognitive) and len(body_records) == len(bodies) and (not emotion or len(emotions) == 1))
    print(f"ROUTING_CASES={len(cases)-len(failures)}/{len(cases)}; failures={failures}", flush=True)
    if failures:
        raise AssertionError(f"routing meaning mismatches: {failures}")


def run_live_chat():
    """채팅과 Orchestrator는 실제 OpenAI를 쓰고 Memory 자동 추출만 테스트에서 제외합니다."""
    from models.body_state_event import BodyStateEvent

    uid, _, cid = fixture(); client = TestClient(main.app)
    with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(uid), "NOIE_DEV_CONVERSATION_ID": str(cid)}), \
         patch.object(main, "run_memory_extraction_background", lambda *args: None):
        def evidence_rows(request_id):
            """같은 원문에 연결된 Body/Cognitive를 새 세션으로 확인합니다."""
            with SessionLocal() as db:
                evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == request_id))
                cognitive = list(db.scalars(select(CognitiveStateEvent).where(CognitiveStateEvent.message_id == evidence.id)).all())
                bodies = list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.message_id == evidence.id)).all())
                actions = list(db.scalars(select(AgentAction).where(AgentAction.message_id == evidence.id)).all())
                return evidence, cognitive, bodies, actions

        for utterance, axis in [
            ("피곤하지만 개발은 하고 싶고 머리가 너무 복잡해.", "mental_load"),
            ("피곤하지만 개발은 하고 싶고 집중은 하나도 안 돼.", "focus"),
        ]:
            body = {"text": utterance, "request_id": str(uuid4())}
            response = client.post("/chat", json=body)
            check(f"live /chat OpenAI 200/{axis}", response.status_code == 200 and response.json()["source"] == "openai" and bool(response.json()["reply"]))
            evidence, cognitive, bodies, actions = evidence_rows(body["request_id"])
            check(f"live /chat independent Body + Cognitive/{axis}", evidence.content == utterance and len(cognitive) == 1 and len(bodies) == 1 and cognitive[0].motivation >= .7 and
                  getattr(cognitive[0], axis) is not None and (getattr(cognitive[0], axis) >= .7 if axis == "mental_load" else getattr(cognitive[0], axis) < .4) and bodies[0].fatigue is not None)
            repeated = client.post("/chat", json=body)
            _, after, bodies_after, actions_after = evidence_rows(body["request_id"])
            check(f"live /chat idempotency/{axis}", repeated.status_code == 200 and repeated.json() == response.json() and len(after) == len(bodies_after) == 1 and len(actions_after) == len(actions))
        register_executor("record_cognitive_state", lambda context: record_cognitive_state_executor(context, before_insert=fail))
        try:
            body = {"text": "몸이 너무 피곤하고 머리가 너무 복잡해.", "request_id": str(uuid4())}
            response = client.post("/chat", json=body)
            _, cognitive, bodies, actions = evidence_rows(body["request_id"])
            check("Cognitive failure isolated / Body preserved", response.status_code == 200 and not cognitive and len(bodies) == 1 and
                  any(a.tool_name == "record_cognitive_state" and a.status == "failed" for a in actions))
        finally:
            register_executor("record_cognitive_state", record_cognitive_state_executor)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-routing", action="store_true")
    parser.add_argument("--routing-only", action="store_true")
    parser.add_argument("--live-chat-only", action="store_true")
    args = parser.parse_args()
    if not args.routing_only and not args.live_chat_only:
        run_validation(); run_output_contract(); run_database()
    if args.live_routing or args.routing_only:
        run_routing()
    if args.live_routing or args.live_chat_only:
        run_live_chat()
    print(f"SUMMARY={PASSED} passed", flush=True)
