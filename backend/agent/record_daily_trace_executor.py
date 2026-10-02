"""검증된 실제 생활 사건을 idempotent하게 저장합니다."""

from collections.abc import Callable
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from agent.daily_life_schemas import DailyTraceArguments
from agent.executor_registry import ExecutorContext, ExecutorResult
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.daily_life_event import DailyLifeEvent
from models.message import Message
from models.user import User


class RecordDailyTraceError(Exception):
    pass


def record_daily_trace_executor(
    context: ExecutorContext,
    *,
    before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    if SessionLocal is None:
        raise RecordDailyTraceError
    try:
        with SessionLocal() as db:
            action = db.scalar(select(AgentAction).where(AgentAction.action_id == UUID(context.action_id), AgentAction.user_id == UUID(context.user_id)).with_for_update())
            if action is None or action.tool_name != "record_daily_trace" or action.status != "processing" or action.attempt_count != context.attempt_count:
                raise RecordDailyTraceError
            if db.scalar(select(User.id).where(User.id == action.user_id, User.deleted_at.is_(None))) is None:
                raise RecordDailyTraceError
            if action.conversation_id is not None and db.scalar(select(Conversation.id).where(Conversation.id == action.conversation_id, Conversation.user_id == action.user_id, Conversation.deleted_at.is_(None))) is None:
                raise RecordDailyTraceError
            if action.message_id is not None:
                message = db.scalar(select(Message).join(Conversation).where(Message.id == action.message_id, Message.user_id == action.user_id, Message.role == "user", Conversation.user_id == action.user_id, Conversation.deleted_at.is_(None)))
                if message is None or (action.conversation_id is not None and message.conversation_id != action.conversation_id):
                    raise RecordDailyTraceError
            arguments = DailyTraceArguments.model_validate(action.arguments)
            if before_insert is not None:
                before_insert()
            inserted_id = db.scalar(pg_insert(DailyLifeEvent).values(
                user_id=action.user_id, conversation_id=action.conversation_id, message_id=action.message_id,
                agent_action_id=action.id, summary=arguments.summary, category=arguments.category,
                source="orchestrator", metadata={"extractor_version": "daily-life-v1", "record_kind": "daily_life_event"},
            ).on_conflict_do_nothing(index_elements=[DailyLifeEvent.agent_action_id]).returning(DailyLifeEvent.id))
            event = db.get(DailyLifeEvent, inserted_id) if inserted_id else db.scalar(select(DailyLifeEvent).where(DailyLifeEvent.agent_action_id == action.id))
            if event is None:
                raise RecordDailyTraceError
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="daily_trace_recorded", data={"daily_event_id": str(event.id), "recorded": inserted_id is not None})
    except SQLAlchemyError as error:
        raise RecordDailyTraceError from error
