"""기존 Common Executor 계약으로 확인된 일정만 생성합니다."""

from collections.abc import Callable
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from agent.executor_registry import ExecutorContext, ExecutorResult
from agent.schedule_schemas import CreateScheduleArguments
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.schedule import Schedule
from models.user import User


class CreateScheduleError(Exception):
    """공통 실행 계층이 정제된 오류 종류로 저장할 예외입니다."""


def create_schedule_executor(
    context: ExecutorContext,
    *,
    before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    """짧은 transaction에서 소유권, 승인, attempt를 확인하고 일정을 저장합니다."""
    if SessionLocal is None:
        raise CreateScheduleError
    try:
        with SessionLocal() as db:
            action = db.scalar(select(AgentAction).where(
                AgentAction.action_id == UUID(context.action_id),
                AgentAction.user_id == UUID(context.user_id),
            ).with_for_update())
            if (
                action is None or action.tool_name != "create_schedule"
                or action.action_type != "schedule" or action.intent != "create_schedule"
                or action.mode != "execute" or action.status != "processing"
                or action.attempt_count != context.attempt_count
                or not action.requires_confirmation or action.confirmation_status != "confirmed"
            ):
                raise CreateScheduleError
            if db.scalar(select(User.id).where(User.id == action.user_id, User.deleted_at.is_(None))) is None:
                raise CreateScheduleError
            if action.conversation_id is not None and db.scalar(select(Conversation.id).where(
                Conversation.id == action.conversation_id, Conversation.user_id == action.user_id,
                Conversation.deleted_at.is_(None),
            )) is None:
                raise CreateScheduleError
            if action.message_id is not None:
                message = db.scalar(select(Message).join(Conversation).where(
                    Message.id == action.message_id, Message.user_id == action.user_id,
                    Message.role == "user", Conversation.user_id == action.user_id,
                    Conversation.deleted_at.is_(None),
                ))
                if message is None or (action.conversation_id is not None and message.conversation_id != action.conversation_id):
                    raise CreateScheduleError
            arguments = CreateScheduleArguments.model_validate(action.arguments)
            # 도메인 commit 이후 finalize가 유실된 재시도는 기존 일정을 그대로 재사용합니다.
            existing = db.scalar(select(Schedule).where(Schedule.agent_action_id == action.id))
            if existing is not None:
                return ExecutorResult(outcome="schedule_created", data={"schedule_id": str(existing.id), "created": False})
            if arguments.start_at <= datetime.now(timezone.utc):
                raise CreateScheduleError
            if before_insert is not None:
                before_insert()
            inserted_id = db.scalar(pg_insert(Schedule).values(
                user_id=action.user_id, conversation_id=action.conversation_id,
                message_id=action.message_id, agent_action_id=action.id,
                title=arguments.title, start_at=arguments.start_at, end_at=arguments.end_at,
                source="orchestrator", metadata={"pipeline": "orchestrator-create-schedule", "version": "schedule-v1"},
            ).on_conflict_do_nothing(index_elements=[Schedule.agent_action_id]).returning(Schedule.id))
            schedule = db.get(Schedule, inserted_id) if inserted_id else db.scalar(select(Schedule).where(Schedule.agent_action_id == action.id))
            if schedule is None:
                raise CreateScheduleError
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="schedule_created", data={"schedule_id": str(schedule.id), "created": inserted_id is not None})
    except SQLAlchemyError as error:
        raise CreateScheduleError from error
