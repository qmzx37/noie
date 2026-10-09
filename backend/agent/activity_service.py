"""Activity의 Executor 내부 저장과 owner-only 읽기입니다. 새로운 직접 쓰기 API는 없습니다."""

import os
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from account_write_guard import require_active_account_for_write
from auth_context import AuthPrincipal
from agent.activity_recorder import analyze_activity
from agent.activity_schemas import ActivityResponse
from agent.behavior_schemas import BehaviorContext
from message_ownership import message_owner_condition
from models.activity import Activity
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.user import User


def activity_recorder_enabled() -> bool:
    """migration을 적용하기 전의 production 동작은 그대로 유지하며 오타도 OFF입니다."""
    return os.getenv("NOIE_ACTIVITY_RECORDER_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def persist_activity_for_action(db, action, message, *, attempt_count):
    """기존 Daily Executor transaction 안에서만 저장합니다. caller가 commit하며 외부 호출은 없습니다."""
    try:
        require_active_account_for_write(db, action.user_id)
        if (action.tool_name != "record_daily_trace" or action.status != "processing"
                or action.attempt_count != attempt_count or message.id != action.message_id):
            raise ValueError("invalid_activity_action")
        # ORM 캐시나 client UUID 대신 실제 현재 소유권/role/부모 활성 상태를 재검사합니다.
        owned = db.scalar(select(Message).join(Conversation, Message.conversation_id == Conversation.id)
            .where(Message.id == message.id, Message.role == "user", message_owner_condition(Conversation.user_id),
                Message.user_id == action.user_id, Conversation.user_id == action.user_id,
                Conversation.deleted_at.is_(None)).execution_options(populate_existing=True))
        if owned is None or (action.conversation_id is not None and owned.conversation_id != action.conversation_id):
            raise ValueError("invalid_activity_source")
        observed = owned.created_at
        if observed is not None and observed.utcoffset() is None:
            observed = None
        context = BehaviorContext(current_utterance=owned.content, source_message_id=owned.id, observed_at=observed)
        analysis = analyze_activity(context)
        ids = []
        for index, item in enumerate(analysis.activities):
            metadata = {"version": "activity-v01", "user_reported": True,
                "evidence": item.evidence.model_dump(mode="json"), "time_issues": item.time_issues,
                "reported_duration_minutes": item.reported_duration_minutes,
                "calculated_duration_minutes": item.calculated_duration_minutes}
            inserted = db.scalar(pg_insert(Activity).values(user_id=action.user_id,
                conversation_id=owned.conversation_id, message_id=owned.id, agent_action_id=action.id,
                record_index=index, action=item.action, status=item.status, activity_date=item.activity_date,
                start_time=item.start_time, end_time=item.end_time, duration_minutes=item.duration_minutes,
                observed_at=item.observed_at, confidence=item.confidence, metadata=metadata,
            ).on_conflict_do_nothing(index_elements=[Activity.message_id, Activity.record_index]).returning(Activity.id))
            existing = db.scalar(select(Activity).where(Activity.message_id == owned.id, Activity.record_index == index))
            # 재실행/다른 action에서도 최초 원문 기록은 갱신하지 않습니다. 외부 사용자 기록도 재사용하지 않습니다.
            if existing is None or existing.user_id != action.user_id or existing.conversation_id != owned.conversation_id:
                raise ValueError("invalid_activity_reuse")
            ids.append(inserted or existing.id)
        return ids
    except Exception:
        # 오류를 성공/빈 활동으로 숨기지 않습니다. 이 action의 Daily/Activity 단위만 취소합니다.
        db.rollback()
        raise


def _owned_query(user_id):
    """소유자뿐 아니라 원문/Action 연결과 삭제 계정·대화까지 함께 제한합니다."""
    return (select(Activity).join(User, User.id == Activity.user_id)
        .join(Conversation, Conversation.id == Activity.conversation_id)
        .join(Message, Message.id == Activity.message_id)
        .join(AgentAction, AgentAction.id == Activity.agent_action_id)
        .where(Activity.user_id == user_id, User.deleted_at.is_(None), Conversation.user_id == user_id,
            Conversation.deleted_at.is_(None), Message.conversation_id == Activity.conversation_id,
            Message.user_id == user_id, Message.role == "user", AgentAction.user_id == user_id,
            AgentAction.message_id == Activity.message_id,
            or_(AgentAction.conversation_id.is_(None), AgentAction.conversation_id == Activity.conversation_id)))


def _response(row):
    """명시적으로 허용한 필드만 투영합니다. metadata의 원문 evidence는 응답에 포함하지 않습니다."""
    observed = row.observed_at
    if observed is not None and observed.utcoffset() is None:
        observed = None
    metadata = row.metadata_ or {}
    return ActivityResponse(id=row.id, action=row.action, status=row.status, activity_date=row.activity_date,
        start_time=row.start_time, end_time=row.end_time, duration_minutes=row.duration_minutes,
        observed_at=observed, confidence=row.confidence, time_issues=metadata.get("time_issues", []),
        reported_duration_minutes=metadata.get("reported_duration_minutes"),
        calculated_duration_minutes=metadata.get("calculated_duration_minutes"))


def read_activities(db, principal: AuthPrincipal, *, activity_id: UUID | None = None, limit=50):
    """읽기 전용 owner 조회입니다. 존재 여부/내부 DB 오류/validation 원문을 노출하지 않습니다."""
    if not isinstance(principal, AuthPrincipal):
        raise HTTPException(401, "인증이 필요합니다.")
    try:
        with db.no_autoflush:
            if db.scalar(select(User.id).where(User.id == principal.user_id, User.deleted_at.is_(None))) is None:
                raise HTTPException(404, "활동을 찾을 수 없습니다.")
            query = _owned_query(principal.user_id)
            if activity_id is not None:
                row = db.scalar(query.where(Activity.id == activity_id))
                if row is None:
                    raise HTTPException(404, "활동을 찾을 수 없습니다.")
                return _response(row)
            rows = db.scalars(query.order_by(Activity.observed_at.desc().nulls_last(), Activity.id.desc()).limit(limit))
            return [_response(row) for row in rows]
    except (SQLAlchemyError, ValidationError, TypeError, ValueError) as error:
        db.rollback()
        raise HTTPException(503, "활동을 조회할 수 없습니다.") from error
