"""정확한 쌍의 사용자 승인과 기존 attempt fencing을 통과한 연결만 저장합니다."""

from sqlalchemy import select

from account_write_guard import require_active_account_for_write
from agent.action_ownership import owned_action_context
from agent.activity_link_schemas import bound_activity_link_arguments
from agent.activity_lifecycle_service import ActivityLinkError, link_activity_completion
from agent.activity_service import activity_recorder_enabled
from agent.executor_registry import ExecutorResult
from database import SessionLocal
from models.agent_action import AgentAction
from uuid import UUID


def link_activity_completion_executor(context, *, before_commit=None):
    """완료 연결만 commit합니다. Daily 기록·Message·수행 상태는 변경하지 않습니다."""
    if SessionLocal is None or not activity_recorder_enabled():
        raise ActivityLinkError
    with SessionLocal() as db:
        try:
            require_active_account_for_write(db, UUID(context.user_id))
            action = db.scalar(select(AgentAction).where(AgentAction.action_id == UUID(context.action_id),
                AgentAction.user_id == UUID(context.user_id), owned_action_context()).with_for_update()
                .execution_options(populate_existing=True))
            if (action is None or context.tool_name != "link_activity_completion" or action.status != "processing"
                    or action.attempt_count != context.attempt_count or action.confirmation_status != "confirmed"
                    or action.confirmation_id is None or action.confirmed_at is None):
                raise ActivityLinkError
            pair = bound_activity_link_arguments(action)
            reused = link_activity_completion(db, action, pair)
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="activity_completion_linked", data={"linked": True, "reused": reused})
        except Exception as error:
            db.rollback()
            raise ActivityLinkError from error
