"""검증된 Place Action만 짧은 transaction에서 중복 없이 저장합니다."""

from collections.abc import Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from agent.place_schemas import RecordPlaceEventArguments
from agent.executor_registry import ExecutorContext, ExecutorResult
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.place_event import PlaceEvent
from models.user import User


class RecordPlaceEventError(Exception):
    """내부 DB 오류 전문을 외부에 노출하지 않기 위한 경계입니다."""


def record_place_event_executor(
    context: ExecutorContext,
    *,
    before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    """공통 lease의 현재 attempt와 소유권을 확인한 후 해석 결과만 저장합니다."""
    if SessionLocal is None:
        raise RecordPlaceEventError
    try:
        with SessionLocal() as db:
            # 외부 OpenAI 호출은 이미 끝났습니다. 이 lock은 DB 저장 동안만 유지합니다.
            action = db.scalar(select(AgentAction).where(
                AgentAction.action_id == UUID(context.action_id),
                AgentAction.user_id == UUID(context.user_id),
            ).with_for_update())
            if (action is None or action.tool_name != "record_place_event"
                or action.intent != "record_place_event" or action.action_type != "place"
                or action.mode != "record" or action.requires_confirmation
                or action.status != "processing" or action.attempt_count != context.attempt_count):
                raise RecordPlaceEventError
            if db.scalar(select(User.id).where(User.id == action.user_id, User.deleted_at.is_(None))) is None:
                raise RecordPlaceEventError
            if action.conversation_id is not None and db.scalar(select(Conversation.id).where(
                Conversation.id == action.conversation_id, Conversation.user_id == action.user_id,
                Conversation.deleted_at.is_(None),
            )) is None:
                raise RecordPlaceEventError
            if action.message_id is not None:
                message = db.scalar(select(Message).join(Conversation).where(
                    Message.id == action.message_id, Message.user_id == action.user_id,
                    Message.role == "user", Conversation.user_id == action.user_id,
                    Conversation.deleted_at.is_(None),
                ))
                if message is None or (action.conversation_id is not None and message.conversation_id != action.conversation_id):
                    raise RecordPlaceEventError
            arguments = RecordPlaceEventArguments.model_validate(action.arguments)
            # 저장 시에도 이름을 원문과 대조하여 Memory에서 보충한 장소를 거부합니다.
            if action.message_id is not None and arguments.place_name not in message.content:
                raise RecordPlaceEventError
            if before_insert is not None:
                before_insert()
            inserted_id = db.scalar(pg_insert(PlaceEvent).values(
                user_id=action.user_id, conversation_id=action.conversation_id, message_id=action.message_id,
                agent_action_id=action.id, place_name=arguments.place_name, kind=arguments.kind,
                preference=arguments.preference, occurred_at=arguments.occurred_at,
                source="orchestrator", metadata={"extractor_version": "place-v1"},
            ).on_conflict_do_nothing(index_elements=[PlaceEvent.agent_action_id]).returning(PlaceEvent.id))
            item = db.get(PlaceEvent, inserted_id) if inserted_id else db.scalar(select(PlaceEvent).where(PlaceEvent.agent_action_id == action.id))
            if item is None:
                raise RecordPlaceEventError
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(outcome="place_event_recorded", data={"place_event_id": str(item.id), "recorded": inserted_id is not None})
    except SQLAlchemyError as error:
        # 세션 context manager가 미commit transaction을 rollback합니다.
        raise RecordPlaceEventError from error
