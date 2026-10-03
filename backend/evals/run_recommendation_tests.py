"""추천의 PostgreSQL 무결성/장애/채팅과 실제 OpenAI 의미 경계를 검증합니다."""

import argparse
import json
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import threading
from unittest.mock import patch, MagicMock
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, text as sql_text
from sqlalchemy.exc import IntegrityError
import main
import chat_agent_integration_service as integration
from agent.action_schemas import PersistActionPlanRequest
from agent.action_service import persist_action_plan
from agent.executor_registry import ExecutorContext, register_executor
from agent.executor_service import _acquire_lease, _finish_failure, _finish_success
from agent.orchestrator import isolate_invalid_recommendations, orchestrate_with_openai
import agent.orchestrator as orchestrator_module
from agent.recommendation_context import load_recommendation_context, recommendation_needed, related_memories, question_topics
from agent.recommendation_schemas import RecommendationArguments, RecommendationContext
from agent.schemas import OrchestratorAction, OrchestratorMemoryContext, OrchestratorResult
from agent.suggest_recommendation_executor import suggest_recommendation_executor
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal, engine
from models.agent_action import AgentAction
from models.body_state_event import BodyStateEvent
from models.cognitive_state_event import CognitiveStateEvent
from models.conversation import Conversation
from models.message import Message
from models.recommendation import Recommendation
from models.user import User
from models.dream_goal import DreamGoal
from models.place_event import PlaceEvent
from models.daily_life_event import DailyLifeEvent
from models.schedule import Schedule

PASSED = 0
ARGS = {"primary_action": "20분짜리 작은 작업 하나만 하고 쉬어도 좋아.", "alternative_action": None,
        "rationale": "관련 기록이 적어서 지금 말한 피로와 의욕을 중심으로 제안했어.",
        "confidence": .9, "recommendation_kind": "two_step", "reassess_after_minutes": None}


def check(name, condition):
    """실패 항목은 숨기지 않으며 DB/OAI 성공으로 오인하지 않게 구분합니다."""
    global PASSED
    if not condition:
        raise AssertionError(name)
    PASSED += 1
    print(f"[PASS] {name}", flush=True)


def fixture():
    """기존 사용자 데이터는 건드리지 않고 식별 가능한 테스트 데이터만 추가합니다."""
    with SessionLocal() as db:
        marker = uuid4().hex
        user = User(name=f"__recommendation_v1__{marker}", metadata_={"test": "recommendation-v1"})
        other = User(name=f"__recommendation_other__{marker}", metadata_={"test": "recommendation-v1"})
        db.add_all([user, other]); db.flush()
        conversation = Conversation(user_id=user.id, title=marker, metadata_={"test": "recommendation-v1"})
        db.add(conversation); db.commit()
        print(f"TEST_USER_ID={user.id} CONVERSATION_ID={conversation.id}", flush=True)
        return user.id, other.id, conversation.id


def message(uid, cid, content="피곤하지만 작은 작업은 더 하고 싶어.", role="user"):
    """입력 원문은 그대로 보존합니다."""
    with SessionLocal() as db:
        row = Message(user_id=uid if role == "user" else None, conversation_id=cid, role=role,
                      content=content, metadata_={"test": "recommendation-v1"})
        db.add(row); db.commit(); return row.id


def candidate(arguments=None, **changes):
    """기존 Gateway의 Suggest 경로만 사용합니다."""
    return GatewayAction.model_validate({"type": "recommendation", "intent": "suggest_recommendation", "mode": "suggest",
        "reason": "현재 선택 지원", "confidence": .95, "requires_confirmation": False, "execution_order": 1,
        "arguments": ARGS if arguments is None else arguments, **changes})


def save(uid, cid, mid, action=None):
    """동일 action의 저장에는 기존 Persistence idempotency를 사용합니다."""
    action = action or candidate()
    plan = create_tool_plan(ToolPlanRequest(actions=[action])).plans[0]
    with SessionLocal() as db:
        row = persist_action_plan(db, PersistActionPlanRequest(user_id=uid, conversation_id=cid, message_id=mid, plans=[plan]))[0]
        return row.action_id


def execute(client, uid, aid):
    """추천은 기존 공통 Executor에서 이력만 저장합니다."""
    return client.post(f"/agent/actions/{aid}/execute", json={"user_id": str(uid)})


def rows(aid):
    """별도 세션에서 commit된 결과를 확인합니다."""
    with SessionLocal() as db:
        action = db.scalar(select(AgentAction).where(AgentAction.action_id == aid))
        return action, list(db.scalars(select(Recommendation).where(Recommendation.agent_action_id == action.id)).all())


def fingerprint():
    """현재 존재하는 원문/기억/도메인 row의 지문을 남깁니다. 원문은 출력하지 않습니다."""
    with SessionLocal() as db:
        # chat_requests의 실제 PK는 id가 아니라 request_id입니다.
        return {table: dict(db.execute(sql_text(f"SELECT {'request_id' if table == 'chat_requests' else 'id'}, md5(row_to_json(snapshot_row)::text) FROM {table} snapshot_row")).all())
                for table in ("messages", "memories", "memory_evidence", "memory_extractions", "chat_requests",
                              "emotion_events", "body_state_events", "cognitive_state_events", "schedules", "dream_goals", "daily_life_events", "place_events")}


def originals_unchanged(before):
    """새 테스트 row는 허용하지만 이전에 존재한 row 삭제/변경은 허용하지 않습니다."""
    after = fingerprint()
    return all(all(after[table].get(key) == value for key, value in values.items()) for table, values in before.items())


def fail():
    """안전한 실패 처리를 확인하기 위한 테스트 전용 오류입니다."""
    raise RuntimeError("private recommendation failure")


def run_validation():
    """추천/대안/유한 신뢰도와 직접 Gateway 우회 가능성을 검사합니다."""
    bad = [{**ARGS, "confidence": value} for value in (-.01, 1.01, float("nan"), float("inf"), float("-inf"), True, "0.9")]
    bad += [{**ARGS, "primary_action": " "}, {**ARGS, "rationale": "\t"}, {**ARGS, "extra": "bad"},
            {**ARGS, "alternative_action": "다른 선택"}, {**ARGS, "recommendation_kind": "tradeoff"},
            {**ARGS, "recommendation_kind": "recover_then_reassess"}, {**ARGS, "reassess_after_minutes": True},
            {**ARGS, "reassess_after_minutes": 0}, {**ARGS, "reassess_after_minutes": 121},
            {**ARGS, "recommendation_kind": "tradeoff", "alternative_action": ARGS["primary_action"]}]
    for index, data in enumerate(bad, 1):
        try: RecommendationArguments.model_validate(data)
        except ValidationError: check(f"validation {index}", True)
        else: raise AssertionError(data)
    for changes in ({"type": "emotion"}, {"mode": "record"}, {"mode": "execute"}, {"requires_confirmation": True}, {"arguments": None}):
        # 명시적 null을 helper 기본값으로 바꾸지 않고 원래 Gateway 입력 그대로 검증합니다.
        try: GatewayAction.model_validate({**candidate().model_dump(), **changes})
        except ValidationError: check(f"Gateway rejects {next(iter(changes))}", True)
        else: raise AssertionError(changes)
    for confidence, status in ((.49, "needs_review"), (.50, "ready")):
        item = candidate({**ARGS, "confidence": confidence})
        plan = create_tool_plan(ToolPlanRequest(actions=[item])).plans[0]
        check(f"Suggest threshold {confidence}", plan.status == status and plan.implemented and not plan.requires_confirmation and not plan.can_execute)
    action = OrchestratorAction.model_validate(candidate().model_dump(exclude={"action_id"}))
    try: OrchestratorResult(needs_action=True, actions=[action, action.model_copy(update={"execution_order": 2})])
    except ValidationError: check("multiple recommendations rejected", True)
    else: raise AssertionError("multiple recommendations accepted")
    body = {"type": "body_state", "intent": "record_body_state", "mode": "record", "reason": "현재 피로",
            "confidence": .9, "requires_confirmation": False, "execution_order": 2,
            "arguments": {"fatigue": .9, "confidence": .9}}
    malformed = {**candidate().model_dump(exclude={"action_id"}), "arguments": {**ARGS, "alternative_action": "다른 선택"}}
    remaining = OrchestratorResult.model_validate(isolate_invalid_recommendations({"needs_action": True, "actions": [malformed, body]}))
    check("invalid recommendation preserves Body", len(remaining.actions) == 1 and remaining.actions[0].type == "body_state")
    # 실제 SDK 경계의 payload/schema를 검사합니다. mock 성공은 실제 OpenAI 성공과 구분합니다.
    for utterance in ("오늘 기분 좋아.", "광안리 다녀왔어.", "내일 3시에 수업 있어.", "오늘은 운동하고 자고 개발은 내일 할래."):
        check("plain report/decision gate", not recommendation_needed(utterance))
    for utterance in ("뭐부터 할까?", "지금 개발할까 쉴까?", "집에서 할까 카페 갈까?", "둘 중 뭐가 나을까?"):
        check("explicit choice gate", recommendation_needed(utterance))
    client = MagicMock()
    valid = {"needs_action": True, "actions": [candidate().model_dump(mode="json", exclude={"action_id"})]}
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"}), patch.object(orchestrator_module, "OpenAI", return_value=client), \
         patch.object(orchestrator_module, "extract_output_text", return_value=json.dumps(valid)):
        orchestrate_with_openai("오늘 기분 좋아.")
        plain = json.loads(client.responses.create.call_args.kwargs["input"][1]["content"])
        check("plain SDK payload has no recommendation context", "recommendation_context" not in plain)
        orchestrate_with_openai("지금 개발할까 쉴까?", recommendation_context=RecommendationContext(as_of=datetime.now(timezone.utc)))
        request = client.responses.create.call_args.kwargs
        fields = request["text"]["format"]["schema"]["properties"]["actions"]["items"]["properties"]
        check("personal context schema permits recommendation only", fields["type"]["enum"] == ["recommendation"] and fields["mode"]["enum"] == ["suggest"])
        with patch.object(orchestrator_module, "extract_output_text", return_value=json.dumps({"needs_action": True, "actions": [{**body, "execution_order": 1}]})):
            try: orchestrate_with_openai("지금 개발할까 쉴까?", recommendation_context=RecommendationContext(as_of=datetime.now(timezone.utc)))
            except ValueError: check("personal context cannot produce Body record", True)
            else: raise AssertionError("purpose violation")
    memories = [OrchestratorMemoryContext(content="개발 경험", relevance=.9), OrchestratorMemoryContext(content="반려동물 식사", relevance=.9)]
    check("unrelated retrieved memory excluded", [item.content for item in related_memories(memories, "개발할까 쉴까?")] == ["개발 경험"])
    check("implicit goal conflict gate", recommendation_needed("FM26이 너무 재밌는데 오늘 개발을 하나도 안 했어."))
    check("final decision overrides earlier question", not recommendation_needed("개발할까 했는데 오늘은 쉴래."))
    check("explicit refusal blocks context", not recommendation_needed("뭐부터 할까 했는데 추천해주지 마."))
    check("rest choice does not match easy unrelated topic", not related_memories([OrchestratorMemoryContext(content="쉬운 바이올린 곡", relevance=.9)], "개발할까 쉴까?"))
    check("restaurant/focus is not home", "집" not in question_topics("맛집 추천해줘") and "집" not in question_topics("집중하려면 뭘 할까?"))
    check("home query excludes unrelated focus memory", not related_memories([OrchestratorMemoryContext(content="집중해서 바이올린 연습", relevance=.9)], "집에 갈까?"))


def run_database():
    """실제 PostgreSQL UNIQUE/rollback/lease/fencing/소유권과 context 경계를 검증합니다."""
    before = fingerprint(); uid, oid, cid = fixture(); client = TestClient(main.app); mid = message(uid, cid)
    aid = save(uid, cid, mid); response = execute(client, uid, aid); action, records = rows(aid)
    check("real DB creates one suggestion", response.status_code == 200 and action.status == "completed" and len(records) == 1)
    item = records[0]
    check("original suggestion / message link", item.primary_action == ARGS["primary_action"] and item.message_id == mid and item.user_id == uid)
    check("completed reuse", not execute(client, uid, aid).json()["executor_called"] and len(rows(aid)[1]) == 1)
    check("owner read", client.get(f"/recommendations/{item.id}", params={"user_id": str(uid)}).status_code == 200)
    check("other owner read 404", client.get(f"/recommendations/{item.id}", params={"user_id": str(oid)}).status_code == 404)
    check("other owner execution 404", execute(client, oid, aid).status_code == 404)
    check("read default/max limit", len(client.get(f"/users/{uid}/recommendations").json()) == 1 and client.get(f"/users/{uid}/recommendations?limit=101").status_code == 422)
    concurrent = save(uid, cid, mid); barrier = threading.Barrier(2); responses = []; errors = []
    def worker():
        """같은 action을 동시에 처리해도 유효 attempt와 row는 하나입니다."""
        try:
            barrier.wait(timeout=10); responses.append(execute(TestClient(main.app), uid, concurrent))
        except Exception as error: errors.append(error)
    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=60)
    check("concurrent one attempt / row", not errors and not any(t.is_alive() for t in threads) and len(responses) == 2
          and all(r.status_code in {200, 409} for r in responses) and rows(concurrent)[0].attempt_count == 1 and len(rows(concurrent)[1]) == 1)
    try:
        for hook in ("before_insert", "before_commit"):
            faulty = save(uid, cid, mid)
            register_executor("suggest_recommendation", lambda context, hook=hook: suggest_recommendation_executor(context, **{hook: fail}))
            execute(client, uid, faulty); action, records = rows(faulty)
            check(f"{hook} rollback", action.status == "failed" and not records and action.error_message == "executor_failed:RuntimeError")
            register_executor("suggest_recommendation", suggest_recommendation_executor)
            check(f"{hook} retry", execute(client, uid, faulty).status_code == 200 and len(rows(faulty)[1]) == 1)
    finally: register_executor("suggest_recommendation", suggest_recommendation_executor)
    lost = save(uid, cid, mid); _, lease = _acquire_lease(lost, uid)
    context = ExecutorContext(str(lost), str(uid), "suggest_recommendation", lease.attempt_count)
    original = suggest_recommendation_executor(context)
    check("domain commit before finalize", rows(lost)[0].status == "processing" and len(rows(lost)[1]) == 1)
    with SessionLocal() as db:
        row = db.scalar(select(AgentAction).where(AgentAction.action_id == lost)); row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    execute(client, uid, lost); action, records = rows(lost)
    check("lost finalize row reuse", action.status == "completed" and action.attempt_count == 2 and len(records) == 1
          and str(records[0].id) == original.data["recommendation_id"] and not action.result["data"]["recorded"])
    check("late finalize fenced", _finish_success(lease, original)[1] and _finish_failure(lease, RuntimeError("old"))[1] and rows(lost)[0].status == "completed")
    try: suggest_recommendation_executor(context)
    except Exception: check("stale domain attempt blocked", len(rows(lost)[1]) == 1)
    else: raise AssertionError("stale attempt accepted")
    check("new client reuse", not execute(TestClient(main.app), uid, lost).json()["executor_called"])
    for label, changes in (("nan", {"confidence": float("nan")}), ("inf", {"confidence": float("inf")}),
                           ("blank", {"primary_action": " "}), ("tradeoff missing alternative", {"recommendation_kind": "tradeoff"}),
                           ("recover missing time", {"recommendation_kind": "recover_then_reassess"}), ("range", {"confidence": 1.01})):
        new = save(uid, cid, mid)
        with SessionLocal() as db:
            db.add(Recommendation(user_id=uid, agent_action_id=rows(new)[0].id, **{**ARGS, **changes}))
            try: db.commit()
            except IntegrityError: db.rollback(); check(f"DB CHECK {label}", True)
            else: raise AssertionError(label)
    with SessionLocal() as db:
        db.add(Recommendation(user_id=uid, agent_action_id=item.agent_action_id, **ARGS))
        try: db.commit()
        except IntegrityError: db.rollback(); check("DB UNIQUE action", True)
        else: raise AssertionError("duplicate row accepted")
    for role in ("assistant", "system"):
        new = save(uid, cid, message(uid, cid, role=role)); execute(client, uid, new)
        check(f"{role} evidence blocked", rows(new)[0].status == "failed" and not rows(new)[1])
    low = save(uid, cid, mid)
    with SessionLocal() as db:
        row = db.scalar(select(AgentAction).where(AgentAction.action_id == low)); row.arguments = {**row.arguments, "confidence": .49}; db.commit()
    execute(client, uid, low)
    check("manual ready low confidence blocked", rows(low)[0].status == "failed" and not rows(low)[1])
    # 짧은 read가 실제로 종료되는지 및 오래된/다른 사용자의 상태가 제외되는지 검사합니다.
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        old_action = rows(aid)[0]
        db.add(BodyStateEvent(user_id=uid, conversation_id=cid, message_id=mid, agent_action_id=old_action.id,
                             fatigue=.9, confidence=.9, created_at=now - timedelta(hours=3)))
        db.add(CognitiveStateEvent(user_id=oid, agent_action_id=old_action.id, focus=.9, confidence=.9))
        db.commit()
    snapshot = load_recommendation_context(uid, now, "지금 개발할까 쉴까?")
    check("old and other-user states excluded", not snapshot.recent_states)
    with SessionLocal() as db:
        row = db.scalar(select(BodyStateEvent).where(BodyStateEvent.user_id == uid)); row.created_at = now - timedelta(minutes=5); db.commit()
    snapshot = load_recommendation_context(uid, now, "지금 개발할까 쉴까?")
    check("recent nullable states included", snapshot.recent_states["body"]["fatigue"] == .9 and snapshot.recent_states["body"]["energy"] is None)
    # 실제 PostgreSQL에서 관련성 필터가 limit보다 먼저 적용되는지 확인합니다.
    for statement in ("개발 프로젝트 완성", "바이올린 연주"):
        fixture_action = rows(save(uid, cid, mid))[0]
        with SessionLocal() as db:
            db.add(DreamGoal(user_id=uid, conversation_id=cid, agent_action_id=fixture_action.id, statement=statement, kind="goal")); db.commit()
    for place_name in ("조용한 카페", "전통시장", "맛집", "집"):
        fixture_action = rows(save(uid, cid, mid))[0]
        with SessionLocal() as db:
            db.add(PlaceEvent(user_id=uid, conversation_id=cid, agent_action_id=fixture_action.id, place_name=place_name, kind="preference", preference="like")); db.commit()
    snapshot = load_recommendation_context(uid, datetime.now(timezone.utc), "개발할까 쉴까?")
    check("unrelated goals/places excluded", [item["statement"] for item in snapshot.dream_goals] == ["개발 프로젝트 완성"] and not snapshot.places)
    snapshot = load_recommendation_context(uid, datetime.now(timezone.utc), "카페 갈까?")
    check("location choice excludes activity states/goals", not snapshot.recent_states and not snapshot.dream_goals and [item["place_name"] for item in snapshot.places] == ["조용한 카페"])
    check("internal IDs not sent", all("id" not in item and "message_id" not in item for item in snapshot.places))
    snapshot = load_recommendation_context(uid, datetime.now(timezone.utc), "집에 갈까?")
    check("SQL home boundary excludes restaurant", [item["place_name"] for item in snapshot.places] == ["집"] and not snapshot.recent_states)
    for summary in ("개발 입력창 완성", "바이올린 연습"):
        fixture_action = rows(save(uid, cid, mid))[0]
        with SessionLocal() as db:
            db.add(DailyLifeEvent(user_id=uid, conversation_id=cid, agent_action_id=fixture_action.id, summary=summary)); db.commit()
    for hours in (1, 10):
        fixture_action = rows(save(uid, cid, mid))[0]
        with SessionLocal() as db:
            db.add(Schedule(user_id=uid, conversation_id=cid, agent_action_id=fixture_action.id, title=f"테스트 {hours}시간 후", start_at=datetime.now(timezone.utc) + timedelta(hours=hours))); db.commit()
    snapshot = load_recommendation_context(uid, datetime.now(timezone.utc), "지금 개발할까 쉴까?")
    check("question relevant daily only", [item["summary"] for item in snapshot.daily_life] == ["개발 입력창 완성"])
    check("current choice excludes distant schedule", [item["title"] for item in snapshot.schedules] == ["테스트 1시간 후"])
    snapshot = load_recommendation_context(uid, datetime.now(timezone.utc), "오늘 개발 뭐부터 할까?")
    check("day planning retains 24h upper bound", len(snapshot.schedules) == 2)
    snapshot = load_recommendation_context(uid, datetime.now(timezone.utc), "어떤 옷을 추천해줘?")
    check("unsupported question does not dump personal context", not any((snapshot.recent_states, snapshot.schedules, snapshot.dream_goals, snapshot.daily_life, snapshot.places)))
    # DB 직접 입력이 서비스 길이 제한을 넘더라도 전송 스냅샷만 제한하고 저장 원문은 보존합니다.
    oversized = []
    for model, field, limit, extra in ((DreamGoal, "statement", 300, {"kind": "goal"}), (DailyLifeEvent, "summary", 200, {})):
        fixture_action = rows(save(uid, cid, mid))[0]
        original_text = "개발 " + "테스트 " * 120
        with SessionLocal() as db:
            row = model(user_id=uid, conversation_id=cid, agent_action_id=fixture_action.id, **{field: original_text}, **extra)
            db.add(row); db.commit(); oversized.append((model, row.id, field, original_text))
    snapshot = load_recommendation_context(uid, datetime.now(timezone.utc), "지금 개발할까 쉴까?")
    with SessionLocal() as db:
        check("bounded text snapshot preserves original records", all(len(item["statement"]) <= 300 for item in snapshot.dream_goals)
              and all(len(item["summary"]) <= 200 for item in snapshot.daily_life)
              and all(getattr(db.get(model, row_id), field) == original_text for model, row_id, field, original_text in oversized))
    fresh = save(uid, cid, mid)
    with SessionLocal() as db:
        db.get(Conversation, cid).deleted_at = now; db.commit()
    execute(client, uid, fresh)
    check("deleted conversation execution blocked", rows(fresh)[0].status == "failed" and not rows(fresh)[1])
    check("deleted conversation excluded from context", not load_recommendation_context(uid, now).recent_states)
    check("original rows unchanged", originals_unchanged(before))
    check("db-health actual SELECT 1", client.get("/db-health").status_code == 200)


def run_chat(live=False):
    """실제 DB/HTTP 채팅을 검사하고 live 모드에서는 답변과 routing도 실제 OpenAI를 사용합니다."""
    uid, oid, cid = fixture(); client = TestClient(main.app)
    def routing(*args, **kwargs):
        """결정론적 안전성 검증에는 추천과 Body를 함께 반환합니다."""
        return OrchestratorResult(needs_action=True, actions=[
            OrchestratorAction.model_validate(candidate().model_dump(exclude={"action_id"})),
        ] if kwargs.get("recommendation_context") is not None else [
            OrchestratorAction.model_validate(candidate().model_dump(exclude={"action_id"})),
            OrchestratorAction(type="body_state", intent="record_body_state", mode="record", reason="현재 피로", confidence=.9,
                               requires_confirmation=False, execution_order=2, arguments={"fatigue": .9, "confidence": .9}),
        ])
    def checked_routing(*args, **kwargs):
        """OpenAI 호출 직전에 이 프로세스의 DB 세션/transaction이 반환됐는지 검사합니다."""
        check("no DB connection held during reasoning", engine.pool.checkedout() == 0)
        return (orchestrate_with_openai if live else routing)(*args, **kwargs)
    with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(uid), "NOIE_DEV_CONVERSATION_ID": str(cid)}), \
         patch.object(main, "run_memory_extraction_background", lambda *args: None):
        with patch.object(integration, "orchestrate_with_openai", wraps=checked_routing) as route:
            request_id = uuid4(); content = "오늘 개발 4시간 했고 몸은 피곤한데 작은 작업을 조금 더 만들고 싶어. 지금 뭘 할까?"
            response = client.post("/chat", json={"text": content, "request_id": str(request_id)})
            check("chat 200", response.status_code == 200)
            with SessionLocal() as db:
                recs = list(db.scalars(select(Recommendation).where(Recommendation.user_id == uid)).all())
                assistant = db.scalar(select(Message).where(Message.conversation_id == cid, Message.role == "assistant"))
                user = db.scalar(select(Message).where(Message.conversation_id == cid, Message.role == "user"))
                body_count = len(db.scalars(select(BodyStateEvent).where(BodyStateEvent.user_id == uid)).all())
            check("chat one recommendation delivered", len(recs) == 1 and recs[0].primary_action in response.json()["reply"])
            check("raw final reply preserved", assistant.content == response.json()["reply"] and user.content == content)
            check("context-free routing reused for Body", body_count == 1 and route.call_count == 2)
            repeated = client.post("/chat", json={"text": content, "request_id": str(request_id)})
            check("request_id cached exact response", repeated.json() == response.json() and route.call_count == 2)
            with SessionLocal() as db:
                check("request_id one row", len(db.scalars(select(Recommendation).where(Recommendation.user_id == uid)).all()) == 1)
            # 같은 말을 새 UUID로 실제 다시 말하면 새 추천/원문을 정상적으로 생성합니다.
            second = client.post("/chat", json={"text": content, "request_id": str(uuid4())})
            with SessionLocal() as db:
                check("same text new UUID creates new suggestion", second.status_code == 200
                      and len(db.scalars(select(Recommendation).where(Recommendation.user_id == uid)).all()) == 2)
            with patch.object(main, "generate_chat_reply_with_openai", return_value="원래 답변"), \
                 patch.object(integration, "orchestrate_with_openai", side_effect=routing):
                register_executor("suggest_recommendation", lambda context: suggest_recommendation_executor(context, before_commit=fail))
                try:
                    failed = client.post("/chat", json={"text": content, "request_id": str(uuid4())})
                    with SessionLocal() as db:
                        check("recommendation fault preserves reply/Body", failed.status_code == 200 and failed.json()["reply"] == "원래 답변"
                              and len(db.scalars(select(BodyStateEvent).where(BodyStateEvent.user_id == uid)).all()) == 3
                              and len(db.scalars(select(Recommendation).where(Recommendation.user_id == uid)).all()) == 2)
                finally: register_executor("suggest_recommendation", suggest_recommendation_executor)
        # 일반 발화에서도 Record 후보는 보존되지만 추천 context와 이력은 만들지 않습니다.
        with patch.object(integration, "orchestrate_with_openai", side_effect=routing) as route, \
             patch.object(integration, "load_recommendation_context") as loader, \
             patch.object(main, "generate_chat_reply_with_openai", return_value="일반 답변"):
            for utterance in ("오늘 기분 좋아.", "광안리 다녀왔어.", "내일 3시에 수업 있어.", "오늘은 운동하고 자고 개발은 내일 할래.", "개발할까 했는데 오늘은 쉴래.", "뭐부터 할까 했는데 추천해주지 마."):
                response = client.post("/chat", json={"text": utterance, "request_id": str(uuid4())})
                check("ordinary chat keeps reply without recommendation", response.status_code == 200 and response.json()["reply"] == "일반 답변")
            check("ordinary chat never loads/transmits context", loader.call_count == 0 and all(call.kwargs.get("recommendation_context") is None for call in route.call_args_list))
            with SessionLocal() as db:
                check("ordinary chat creates no recommendation rows", len(db.scalars(select(Recommendation).where(Recommendation.user_id == uid)).all()) == 2)
        def failed_recommendation(*args, **kwargs):
            """추천 생성만 실패시켜 원래 Record와 reply가 유지되는지 검증합니다."""
            if kwargs.get("recommendation_context") is not None:
                raise RuntimeError("synthetic recommendation generation failure")
            return routing(*args, **kwargs)
        with patch.object(integration, "orchestrate_with_openai", side_effect=failed_recommendation), \
             patch.object(main, "generate_chat_reply_with_openai", return_value="원래 답변"):
            with SessionLocal() as db:
                before_body = len(db.scalars(select(BodyStateEvent).where(BodyStateEvent.user_id == uid)).all())
            response = client.post("/chat", json={"text": "몸은 피곤한데 지금 개발할까 쉴까?", "request_id": str(uuid4())})
            with SessionLocal() as db:
                check("OpenAI recommendation failure preserves Record/reply", response.status_code == 200 and response.json()["reply"] == "원래 답변"
                      and len(db.scalars(select(BodyStateEvent).where(BodyStateEvent.user_id == uid)).all()) == before_body + 1
                      and len(db.scalars(select(Recommendation).where(Recommendation.user_id == uid)).all()) == 2)
        # 같은 request_id를 실제 /chat에 동시에 제출합니다. 기존 요청 중복 방지까지 함께 확인합니다.
        concurrent_id = uuid4(); barrier = threading.Barrier(2); responses = []; errors = []
        def chat_worker():
            """네트워크 재전송을 모사하되 기존 데이터에는 손대지 않습니다."""
            try:
                barrier.wait(timeout=10)
                responses.append(TestClient(main.app).post("/chat", json={"text": "지금 개발할까 쉴까?", "request_id": str(concurrent_id)}))
            except Exception as error: errors.append(error)
        with patch.object(integration, "orchestrate_with_openai", side_effect=routing), \
             patch.object(main, "generate_chat_reply_with_openai", return_value="원래 답변"):
            threads = [threading.Thread(target=chat_worker) for _ in range(2)]
            for thread in threads: thread.start()
            for thread in threads: thread.join(timeout=90)
        with SessionLocal() as db:
            request_messages = list(db.scalars(select(Message).where(Message.conversation_id == cid, Message.metadata_["request_id"].astext == str(concurrent_id))).all())
            check("concurrent /chat request_id one user/assistant/recommendation", not errors and not any(thread.is_alive() for thread in threads)
                  and len(responses) == 2 and all(response.status_code in {200, 409} for response in responses)
                  and sorted(row.role for row in request_messages) == ["assistant", "user"]
                  and len(db.scalars(select(Recommendation).where(Recommendation.user_id == uid)).all()) == 3)


def run_routing():
    """요구된 의미 경계를 실제 OpenAI로 평가합니다. 전체 출력은 테스트 발화에 한정합니다."""
    history = [OrchestratorMemoryContext(content="집에서 개발하면 30분 이후 집중이 안정됐고 오래 유지된 경험이 여러 번 있었다.", relevance=.9),
               OrchestratorMemoryContext(content="카페에서는 초반 집중이 높지만 40분 이후 떨어진 경험이 있었다.", relevance=.9)]
    cases = [
        ("fatigue and motivation", "오늘 개발 4시간 했고 몸은 피곤한데 Recommendation 기능을 조금 더 만들고 싶어.", [], True),
        ("choice overload", "오늘 할 일은 다 아는데 뭐부터 해야 할지 모르겠어. 머리가 복잡해.", [], True),
        ("sleep recovery", "어제 거의 못 자서 너무 졸리고 피곤한데 오늘 개발 안 하면 불안해.", [], True),
        ("enjoyment and goal", "FM26이 너무 재밌는데 오늘 개발을 하나도 안 했어.", [], True),
        ("schedule constraint", "2시간 뒤 친구 약속인데 NOIE 개발이 너무 잘돼.", [], True),
        ("personal tradeoff", "카페 갈까 집에서 할까?", history, True),
        ("important values", "오늘 NOIE 개발하려고 했는데 친구가 만나자고 했어. 둘 다 하고 싶어.", [], True),
        ("current intent first", "그래도 오늘은 카페 가고 싶어.", history, False),
        ("decision made", "오늘은 운동하고 일찍 잘 거야. 개발은 내일 할래.", [], False),
        ("stable no request", "오늘 기분 좋아.", [], False),
        ("absent personal history", "관련 개인 기록은 아직 없어. 지금 개발할까 잠깐 쉴까?", [], True),
        ("place report", "광안리 다녀왔어.", [], False),
        ("schedule report", "내일 3시에 수업 있어.", [], False),
        ("fact question", "파이썬 리스트가 뭐야?", [], False),
        ("goal gap respects choice", "이틀 개발 안 했지만 오늘은 쉬고 내일 개발할래.", history, False),
    ]
    failures = []
    for label, text, memories, expected in cases:
        try:
            # 첫 호출은 기존 routing, 두 번째는 필요할 때만 추천 전용입니다.
            result = orchestrate_with_openai(text, memories)
            if recommendation_needed(text) and any(item.intent == "suggest_recommendation" for item in result.actions):
                result = orchestrate_with_openai(text, related_memories(memories, text), recommendation_context=RecommendationContext(as_of=datetime.now(timezone.utc)))
            else:
                result = OrchestratorResult(needs_action=False, actions=[])
            recs = [item for item in result.actions if item.intent == "suggest_recommendation"]
            valid = bool(recs) == expected and len(recs) <= 1
            if recs:
                args = recs[0].arguments
                print(f"[OUTPUT] {label}: {args.model_dump_json()}", flush=True)
                # 과잉 단계/명령 등은 별도로 읽어 평가합니다. 키워드만으로 의미 성공을 판정하지 않습니다.
                valid = valid and recs[0].mode == "suggest" and not recs[0].requires_confirmation
                if label == "personal tradeoff": valid = valid and args.recommendation_kind == "tradeoff" and args.alternative_action is not None
                if label == "sleep recovery": valid = valid and args.recommendation_kind == "recover_then_reassess" and args.reassess_after_minutes is not None
                if label == "absent personal history": valid = valid and not memories
            if valid: check(f"live routing {label}", True)
            else: failures.append(label); print(f"[FAIL] {label}: {result.model_dump_json()}", flush=True)
        except Exception as error:
            failures.append(label); print(f"[FAIL] {label}: {type(error).__name__}", flush=True)
    if failures:
        raise AssertionError(f"routing mismatches: {failures}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--routing-only", action="store_true")
    parser.add_argument("--live-chat-only", action="store_true")
    parser.add_argument("--validation-only", action="store_true")
    args = parser.parse_args()
    if args.routing_only: run_routing()
    elif args.live_chat_only: run_chat(live=True)
    elif args.validation_only: run_validation()
    else: run_validation(); run_database(); run_chat()
    print(f"Recommendation tests passed: {PASSED}", flush=True)
