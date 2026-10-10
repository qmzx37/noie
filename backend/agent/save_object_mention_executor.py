"""A short, confirmed, fenced write with no external calls."""

from uuid import UUID

from sqlalchemy import select

from account_write_guard import require_active_account_for_write
from agent.action_ownership import owned_action_context
from agent.executor_registry import ExecutorResult
from agent.object_mention_schemas import bound_object_mention_arguments
from agent.object_mention_service import ObjectMentionError, object_mentions_enabled, persist_object_mention
from database import SessionLocal
from models.activity import Activity
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message


def save_object_mention_executor(context, *, before_commit=None):
    if SessionLocal is None or not object_mentions_enabled():
        raise ObjectMentionError
    with SessionLocal() as db:
        try:
            user_id = UUID(context.user_id)
            require_active_account_for_write(db, user_id)
            action = db.scalar(select(AgentAction).where(AgentAction.action_id == UUID(context.action_id),
                AgentAction.user_id == user_id, owned_action_context()).with_for_update()
                .execution_options(populate_existing=True))
            if (action is None or context.tool_name != "save_object_mention" or action.status != "processing"
                    or action.attempt_count != context.attempt_count):
                raise ObjectMentionError
            arguments = bound_object_mention_arguments(action)
            # One source per mention; User -> Action -> Activity -> Conversation -> Message.
            for model, record_id in ((Activity, arguments.activity_id),
                                     (Conversation, action.conversation_id), (Message, action.message_id)):
                if db.scalar(select(model.id).where(model.id == record_id, model.user_id == user_id)
                             .with_for_update()) is None:
                    raise ObjectMentionError
            mention_id, reused = persist_object_mention(db, action, attempt_count=context.attempt_count)
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="object_mention_saved", data={"mention_id": str(mention_id), "reused": reused})
        except Exception:
            db.rollback()
            raise ObjectMentionError from None
