"""저장 완료된 채팅 원문을 기존 Agent 파이프라인에 안전하게 연결합니다."""

from __future__ import annotations

from uuid import UUID, uuid5

from sqlalchemy import select

from agent.action_schemas import PersistActionPlanRequest
from agent.action_service import persist_action_plan
from agent.executor_service import execute_action
from agent.orchestrator import orchestrate_with_openai
from agent.schemas import OrchestratorMemoryContext, OrchestratorResult
from agent.recommendation_context import load_recommendation_context, recommendation_needed, related_memories
from agent.recommendation_schemas import RecommendationContext
from agent.recommendation_service import get_recommendation
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from agent.schedule_schemas import CreateScheduleArguments
from database import SessionLocal
from account_write_guard import require_active_account_for_write
from memory_retriever import retrieve_relevant_memories_safe
from models.conversation import Conversation
from models.message import Message
from models.user import User
from models.agent_action import AgentAction


AUTO_EXECUTE_TOOLS = {
    # Relationship 실패도 다른 domain 및 기본 reply를 rollback하지 않습니다.
    "record_relationship_event",
    # 명시적 장소 기록만 자동 실행하며 기존 place 관심 planning은 제외합니다.
    "record_place_event",
    # 신체 상태 실패도 다른 Record transaction이나 채팅 응답을 취소하지 않습니다.
    "record_body_state",
    # 인지 실패도 채팅 응답과 다른 도메인 저장을 취소하지 않습니다.
    "record_cognitive_state",
    "record_emotion",
    "record_daily_trace",
    "record_dream_goal",
}


def _load_user_message(message_id: UUID) -> tuple[Message, UUID, UUID]:
    """Agent evidence로 사용할 활성 사용자의 정확한 user Message를 다시 확인합니다."""

    if SessionLocal is None:
        raise RuntimeError("database_not_configured")
    with SessionLocal() as db:
        row = db.execute(
            select(Message, Conversation)
            .join(Conversation, Message.conversation_id == Conversation.id)
            .join(User, Conversation.user_id == User.id)
            .where(
                Message.id == message_id,
                Message.role == "user",
                Conversation.deleted_at.is_(None),
                User.deleted_at.is_(None),
            )
        ).one_or_none()
        if row is None:
            raise LookupError("active_user_message_not_found")
        message, conversation = row
        return message, conversation.user_id, conversation.id


def _deterministic_action_id(
    request_id: UUID | None,
    message_id: UUID,
    action: GatewayAction,
) -> UUID:
    """같은 채팅 Message의 같은 routing action에 항상 같은 UUID를 부여합니다."""

    namespace = request_id or message_id
    # 같은 요청의 여러 관계는 records 묶음 하나이며 routing 순서가 바뀌어도 재사용합니다.
    if action.intent == "record_relationship_event":
        return uuid5(namespace, "chat-relationship-v1")
    # Record 순서 변화와 관계없이 한 채팅 요청은 한 추천 Action만 가집니다.
    if action.intent == "suggest_recommendation":
        return uuid5(namespace, "chat-recommendation-v1")
    name = f"chat-agent-v1:{action.execution_order}:{action.type}:{action.intent}"
    return uuid5(namespace, name)


def prepare_chat_recommendation(
    message_id: UUID,
    request_id: UUID | None = None,
    relevant_memories=None,
) -> tuple[OrchestratorResult | None, str | None]:
    """기존 Record routing을 유지하고 필요할 때만 추천 전용 판단과 저장을 추가합니다."""
    routing = None
    try:
        message, user_id, conversation_id = _load_user_message(message_id)
        selected = relevant_memories if relevant_memories is not None else retrieve_relevant_memories_safe(user_id, message.content)
        memories = [OrchestratorMemoryContext(content=item.content, relevance=item.relevance) for item in selected]
        # 추가 개인 상태 없이 판단한 Record 결과를 유지하며 추천 필요성부터 확인합니다.
        routing = orchestrate_with_openai(message.content, memories, reference_time=message.created_at)
        candidates = [item for item in routing.actions if item.intent == "suggest_recommendation"]
        if not candidates or not recommendation_needed(message.content):
            return routing, None
        initial_plan = create_tool_plan(ToolPlanRequest(actions=[GatewayAction.model_validate(candidates[0].model_dump())])).plans[0]
        if initial_plan.status != "ready" or not initial_plan.implemented:
            return routing, None
        context = RecommendationContext(as_of=message.created_at)
        try:
            context = load_recommendation_context(user_id, message.created_at, message.content)
        except Exception as error:
            # 보조 context 실패는 기존 routing이나 답변 실패로 이어지지 않습니다.
            print(f"[noie] recommendation context unavailable: {type(error).__name__}")
        # 개인 context를 사용하는 두 번째 호출은 추천 전용이며 첫 Record 결과를 덮어쓰지 않습니다.
        memories = related_memories(memories, message.content)
        recommendation = orchestrate_with_openai(message.content, memories, reference_time=message.created_at, recommendation_context=context)
        candidates = [item for item in recommendation.actions if item.intent == "suggest_recommendation"]
        if not candidates:
            return routing, None
        action = GatewayAction.model_validate(candidates[0].model_dump())
        action.action_id = _deterministic_action_id(request_id, message_id, action)
        plan = create_tool_plan(ToolPlanRequest(actions=[action])).plans[0]
        if plan.status != "ready" or not plan.implemented:
            return routing, None
        with SessionLocal() as db:
            saved = persist_action_plan(db, PersistActionPlanRequest(
                user_id=user_id, conversation_id=conversation_id, message_id=message_id, plans=[plan],
            ))[0]
            # 생성에 실제 사용한 스냅샷을 한 번만 기록합니다. 재시도는 최초 인자/근거를 보존합니다.
            # persist_action_plan은 이미 commit했으므로 context 저장 transaction에서 다시 보호합니다.
            require_active_account_for_write(db, user_id)
            locked = db.scalar(select(AgentAction).where(AgentAction.id == saved.id).with_for_update())
            if "recommendation_context" not in locked.metadata_:
                locked.metadata_ = {**locked.metadata_, "recommendation_context": context.model_dump(mode="json") if context else {},
                                    "recommendation_memories": [item.model_dump(mode="json") for item in memories]}
                db.commit()
        outcome = execute_action(action.action_id, user_id)
        if outcome.action.status != "completed" or outcome.fenced or not outcome.action.result:
            return routing, None
        event_id = UUID(outcome.action.result["data"]["recommendation_id"])
        with SessionLocal() as db:
            item = get_recommendation(db, event_id, user_id)
            # 사용자에게 보이는 문자열은 저장된 추천과 동일합니다. 주 추천+대안+근거만 표시합니다.
            parts = [item.primary_action]
            if item.alternative_action is not None:
                parts.append(item.alternative_action)
            parts.append(item.rationale)
            return routing, "\n".join(parts)
    except Exception as error:
        print(f"[noie] chat recommendation failed: {type(error).__name__}")
        # routing까지 성공했다면 다른 도메인 후보를 background에서 계속 기록합니다.
        return routing, None


def run_chat_agent_integration(
    message_id: UUID,
    request_id: UUID | None = None,
    prepared_routing: OrchestratorResult | None = None,
) -> None:
    """Agent 실패를 chat 응답과 격리하고 허용된 record Tool만 자동 실행합니다."""

    try:
        message, user_id, conversation_id = _load_user_message(message_id)
        routing = prepared_routing
        if routing is None:
            selected_memories = retrieve_relevant_memories_safe(user_id, message.content)
            memory_context = [OrchestratorMemoryContext(content=memory.content, relevance=memory.relevance) for memory in selected_memories]
            # 이미 응답 전 판단한 경우에는 추가 OpenAI 호출 없이 같은 후보를 재사용합니다.
            routing = orchestrate_with_openai(message.content, memory_context, reference_time=message.created_at)
        allowed_actions: list[GatewayAction] = []
        for action in routing.actions:
            gateway_action = GatewayAction.model_validate(action.model_dump())
            gateway_action.action_id = _deterministic_action_id(
                request_id,
                message_id,
                gateway_action,
            )
            allowed_actions.append(gateway_action)

        if not allowed_actions:
            return

        gateway_result = create_tool_plan(ToolPlanRequest(actions=allowed_actions))
        executable_plans = [
            plan
            for plan in gateway_result.plans
            if plan.tool_name in AUTO_EXECUTE_TOOLS
            and plan.mode == "record"
            and plan.status == "ready"
            and plan.implemented
            and not plan.requires_confirmation
        ]
        # Schedule은 확인 대기 계획만 저장하고 자동 실행 목록에는 넣지 않습니다.
        pending_schedules = [
            plan for plan in gateway_result.plans
            if plan.tool_name == "create_schedule" and plan.mode == "execute"
            and plan.status == "pending_confirmation" and plan.requires_confirmation
            and isinstance(plan.arguments, CreateScheduleArguments)
        ]
        if not executable_plans and not pending_schedules:
            return

        if SessionLocal is None:
            raise RuntimeError("database_not_configured")
        with SessionLocal() as db:
            saved_actions = persist_action_plan(
                db,
                PersistActionPlanRequest(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    message_id=message_id,
                    plans=sorted(executable_plans + pending_schedules, key=lambda plan: plan.execution_order),
                ),
            )

        # 각 Tool은 독립 transaction이므로 하나의 실패가 다른 성공을 되돌리지 않습니다.
        for action in saved_actions:
            if action.tool_name not in AUTO_EXECUTE_TOOLS or action.mode != "record" or action.requires_confirmation:
                continue
            try:
                execute_action(action.action_id, user_id)
            except Exception as error:
                print(
                    "[noie] chat agent executor failed: "
                    f"tool={action.tool_name} error={type(error).__name__}"
                )
    except Exception as error:
        # 내부 메시지, API key, DB URL은 로그에 포함하지 않고 오류 종류만 남깁니다.
        print(
            "[noie] chat agent integration failed: "
            f"message_id={message_id} error={type(error).__name__}"
        )
