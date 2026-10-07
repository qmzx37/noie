"""공통 Executor의 현재 lease 안에서 사람 근거 묶음만 짧게 저장합니다."""

from collections.abc import Callable
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from agent.executor_registry import ExecutorContext, ExecutorResult
from agent.relationship_event_service import validate_relationship_evidence
from agent.relationship_schemas import RecordRelationshipArguments
from agent.tool_policy import CONFIDENCE_THRESHOLDS
from database import SessionLocal
from account_write_guard import require_active_account_for_write
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.relationship_event import RelationshipEvent
from models.user import User


class RecordRelationshipError(Exception):
    """내부 오류/원문을 응답에 노출하지 않습니다."""


def record_relationship_event_executor(
    context: ExecutorContext, *, before_insert: Callable[[], None] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> ExecutorResult:
    """action row lock으로 묶음 저장/reuse를 직렬화하고 오래된 attempt를 거부합니다."""
    if SessionLocal is None:
        raise RecordRelationshipError
    try:
        with SessionLocal() as db:
            # 삭제와 같은 User 행을 먼저 보호한 뒤 Action/domain을 잠그고 저장합니다.
            require_active_account_for_write(db, UUID(context.user_id))
            try:
                action = db.scalar(select(AgentAction).where(
                    AgentAction.action_id == UUID(context.action_id), AgentAction.user_id == UUID(context.user_id),
                ).with_for_update())
                if (action is None or context.tool_name != "record_relationship_event"
                    or action.tool_name != "record_relationship_event" or action.intent != "record_relationship_event"
                    or action.action_type != "relationship" or action.mode != "record" or action.requires_confirmation
                    or action.status != "processing" or action.attempt_count != context.attempt_count
                    or action.lease_expires_at is None or action.lease_expires_at <= datetime.now(timezone.utc)):
                    raise RecordRelationshipError
                # 근거 Message와 활성 사용자/대화의 정확한 연결을 재확인합니다.
                message = db.scalar(select(Message).join(Conversation).join(User, Conversation.user_id == User.id).where(
                    Message.id == action.message_id, Message.role == "user", Message.user_id == action.user_id,
                    Message.conversation_id == action.conversation_id, Conversation.user_id == action.user_id,
                    Conversation.deleted_at.is_(None), User.deleted_at.is_(None),
                ))
                if message is None:
                    raise RecordRelationshipError
                arguments = RecordRelationshipArguments.model_validate(action.arguments)
                validate_relationship_evidence(arguments, message.content)
                if min(action.confidence, *(record.confidence for record in arguments.records)) < CONFIDENCE_THRESHOLDS["record"]:
                    raise RecordRelationshipError
                existing = list(db.scalars(select(RelationshipEvent).where(
                    RelationshipEvent.agent_action_id == action.id,
                ).order_by(RelationshipEvent.record_index)).all())
                if existing:
                    # 저장 후 finalize 유실은 최초 묶음을 그대로 재사용합니다. 일부 묶음은 정상 성공이 아닙니다.
                    if len(existing) != len(arguments.records) or [item.record_index for item in existing] != list(range(len(existing))):
                        raise RecordRelationshipError
                    return ExecutorResult(outcome="relationship_recorded", data={
                        "relationship_event_ids": [str(item.id) for item in existing], "recorded": False,
                    })
                if before_insert is not None:
                    before_insert()
                items = [RelationshipEvent(
                    user_id=action.user_id, conversation_id=action.conversation_id, message_id=action.message_id,
                    agent_action_id=action.id, record_index=index, **record.model_dump(),
                    metadata_={"extractor_version": "relationship-v1", "evidence_basis": "explicit_user_statement"},
                ) for index, record in enumerate(arguments.records)]
                db.add_all(items)
                db.flush()
                if before_commit is not None:
                    before_commit()
                # hook나 큰 묶음 처리 중 lease가 만료되어도 commit하지 않습니다.
                if action.lease_expires_at <= datetime.now(timezone.utc):
                    raise RecordRelationshipError
                db.commit()
                return ExecutorResult(outcome="relationship_recorded", data={
                    "relationship_event_ids": [str(item.id) for item in items], "recorded": True,
                })
            except Exception:
                db.rollback()
                raise
    except SQLAlchemyError as error:
        raise RecordRelationshipError from error
