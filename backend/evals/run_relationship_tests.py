"""Relationship 계약, 실제 PostgreSQL 장애/격리, OpenAI 의미와 /chat 회귀를 검증합니다."""

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
import main
from agent.executor_registry import ExecutorContext, register_executor
from agent.executor_service import _acquire_lease, _finish_failure, _finish_success
from agent.orchestrator import isolate_relationship_candidates, orchestrate_with_openai
from agent.record_relationship_event_executor import record_relationship_event_executor
from agent.relationship_schemas import RecordRelationshipArguments
from agent.relationship_event_service import validate_relationship_evidence
from agent.schemas import OrchestratorMemoryContext, OrchestratorResult
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.relationship_event import RelationshipEvent
from models.user import User

PASSED = 0


def check(label, value):
    """실패를 숨기지 않고 해당 항목에서 검사를 중단합니다."""
    global PASSED
    if not value:
        raise AssertionError(label)
    PASSED += 1
    print(f"[PASS] {label}", flush=True)


def record(statement="민수는 내 친구야", **fields):
    """명시적 근거 테스트 기본값이며 실제 사용자 데이터를 사용하지 않습니다."""
    return {"person_label": "민수", "identity_kind": "named", "record_kind": "social_relation",
            "relationship_type": "friend", "meaning_relation_type": None,
            "relationship_statement": statement, "temporal_scope": "current", "confidence": .95, **fields}


def action(records=None, **fields):
    """기존 Gateway와 호환되는 한 action의 묶음 계약을 만듭니다."""
    return {"type": "relationship", "intent": "record_relationship_event", "mode": "record",
            "reason": "현재 사용자 직접 진술", "confidence": .95, "requires_confirmation": False,
            "execution_order": 1, "arguments": {"records": records or [record()]}, **fields}


def plan(records=None):
    """새 실행 경로가 아니라 기존 Gateway를 사용합니다."""
    return create_tool_plan(ToolPlanRequest(actions=[GatewayAction.model_validate(action(records))])).plans[0]


def fixture():
    """모든 쓰기는 표시된 신규 사용자에 한정하며 기존 데이터를 정리/삭제하지 않습니다."""
    with SessionLocal() as db:
        marker = uuid4().hex
        user = User(name=f"__relationship_v1__{marker}", metadata_={"test": "relationship-v1"})
        other = User(name=f"__relationship_other__{marker}", metadata_={"test": "relationship-v1"})
        db.add_all([user, other]); db.flush()
        conversation = Conversation(user_id=user.id, title=marker, metadata_={"test": "relationship-v1"})
        db.add(conversation); db.commit()
        print(f"TEST_USER_ID={user.id}", flush=True)
        return user.id, other.id, conversation.id


def message(uid, cid, content, role="user"):
    """사용자 입력은 원문 그대로 저장합니다."""
    with SessionLocal() as db:
        item = Message(user_id=uid if role == "user" else None, conversation_id=cid, role=role,
                       content=content, metadata_={"test": "relationship-v1"})
        db.add(item); db.commit()
        return item.id


def save(client, uid, cid, mid, candidate):
    """Action Persistence API에서 검증한 계획만 실행 대상으로 저장합니다."""
    response = client.post("/agent/actions/plan", json={"user_id": str(uid), "conversation_id": str(cid),
        "message_id": str(mid), "plans": [candidate.model_dump(mode="json")]})
    check("persist action", response.status_code == 201)
    return response


def execute(client, uid, aid):
    """공통 lease/retry/fencing API를 호출합니다."""
    return client.post(f"/agent/actions/{aid}/execute", json={"user_id": str(uid)})


def rows(aid):
    """새 세션에서 저장 결과를 확인합니다."""
    with SessionLocal() as db:
        item = db.scalar(select(AgentAction).where(AgentAction.action_id == aid))
        records = list(db.scalars(select(RelationshipEvent).where(RelationshipEvent.agent_action_id == item.id)
                       .order_by(RelationshipEvent.record_index)).all())
        return item, records


def fail():
    """테스트용 오류만 발생시키고 내부 내용은 응답에 노출하지 않습니다."""
    raise RuntimeError("private relationship test fault")


def run_validation():
    """DB 없이 계약 범위, 원문 근거, 목적별 OpenAI payload를 확인합니다."""
    check("gateway implemented Record", plan().status == "ready" and plan().implemented)
    invalid = [[], [record(relationship_type=None)], [record(record_kind="relationship_state")],
               [record(meaning_relation_type="fan_of")], [record(temporal_scope="future")],
               [record(identity_kind="canonical")], [record(person_label="없는이름")],
               [record(), record()], [record()] * 9]
    for index, records in enumerate(invalid):
        try: RecordRelationshipArguments(records=records)
        except ValidationError: check(f"invalid records {index}", True)
        else: raise AssertionError(f"accepted invalid {index}")
    for value in (-.01, 1.01, True, "0.9", float("nan"), float("inf")):
        try: RecordRelationshipArguments(records=[record(confidence=value)])
        except ValidationError: check("invalid confidence", True)
        else: raise AssertionError("accepted confidence")
    for fields in ({"mode": "execute"}, {"type": "emotion"}, {"requires_confirmation": True}, {"arguments": None}):
        try: GatewayAction.model_validate(action(**fields))
        except ValidationError: check("Gateway boundary", True)
        else: raise AssertionError("Gateway accepted")
    for statement in ("민수가 내 친구야?", "민수가 친구였으면 좋겠다", "민수는 이제 친구가 아니야"):
        try: validate_relationship_evidence(RecordRelationshipArguments(records=[record(statement)]), statement)
        except ValueError: check("nonpositive social evidence rejected", True)
        else: raise AssertionError(statement)
    for example, content in [
        (record("민수와 철수는 친구야"), "민수와 철수는 친구야"),
        (record("민수는 철수의 친구야"), "민수는 철수의 친구야"),
        (record("민수는 내 친구"), "민수는 내 친구야?"),
        (record("민수를 자주 만나"), "민수를 자주 만나"),
    ]:
        try: validate_relationship_evidence(RecordRelationshipArguments(records=[example]), content)
        except ValueError: check("social source context/inference defense", True)
        else: raise AssertionError("unsupported social evidence accepted")
    # 미래 희망을 현재 관찰/상태로 잘못 분류해도 공통 원문 검증과 Executor가 거부합니다.
    for kind in ("observation", "relationship_state"):
        statement = "민수랑 내일 저녁 먹고 싶어."
        args = RecordRelationshipArguments(records=[record(statement, record_kind=kind, relationship_type=None)])
        try: validate_relationship_evidence(args, statement)
        except ValueError: check(f"future {kind} evidence rejected", True)
        else: raise AssertionError("future evidence accepted")
    # 미래 희망을 말했던 과거 대화 사건까지 미래 계획으로 오인하지 않습니다.
    statement = "민수랑 내일 저녁 먹고 싶다고 이야기했어."
    validate_relationship_evidence(RecordRelationshipArguments(records=[record(statement, record_kind="observation", relationship_type=None, temporal_scope="past")]), statement)
    check("past discussion about future plan preserved", True)
    try: validate_relationship_evidence(RecordRelationshipArguments(records=[record()]), "다른 이야기")
    except ValueError: check("fabricated evidence rejected", True)
    else: raise AssertionError("fabricated evidence accepted")
    check("interpretation confidence gates Record", plan([record(confidence=.39)]).status == "needs_review")

    captured = []
    def create(**kwargs):
        """합성 응답으로 전송 필드를 검사하며 실제 키/개인정보를 출력하지 않습니다."""
        captured.append(kwargs)
        return SimpleNamespace(output_text=json.dumps({"needs_action": True, "actions": [action()]}, ensure_ascii=False))
    with patch("agent.orchestrator.OpenAI", return_value=SimpleNamespace(responses=SimpleNamespace(create=create))), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "test-only-not-a-real-key"}):
        result = orchestrate_with_openai("민수는 내 친구야", [OrchestratorMemoryContext(content="과거 사용자 Memory", relevance=.9)])
    check("Memory routing rejudged source-only", len(captured) == 2 and len(result.actions) == 1)
    payload = json.loads(captured[1]["input"][1]["content"])
    check("Relationship payload has only current utterance", payload == {"current_user_utterance": "민수는 내 친구야"})
    check("Relationship-only schema cannot record other domains", captured[1]["text"]["format"]["schema"]["properties"]["actions"]["items"]["properties"]["type"]["enum"] == ["relationship"])
    # 일반 routing이 분리한 friend/colleague는 두 역할을 잃지 않고 한 action으로 모읍니다.
    statement = "민수는 내 친구이자 회사 동료야"
    merged = isolate_relationship_candidates({"needs_action": True, "actions": [
        action([record(statement)]), action([record(statement, relationship_type="colleague")], execution_order=2),
    ]}, statement)
    check("multiple actions preserve both records", len(OrchestratorResult.model_validate(merged).actions) == 1 and len(merged["actions"][0]["arguments"]["records"]) == 2)
    daily = {"type": "daily_life", "intent": "record_daily_trace", "mode": "record", "reason": "명시적 완료",
             "confidence": .9, "requires_confirmation": False, "execution_order": 2,
             "arguments": {"summary": "저녁 먹음", "category": None}}
    filtered = isolate_relationship_candidates({"needs_action": True, "actions": [action([record("없는 민수 근거")]), daily]}, "오늘 저녁 먹었어")
    check("invalid relationship does not drop Daily", len(filtered["actions"]) == 1 and filtered["actions"][0]["type"] == "daily_life" and filtered["actions"][0]["execution_order"] == 1)
    calls = []
    def failed_source(**kwargs):
        """관계 전용 재판단 실패가 이미 성공한 일반 domain을 취소하지 않는지 검사합니다."""
        calls.append(kwargs)
        if len(calls) > 1: raise RuntimeError("synthetic source-only outage")
        return SimpleNamespace(output_text=json.dumps({"needs_action": True, "actions": [action(), daily]}, ensure_ascii=False))
    with patch("agent.orchestrator.OpenAI", return_value=SimpleNamespace(responses=SimpleNamespace(create=failed_source))), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "test-only-not-a-real-key"}):
        result = orchestrate_with_openai("민수는 내 친구야. 오늘 저녁 먹었어", [OrchestratorMemoryContext(content="과거 근거", relevance=.9)])
    check("source-only outage preserves other domain", len(result.actions) == 1 and result.actions[0].type == "daily_life")
    from chat_agent_integration_service import _deterministic_action_id
    request_id = uuid4(); message_id = uuid4()
    first = GatewayAction.model_validate(action()); later = GatewayAction.model_validate(action(execution_order=3))
    check("chat relationship ID independent of routing order", _deterministic_action_id(request_id, message_id, first) == _deterministic_action_id(request_id, message_id, later))


def run_database():
    """실제 PostgreSQL에서 묶음 원자성/중복/소유권/lease를 검사합니다."""
    uid, oid, cid = fixture(); client = TestClient(main.app)
    statement = "민수는 내 친구이자 회사 동료야"
    mid = message(uid, cid, statement)
    records = [record(statement), record(statement, relationship_type="colleague")]
    candidate = plan(records); save(client, uid, cid, mid, candidate)
    check("two relations complete", execute(client, uid, candidate.action_id).json()["action"]["status"] == "completed")
    item, stored = rows(candidate.action_id)
    check("friend and colleague preserved", len(stored) == 2 and {r.relationship_type for r in stored} == {"friend", "colleague"})
    check("exact evidence and null meaning", all(r.relationship_statement == statement and r.message_id == mid and r.conversation_id == cid and r.user_id == uid and r.meaning_relation_type is None for r in stored))
    check("completed reuse", not execute(client, uid, candidate.action_id).json()["executor_called"] and len(rows(candidate.action_id)[1]) == 2)
    detail = client.get(f"/relationship-events/{stored[0].id}", params={"user_id": str(uid)})
    check("owner read evidence", detail.status_code == 200 and detail.json()["record_kind"] == "social_relation")
    check("other owner read blocked", client.get(f"/relationship-events/{stored[0].id}", params={"user_id": str(oid)}).status_code == 404)
    check("other owner execute blocked", execute(client, oid, candidate.action_id).status_code == 404)
    check("list evidence read", client.get(f"/users/{uid}/relationship-events").status_code == 200)

    for label, example in [
        ("past", record("민수는 예전에 친구였어", temporal_scope="past")),
        ("state", record("민수한테 요즘 서운해", record_kind="relationship_state", relationship_type=None)),
        ("temporary", record("헬스장 형이 자세 알려줬어", person_label="헬스장 형", identity_kind="temporary", record_kind="observation", relationship_type=None)),
        ("meaning", record("손흥민 팬이야", person_label="손흥민", record_kind="meaning_relation", relationship_type=None, meaning_relation_type="fan_of")),
        ("famous social", record("아이유는 실제 내 친구야", person_label="아이유")),
    ]:
        p = plan([example]); m = message(uid, cid, example["relationship_statement"]); save(client, uid, cid, m, p)
        check(f"DB {label}", execute(client, uid, p.action_id).json()["action"]["status"] == "completed" and len(rows(p.action_id)[1]) == 1)

    for hook in ("before_insert", "before_commit"):
        p = plan(records); save(client, uid, cid, mid, p)
        register_executor("record_relationship_event", lambda context, hook=hook: record_relationship_event_executor(context, **{hook: fail}))
        try:
            response = execute(client, uid, p.action_id)
            check(f"{hook} whole batch rollback", response.json()["action"]["status"] == "failed" and not rows(p.action_id)[1] and "private relationship" not in response.text)
        finally: register_executor("record_relationship_event", record_relationship_event_executor)
        check(f"{hook} retry", execute(client, uid, p.action_id).json()["action"]["status"] == "completed" and len(rows(p.action_id)[1]) == 2)

    concurrent = plan(records); save(client, uid, cid, mid, concurrent)
    barrier = threading.Barrier(2); responses = []; errors = []
    def worker():
        """동시 실행 결과를 수집하고 미종료 스레드도 실패로 처리합니다."""
        try:
            barrier.wait(timeout=10); responses.append(execute(TestClient(main.app), uid, concurrent.action_id))
        except Exception as error: errors.append(type(error).__name__)
    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=60)
    check("concurrent one attempt one batch", not errors and not any(t.is_alive() for t in threads) and len(responses) == 2 and all(r.status_code in (200, 409) for r in responses) and rows(concurrent.action_id)[0].attempt_count == 1 and len(rows(concurrent.action_id)[1]) == 2)

    lost = plan(records); save(client, uid, cid, mid, lost)
    _, lease = _acquire_lease(lost.action_id, uid)
    context = ExecutorContext(str(lost.action_id), str(uid), "record_relationship_event", lease.attempt_count)
    result = record_relationship_event_executor(context)
    check("committed batch before finalize", rows(lost.action_id)[0].status == "processing" and len(rows(lost.action_id)[1]) == 2)
    with SessionLocal() as db:
        a = db.scalar(select(AgentAction).where(AgentAction.action_id == lost.action_id))
        a.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    try: record_relationship_event_executor(context)
    except Exception: check("expired lease cannot write", True)
    else: raise AssertionError("expired lease accepted")
    check("finalize loss retry exact reuse", execute(client, uid, lost.action_id).json()["action"]["result"]["data"]["relationship_event_ids"] == result.data["relationship_event_ids"] and not rows(lost.action_id)[0].result["data"]["recorded"])
    check("late finalizers fenced", _finish_success(lease, result)[1] and _finish_failure(lease, RuntimeError())[1])
    try: record_relationship_event_executor(context)
    except Exception: check("stale executor fenced", len(rows(lost.action_id)[1]) == 2)
    else: raise AssertionError("stale accepted")

    # Action 계획 API를 우회해 잘못 연결한 신규 테스트 action도 Executor가 거부해야 합니다.
    for label, mutation in [("wrong owner", {"user_id": oid}), ("missing message", {"message_id": uuid4()}),
                            ("missing evidence", {"message_id": None}), ("wrong conversation", {"conversation_id": None})]:
        p = plan(records); save(client, uid, cid, mid, p)
        with SessionLocal() as db:
            a = db.scalar(select(AgentAction).where(AgentAction.action_id == p.action_id))
            for key, value in mutation.items(): setattr(a, key, value)
            try: db.commit()
            except IntegrityError:
                db.rollback(); check(f"DB FK rejects {label}", label == "missing message"); continue
        owner = oid if label == "wrong owner" else uid
        check(f"executor rejects {label}", execute(client, owner, p.action_id).json()["action"]["status"] == "failed" and not rows(p.action_id)[1])
    for role in ("assistant", "system"):
        p = plan(); m = message(uid, cid, "민수는 내 친구야", role); response = client.post("/agent/actions/plan", json={"user_id": str(uid), "conversation_id": str(cid), "message_id": str(m), "plans": [p.model_dump(mode="json")]})
        if response.status_code == 201:
            check(f"{role} evidence blocked by executor", execute(client, uid, p.action_id).json()["action"]["status"] == "failed" and not rows(p.action_id)[1])
        else: check(f"{role} evidence blocked by persistence", response.status_code in (404,422))

    # 동일 action의 UNIQUE와 종류 CHECK는 직접 SQL 쓰기에도 적용됩니다.
    base = {key: getattr(stored[0], key) for key in ("user_id", "conversation_id", "message_id", "agent_action_id", "record_index", "person_label", "identity_kind", "record_kind", "relationship_type", "meaning_relation_type", "relationship_statement", "temporal_scope", "confidence")}
    for label, fields in [("unique", {}), ("bad kind", {"record_index": 6, "relationship_type": "enemy"}),
                          ("null kind", {"record_index": 6, "relationship_type": None}),
                          ("future", {"record_index": 6, "temporal_scope": "future"}),
                          ("nan", {"record_index": 6, "confidence": float("nan")})]:
        with SessionLocal() as db:
            try: db.add(RelationshipEvent(**{**base, **fields})); db.commit()
            except IntegrityError: db.rollback(); check(f"DB constraint {label}", True)
            else: raise AssertionError(f"DB accepted {label}")
    with SessionLocal() as db:
        check("original message unchanged", db.get(Message, mid).content == statement)
    check("real DB health", client.get("/db-health").status_code == 200)


SEMANTIC_CASES = [
    ("민수는 내 친구야", {("social_relation", "friend", None, "current")}),
    ("지영이는 회사 동료야", {("social_relation", "colleague", None, "current")}),
    ("민수는 고등학교 친구인데 지금 회사 동료야", {("social_relation", "friend", None, "current"), ("social_relation", "colleague", None, "current")}),
    ("민수는 예전에 친구였어", {("social_relation", "friend", None, "past")}),
    ("민수는 친구인데 요즘 좀 불편해", {("social_relation", "friend", None, "current"), ("relationship_state", None, None, "current")}),
    ("민수한테 요즘 서운해", {("relationship_state", None, None, "current")}),
    ("민수랑 싸웠어", {("observation", None, None, "past")}),
    ("헬스장 형이 자세 알려줬어", {("observation", None, None, "past")}),
    ("같은 과 누나가 도와줬어", {("observation", None, None, "past")}),
    ("걔가 도와줬어", set()),
    ("손흥민 팬이야", {("meaning_relation", None, "fan_of", "current")}),
    ("아이유는 내 롤모델이야", {("meaning_relation", None, "role_model", "current")}),
    ("그 개발자한테 영향을 많이 받았어", set()),
    ("민수를 자주 만나", {("observation", None, None, "current")}),
    ("민수랑 자주 연락해", {("observation", None, None, "current")}),
    ("민수와 철수는 친구야", set()),
    ("민수가 내 친구야?", set()),
    ("민수가 친구였으면 좋겠다", set()),
    ("민수는 이제 친구가 아니야", set()),
    ("아이유는 실제 내 친구야", {("social_relation", "friend", None, "current")}),
    ("유튜버 A를 자주 봐", {("meaning_relation", None, "follows", "current")}),
    ("민수랑 이야기하고 풀었어", {("relationship_state", None, None, "past")}),
]


def run_routing(*, integrated=False):
    """합성 문장만 실제 OpenAI에 보내고 expectation을 임의로 바꾸지 않습니다."""
    failures = []
    for index, (utterance, expected) in enumerate(SEMANTIC_CASES, 1):
        try:
            # 전용 판정뿐 아니라 실제 일반 Orchestrator 안의 도메인 선택도 별도로 측정합니다.
            result = orchestrate_with_openai(utterance, relationship_only=not integrated)
            records = [r for a in result.actions if a.intent == "record_relationship_event" for r in a.arguments.records]
            actual = {(r.record_kind, r.relationship_type, r.meaning_relation_type, r.temporal_scope) for r in records}
            valid = actual == expected and len(records) == len(expected)
            if index in (8,9): valid = valid and all(r.identity_kind == "temporary" for r in records)
            if valid: check(f"OpenAI semantic {index}", True)
            else: failures.append(index)
            print(json.dumps({"case": index, "text": utterance, "pass": valid, "result": result.model_dump()}, ensure_ascii=False), flush=True)
        except Exception as error:
            failures.append(index); print(f"[FAIL] semantic {index}: {type(error).__name__}", flush=True)
    print(f"SEMANTIC_RESULT={len(SEMANTIC_CASES)-len(failures)}/{len(SEMANTIC_CASES)}; failures={failures}", flush=True)
    if failures: raise AssertionError(f"semantic cases: {failures}")


def run_general_routing():
    """일반 Orchestrator에서 대표 action 흡수와 완료 사건 음성 경계를 재검증합니다."""
    cases = [
        ("민수는 내 친구야.", {"record_relationship_event"}, {"record_daily_trace"}),
        ("민수는 내 친구야. 오늘 친구 민수랑 저녁 먹었어.", {"record_relationship_event", "record_daily_trace"}, set()),
        ("지영이는 회사 동료야. 오늘 동료 지영이랑 점심 먹었어.", {"record_relationship_event", "record_daily_trace"}, set()),
        ("오늘 운동했고 기분도 좋아.", {"record_emotion", "record_daily_trace"}, set()),
        ("민수랑 내일 저녁 먹고 싶어.", set(), {"record_relationship_event", "record_daily_trace"}),
        ("친구가 저녁 먹었대.", set(), {"record_relationship_event", "record_daily_trace"}),
        ("지금 서면이야.", {"record_place_event"}, {"record_daily_trace"}),
        ("안녕.", set(), {"record_relationship_event", "record_daily_trace"}),
    ]
    failures = []
    for index, (utterance, required, forbidden) in enumerate(cases, 1):
        try:
            result = orchestrate_with_openai(utterance)
            intents = {action.intent for action in result.actions}
            valid = required <= intents and not (forbidden & intents)
            print(f"GENERAL_CASE={index}; intents={sorted(intents)}; pass={valid}", flush=True)
            if valid: check(f"general routing {index}", True)
            else: failures.append(index)
        except Exception as error:
            failures.append(index); print(f"[FAIL] general {index}: {type(error).__name__}", flush=True)
    print(f"GENERAL_RESULT={len(cases)-len(failures)}/{len(cases)}", flush=True)
    if failures: raise AssertionError(f"general routing cases: {failures}")


def run_chat():
    """실제 OpenAI/PG /chat과 중복 요청, 독립 domain 실패를 검증합니다."""
    uid, _, cid = fixture(); client = TestClient(main.app)
    with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(uid), "NOIE_DEV_CONVERSATION_ID": str(cid)}), \
         patch.object(main, "run_memory_extraction_background", lambda *args: None):
        # 단일 명시적 관계도 일반 /chat에서 기록되는지 확인합니다.
        single = {"text": "민수는 내 친구야.", "request_id": str(uuid4())}
        single_reply = client.post("/chat", json=single)
        with SessionLocal() as db:
            single_source = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == single["request_id"]))
            single_records = list(db.scalars(select(RelationshipEvent).where(RelationshipEvent.message_id == single_source.id)).all()) if single_source is not None else []
        check("actual /chat single relationship", single_reply.status_code == 200 and single_reply.json()["source"] == "openai" and any(r.relationship_type == "friend" for r in single_records))
        body = {"text": "민수는 내 친구야. 오늘 친구 민수랑 저녁 먹었어.", "request_id": str(uuid4())}
        response = client.post("/chat", json=body)
        check("actual /chat reply", response.status_code == 200 and response.json()["source"] == "openai" and bool(response.json()["reply"]))
        with SessionLocal() as db:
            evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == body["request_id"]))
            assistant = db.scalar(select(Message).where(Message.role == "assistant", Message.metadata_["request_id"].astext == body["request_id"]))
            records = list(db.scalars(select(RelationshipEvent).where(RelationshipEvent.message_id == evidence.id)).all())
            actions = list(db.scalars(select(AgentAction).where(AgentAction.message_id == evidence.id)).all())
            check("/chat raw source and multi action", evidence.content == body["text"] and any(r.relationship_type == "friend" for r in records) and any(a.tool_name == "record_daily_trace" and a.status == "completed" for a in actions))
            check("actual OpenAI assistant stored unchanged", assistant is not None and assistant.metadata_["source"] == "openai" and assistant.content == response.json()["reply"] and assistant.user_id is None)
        repeated = client.post("/chat", json=body)
        with SessionLocal() as db:
            after = list(db.scalars(select(RelationshipEvent).where(RelationshipEvent.message_id == evidence.id)).all())
            user_messages = list(db.scalars(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == body["request_id"])).all())
        check("/chat duplicate request exact cached response", repeated.json() == response.json() and len(user_messages) == 1 and [r.id for r in after] == [r.id for r in records])
        # 새로운 request_id의 같은 발화는 사용자의 정상적인 새 기록입니다.
        another = {**body, "request_id": str(uuid4())}
        second = client.post("/chat", json=another)
        with SessionLocal() as db:
            new_source = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == another["request_id"]))
            new_records = list(db.scalars(select(RelationshipEvent).where(RelationshipEvent.message_id == new_source.id)).all())
        check("new request same text is not deduplicated", second.status_code == 200 and new_source.id != evidence.id and any(r.relationship_type == "friend" for r in new_records))
        register_executor("record_relationship_event", lambda context: record_relationship_event_executor(context, before_commit=fail))
        try:
            body = {"text": "지영이는 회사 동료야. 오늘 동료 지영이랑 점심 먹었어.", "request_id": str(uuid4())}
            response = client.post("/chat", json=body)
            with SessionLocal() as db:
                evidence = db.scalar(select(Message).where(Message.role == "user", Message.metadata_["request_id"].astext == body["request_id"]))
                records = list(db.scalars(select(RelationshipEvent).where(RelationshipEvent.message_id == evidence.id)).all())
                actions = list(db.scalars(select(AgentAction).where(AgentAction.message_id == evidence.id)).all())
            check("Relationship failure isolates reply and Daily", response.status_code == 200 and bool(response.json()["reply"]) and not records and any(a.tool_name == "record_relationship_event" and a.status == "failed" for a in actions) and any(a.tool_name == "record_daily_trace" and a.status == "completed" for a in actions))
        finally: register_executor("record_relationship_event", record_relationship_event_executor)


def run_safety():
    """추가로 활성 상태, 유효 lease 경쟁, 실제 attempt-count fencing을 검증합니다."""
    uid, _, cid = fixture(); client = TestClient(main.app)
    mid = message(uid, cid, "민수는 내 친구야")
    candidate = plan(); save(client, uid, cid, mid, candidate)
    _, old = _acquire_lease(candidate.action_id, uid)
    try: _acquire_lease(candidate.action_id, uid)
    except Exception as error: check("unexpired lease not stolen", type(error).__name__ == "ExecutorBusyError")
    else: raise AssertionError("valid lease stolen")
    with SessionLocal() as db:
        a = db.scalar(select(AgentAction).where(AgentAction.action_id == candidate.action_id))
        a.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    _, current = _acquire_lease(candidate.action_id, uid)
    old_context = ExecutorContext(str(candidate.action_id), str(uid), "record_relationship_event", old.attempt_count)
    try: record_relationship_event_executor(old_context)
    except Exception: check("old attempt cannot write during newer processing", not rows(candidate.action_id)[1])
    else: raise AssertionError("old attempt wrote")
    from agent.executor_registry import ExecutorResult
    check("old success cannot finalize newer processing", _finish_success(old, ExecutorResult(outcome="test"))[1] and rows(candidate.action_id)[0].status == "processing")
    check("old failure cannot fail newer processing", _finish_failure(old, RuntimeError())[1] and rows(candidate.action_id)[0].status == "processing")
    result = record_relationship_event_executor(ExecutorContext(str(candidate.action_id), str(uid), "record_relationship_event", current.attempt_count))
    check("current attempt finalizes one batch", not _finish_success(current, result)[1] and len(rows(candidate.action_id)[1]) == 1)
    for label in ("conversation", "user"):
        p = plan(); save(client, uid, cid, mid, p)
        with SessionLocal() as db:
            target = db.get(Conversation, cid) if label == "conversation" else db.get(User, uid)
            target.deleted_at = datetime.now(timezone.utc); db.commit()
        check(f"soft deleted {label} cannot record", execute(client, uid, p.action_id).json()["action"]["status"] == "failed" and not rows(p.action_id)[1])
        # 테스트 fixture만 다시 활성화합니다. 기존 사용자 데이터는 접근하지 않습니다.
        with SessionLocal() as db:
            target = db.get(Conversation, cid) if label == "conversation" else db.get(User, uid)
            target.deleted_at = None; db.commit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", action="store_true")
    parser.add_argument("--routing-only", action="store_true")
    parser.add_argument("--live-chat-only", action="store_true")
    parser.add_argument("--safety-only", action="store_true")
    parser.add_argument("--routing-integrated", action="store_true")
    parser.add_argument("--routing-general", action="store_true")
    args = parser.parse_args()
    if args.routing_only: run_routing()
    elif args.live_chat_only: run_chat()
    elif args.safety_only: run_safety()
    elif args.routing_integrated: run_routing(integrated=True)
    elif args.routing_general: run_general_routing()
    else:
        run_validation()
        if args.database: run_database()
    print(f"RELATIONSHIP_SUMMARY={PASSED} passed", flush=True)
