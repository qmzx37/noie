"""검증된 Agent Action을 한 개의 Emotion Event로 기록합니다."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from agent.emotion_schemas import EmotionRecordArguments
from agent.executor_registry import ExecutorContext, ExecutorResult
from database import SessionLocal
from account_write_guard import require_active_account_for_write
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.emotion_event import EmotionEvent
from models.message import Message
from models.user import User


class RecordEmotionValidationError(Exception):
    """Action과 원본 evidence의 소유권 또는 입력이 올바르지 않습니다."""


class RecordEmotionDatabaseError(Exception):
    """내부 DB 정보를 노출하지 않고 공통 executor에 실패를 전달합니다."""


EMOTION_EXTRACTOR_VERSION = "emotion-v1"
EMOTION_PIPELINE = "orchestrator-record-emotion"


def _dominant_emotion(arguments: EmotionRecordArguments) -> str | None:
    values = {key: getattr(arguments, key) for key in "FADJCGTR"}
    key, value = max(values.items(), key=lambda item: item[1])
    return key if value > 0 else None


def record_emotion_executor(
    context: ExecutorContext,
    *,
    before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    """짧은 transaction에서 소유권을 확인하고 idempotent event를 저장합니다."""

    if SessionLocal is None:
        raise RecordEmotionDatabaseError
    try:
        with SessionLocal() as db:
            # 삭제와 같은 User 행을 먼저 보호한 뒤 Action/domain을 잠그고 저장합니다.
            require_active_account_for_write(db, UUID(context.user_id))
            action = db.scalar(
                select(AgentAction)
                .where(
                    AgentAction.action_id == UUID(context.action_id),
                    AgentAction.user_id == UUID(context.user_id),
                )
                .with_for_update()
            )
            if (
                action is None
                or action.tool_name != "record_emotion"
                or action.status != "processing"
                or action.attempt_count != context.attempt_count
            ):
                raise RecordEmotionValidationError

            active_user = db.scalar(
                select(User.id).where(User.id == action.user_id, User.deleted_at.is_(None))
            )
            if active_user is None:
                raise RecordEmotionValidationError

            if action.conversation_id is not None:
                conversation = db.scalar(
                    select(Conversation).where(
                        Conversation.id == action.conversation_id,
                        Conversation.user_id == action.user_id,
                        Conversation.deleted_at.is_(None),
                    )
                )
                if conversation is None:
                    raise RecordEmotionValidationError

            if action.message_id is not None:
                message = db.scalar(
                    select(Message)
                    .join(Conversation, Message.conversation_id == Conversation.id)
                    .where(
                        Message.id == action.message_id,
                        Message.user_id == action.user_id,
                        Message.role == "user",
                        Conversation.user_id == action.user_id,
                        Conversation.deleted_at.is_(None),
                    )
                )
                if message is None or (
                    action.conversation_id is not None
                    and message.conversation_id != action.conversation_id
                ):
                    raise RecordEmotionValidationError

            arguments = EmotionRecordArguments.model_validate(action.arguments)
            values = arguments.model_dump()
            if before_insert is not None:
                before_insert()
            inserted_id = db.scalar(
                pg_insert(EmotionEvent)
                .values(
                    user_id=action.user_id,
                    conversation_id=action.conversation_id,
                    message_id=action.message_id,
                    agent_action_id=action.id,
                    f=values["F"], a=values["A"], d=values["D"], j=values["J"],
                    c=values["C"], g=values["G"], t=values["T"], r=values["R"],
                    dominant_emotion=_dominant_emotion(arguments),
                    confidence=arguments.confidence,
                    source="orchestrator",
                    metadata={
                        "record_kind": "emotion_event",
                        "extractor_version": EMOTION_EXTRACTOR_VERSION,
                        "pipeline": EMOTION_PIPELINE,
                    },
                )
                .on_conflict_do_nothing(index_elements=[EmotionEvent.agent_action_id])
                .returning(EmotionEvent.id)
            )
            event = (
                db.get(EmotionEvent, inserted_id)
                if inserted_id is not None
                else db.scalar(select(EmotionEvent).where(EmotionEvent.agent_action_id == action.id))
            )
            if event is None or event.user_id != action.user_id:
                raise RecordEmotionValidationError
            if before_commit is not None:
                before_commit()
            db.commit()
            return ExecutorResult(
                outcome="emotion_recorded",
                data={"emotion_event_id": str(event.id), "recorded": inserted_id is not None},
            )
    except RecordEmotionValidationError:
        raise
    except SQLAlchemyError as error:
        raise RecordEmotionDatabaseError from error
