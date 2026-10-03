"""저장 완료된 채팅 원문을 기존 Agent 파이프라인에 안전하게 연결합니다."""

from __future__ import annotations

from uuid import UUID, uuid5

from sqlalchemy import select

from agent.action_schemas import PersistActionPlanRequest
from agent.action_service import persist_action_plan
from agent.executor_service import execute_action
from agent.orchestrator import orchestrate_with_openai
from agent.schemas import OrchestratorMemoryContext
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from database import SessionLocal
from memory_retriever import retrieve_relevant_memories_safe
from models.conversation import Conversation
from models.message import Message
from models.user import User


AUTO_EXECUTE_TOOLS = {
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
    name = f"chat-agent-v1:{action.execution_order}:{action.type}:{action.intent}"
    return uuid5(namespace, name)


def run_chat_agent_integration(
    message_id: UUID,
    request_id: UUID | None = None,
) -> None:
    """Agent 실패를 chat 응답과 격리하고 허용된 record Tool만 자동 실행합니다."""

    try:
        message, user_id, conversation_id = _load_user_message(message_id)
        selected_memories = retrieve_relevant_memories_safe(user_id, message.content)
        memory_context = [
            OrchestratorMemoryContext(
                content=memory.content,
                relevance=memory.relevance,
            )
            for memory in selected_memories
        ]
        routing = orchestrate_with_openai(message.content, memory_context)
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
        if not executable_plans:
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
                    plans=executable_plans,
                ),
            )

        # 각 Tool은 독립 transaction이므로 하나의 실패가 다른 성공을 되돌리지 않습니다.
        for action in saved_actions:
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
