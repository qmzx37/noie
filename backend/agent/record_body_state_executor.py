"""검증된 Body State를 기존 공통 Executor 계약으로 중복 없이 저장합니다."""

from collections.abc import Callable
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from agent.body_state_schemas import RecordBodyStateArguments
from agent.executor_registry import ExecutorContext, ExecutorResult
from agent.tool_policy import CONFIDENCE_THRESHOLDS
from database import SessionLocal
from account_write_guard import require_active_account_for_write
from models.agent_action import AgentAction
from models.body_state_event import BodyStateEvent
from models.conversation import Conversation
from models.message import Message
from models.user import User


class RecordBodyStateError(Exception):
    """DB 내부 정보나 원문을 사용자 응답에 노출하지 않기 위한 오류 경계입니다."""


def record_body_state_executor(
    context: ExecutorContext,
    *,
    before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    """현재 attempt와 소유권을 확인하고 짧은 DB transaction만 수행합니다."""
    if SessionLocal is None:
        raise RecordBodyStateError
    try:
        with SessionLocal() as db:
            # 삭제와 같은 User 행을 먼저 보호한 뒤 Action/domain을 잠그고 저장합니다.
            require_active_account_for_write(db, UUID(context.user_id))
            # OpenAI는 이 transaction 밖에서 이미 호출되었습니다.
            action = db.scalar(select(AgentAction).where(
                AgentAction.action_id == UUID(context.action_id),
                AgentAction.user_id == UUID(context.user_id),
            ).with_for_update())
            if (action is None or action.tool_name != "record_body_state"
                or action.intent != "record_body_state" or action.action_type != "body_state"
                or action.mode != "record" or action.requires_confirmation
                or action.status != "processing" or action.attempt_count != context.attempt_count):
                raise RecordBodyStateError
            if db.scalar(select(User.id).where(User.id == action.user_id, User.deleted_at.is_(None))) is None:
                raise RecordBodyStateError
            if action.conversation_id is not None and db.scalar(select(Conversation.id).where(
                Conversation.id == action.conversation_id, Conversation.user_id == action.user_id,
                Conversation.deleted_at.is_(None),
            )) is None:
                raise RecordBodyStateError
            if action.message_id is not None:
                message = db.scalar(select(Message).join(Conversation).where(
                    Message.id == action.message_id, Message.user_id == action.user_id,
                    Message.role == "user", Conversation.user_id == action.user_id,
                    Conversation.deleted_at.is_(None),
                ))
                if message is None or (action.conversation_id is not None and message.conversation_id != action.conversation_id):
                    raise RecordBodyStateError
            arguments = RecordBodyStateArguments.model_validate(action.arguments)
            # 수동으로 만들어진 ready 계획도 공통 Record 기준을 우회할 수 없습니다.
            if min(action.confidence, arguments.confidence) < CONFIDENCE_THRESHOLDS["record"]:
                raise RecordBodyStateError
            if before_insert is not None:
                before_insert()
            # model_dump의 None을 제거하지 않습니다. unknown을 0으로 바꾸지 않습니다.
            inserted_id = db.scalar(pg_insert(BodyStateEvent).values(
                user_id=action.user_id, conversation_id=action.conversation_id, message_id=action.message_id,
                agent_action_id=action.id, **arguments.model_dump(),
                source="orchestrator", metadata={"extractor_version": "body-state-v1"},
            ).on_conflict_do_nothing(index_elements=[BodyStateEvent.agent_action_id]).returning(BodyStateEvent.id))
            item = db.get(BodyStateEvent, inserted_id) if inserted_id else db.scalar(select(BodyStateEvent).where(BodyStateEvent.agent_action_id == action.id))
            if item is None:
                raise RecordBodyStateError
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="body_state_recorded", data={"body_state_event_id": str(item.id), "recorded": inserted_id is not None})
    except SQLAlchemyError as error:
        # 세션 context manager가 미commit 변경을 rollback합니다.
        raise RecordBodyStateError from error
