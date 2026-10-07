"""검증된 장기 꿈/목표 선언을 idempotent하게 저장합니다."""

from collections.abc import Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from agent.dream_goal_schemas import DreamGoalArguments
from agent.executor_registry import ExecutorContext, ExecutorResult
from database import SessionLocal
from account_write_guard import require_active_account_for_write
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.dream_goal import DreamGoal
from models.message import Message
from models.user import User


class RecordDreamGoalError(Exception):
    pass


def record_dream_goal_executor(
    context: ExecutorContext,
    *,
    before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    if SessionLocal is None:
        raise RecordDreamGoalError
    try:
        with SessionLocal() as db:
            # 삭제와 같은 User 행을 먼저 보호한 뒤 Action/domain을 잠그고 저장합니다.
            require_active_account_for_write(db, UUID(context.user_id))
            action = db.scalar(select(AgentAction).where(AgentAction.action_id == UUID(context.action_id), AgentAction.user_id == UUID(context.user_id)).with_for_update())
            if action is None or action.tool_name != "record_dream_goal" or action.intent != "record_dream_goal" or action.status != "processing" or action.attempt_count != context.attempt_count:
                raise RecordDreamGoalError
            if db.scalar(select(User.id).where(User.id == action.user_id, User.deleted_at.is_(None))) is None:
                raise RecordDreamGoalError
            if action.conversation_id is not None and db.scalar(select(Conversation.id).where(Conversation.id == action.conversation_id, Conversation.user_id == action.user_id, Conversation.deleted_at.is_(None))) is None:
                raise RecordDreamGoalError
            if action.message_id is not None:
                message = db.scalar(select(Message).join(Conversation).where(Message.id == action.message_id, Message.user_id == action.user_id, Message.role == "user", Conversation.user_id == action.user_id, Conversation.deleted_at.is_(None)))
                if message is None or (action.conversation_id is not None and message.conversation_id != action.conversation_id):
                    raise RecordDreamGoalError
            arguments = DreamGoalArguments.model_validate(action.arguments)
            if before_insert is not None:
                before_insert()
            inserted_id = db.scalar(pg_insert(DreamGoal).values(
                user_id=action.user_id, conversation_id=action.conversation_id, message_id=action.message_id,
                agent_action_id=action.id, statement=arguments.statement, kind=arguments.kind,
                source="orchestrator", metadata={"extractor_version": "dream-goal-v1", "pipeline": "orchestrator-record-dream-goal"},
            ).on_conflict_do_nothing(index_elements=[DreamGoal.agent_action_id]).returning(DreamGoal.id))
            dream_goal = db.get(DreamGoal, inserted_id) if inserted_id else db.scalar(select(DreamGoal).where(DreamGoal.agent_action_id == action.id))
            if dream_goal is None:
                raise RecordDreamGoalError
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="dream_goal_recorded", data={"dream_goal_id": str(dream_goal.id), "recorded": inserted_id is not None})
    except SQLAlchemyError as error:
        raise RecordDreamGoalError from error
