"""추천 이력만 저장합니다. 추천된 운동/개발/일정 Tool은 실행하지 않습니다."""

from collections.abc import Callable
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from agent.executor_registry import ExecutorContext, ExecutorResult
from agent.recommendation_schemas import RecommendationArguments
from agent.tool_policy import CONFIDENCE_THRESHOLDS
from database import SessionLocal
from models.agent_action import AgentAction
from models.recommendation import Recommendation
from models.conversation import Conversation
from models.message import Message
from models.user import User


class RecommendationExecutionError(Exception):
    """원문/DB URL/내부 오류를 응답에 노출하지 않는 오류 경계입니다."""


def suggest_recommendation_executor(
    context: ExecutorContext,
    *,
    before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    """유효 attempt를 잠깐 잠그고 기존 row를 재사용하거나 한 row만 commit합니다."""
    if SessionLocal is None:
        raise RecommendationExecutionError
    try:
        with SessionLocal() as db:
            action = db.scalar(select(AgentAction).where(
                AgentAction.action_id == UUID(context.action_id), AgentAction.user_id == UUID(context.user_id),
            ).with_for_update())
            if (action is None or context.tool_name != "suggest_recommendation"
                or action.tool_name != "suggest_recommendation" or action.intent != "suggest_recommendation"
                or action.action_type != "recommendation" or action.mode != "suggest" or action.requires_confirmation
                or action.status != "processing" or action.attempt_count != context.attempt_count
                or action.lease_expires_at is None or action.lease_expires_at <= datetime.now(timezone.utc)):
                raise RecommendationExecutionError
            if db.scalar(select(User.id).where(User.id == action.user_id, User.deleted_at.is_(None))) is None:
                raise RecommendationExecutionError
            if action.conversation_id is not None and db.scalar(select(Conversation.id).where(
                Conversation.id == action.conversation_id, Conversation.user_id == action.user_id,
                Conversation.deleted_at.is_(None),
            )) is None:
                raise RecommendationExecutionError
            if action.message_id is not None:
                message = db.scalar(select(Message).join(Conversation).where(
                    Message.id == action.message_id, Message.user_id == action.user_id, Message.role == "user",
                    Conversation.user_id == action.user_id, Conversation.deleted_at.is_(None),
                ))
                if message is None or (action.conversation_id is not None and message.conversation_id != action.conversation_id):
                    raise RecommendationExecutionError
            arguments = RecommendationArguments.model_validate(action.arguments)
            if min(action.confidence, arguments.confidence) < CONFIDENCE_THRESHOLDS["suggest"]:
                raise RecommendationExecutionError
            if before_insert is not None:
                before_insert()
            # OpenAI reasoning은 이미 완료되었습니다. 이 lock 안에서는 API 호출이 없습니다.
            inserted_id = db.scalar(pg_insert(Recommendation).values(
                user_id=action.user_id, conversation_id=action.conversation_id, message_id=action.message_id,
                agent_action_id=action.id, **arguments.model_dump(),
                metadata={"version": "recommendation-v1", "context": action.metadata_.get("recommendation_context", {}),
                          "relevant_memories": action.metadata_.get("recommendation_memories", []),
                          "delivery": "proposed_not_executed"},
            ).on_conflict_do_nothing(index_elements=[Recommendation.agent_action_id]).returning(Recommendation.id))
            item = db.get(Recommendation, inserted_id) if inserted_id else db.scalar(select(Recommendation).where(Recommendation.agent_action_id == action.id))
            if item is None:
                raise RecommendationExecutionError
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="recommendation_suggested", data={"recommendation_id": str(item.id), "recorded": inserted_id is not None})
    except SQLAlchemyError as error:
        # context manager는 commit하지 않은 쓰기를 rollback합니다.
        raise RecommendationExecutionError from error
