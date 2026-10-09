"""기존 보고는 보존하고 확인된 완료 연결만 metadata에 추가합니다. 외부 호출은 없습니다."""

from datetime import timezone

from sqlalchemy import select

from agent.activity_link_schemas import ActivityCompletionLink
from agent.activity_recorder import analyze_activity, is_explicit_completion_report
from agent.activity_schemas import ActivityObservation
from agent.activity_service import _owned_query
from agent.behavior_schemas import BehaviorContext
from models.activity import Activity
from models.agent_action import AgentAction
from models.message import Message


LINK_KEY = "activity_completion_link"


class ActivityLinkError(Exception):
    """원문/UUID/DB 오류를 포함하지 않는 고정된 실행 실패 종류입니다."""


def _approval_time(db, approval):
    value = approval.confirmed_at
    if value is None:
        raise ActivityLinkError
    if value.utcoffset() is None:
        # 합성 SQLite만 timezone을 제거합니다. 서버가 UTC로 생성한 승인 시각을 읽기용으로 복원합니다.
        if db.get_bind().dialect.name != "sqlite":
            raise ActivityLinkError
        return value.replace(tzinfo=timezone.utc)
    return value


def lock_activity_pair(db, user_id, pair):
    """서로 겹치는 쌍도 같은 Activity ID 순서로 잠가 경합을 직렬화합니다."""
    rows = {}
    for record_id in sorted((pair.ongoing_activity_id, pair.completion_activity_id)):
        row = db.scalar(select(Activity).where(Activity.id == record_id, Activity.user_id == user_id)
            .with_for_update().execution_options(populate_existing=True))
        if row is None:
            raise ActivityLinkError
        rows[record_id] = row
    return rows[pair.ongoing_activity_id], rows[pair.completion_activity_id]


def _validated_report(db, row, user_id):
    """저장된 해석과 원문을 다시 대조하며 손상된 provenance를 그대로 신뢰하지 않습니다."""
    if db.scalar(_owned_query(user_id).where(Activity.id == row.id)) is None:
        raise ActivityLinkError
    metadata = row.metadata_
    if not isinstance(metadata, dict) or metadata.get("version") != "activity-v01" or metadata.get("user_reported") is not True:
        raise ActivityLinkError
    report = ActivityObservation(action=row.action, status=row.status, activity_date=row.activity_date,
        start_time=row.start_time, end_time=row.end_time, duration_minutes=row.duration_minutes,
        reported_duration_minutes=metadata["reported_duration_minutes"],
        calculated_duration_minutes=metadata["calculated_duration_minutes"], time_issues=metadata["time_issues"],
        observed_at=row.observed_at, confidence=row.confidence, evidence=metadata["evidence"])
    message = db.get(Message, row.message_id, populate_existing=True)
    result = analyze_activity(BehaviorContext(current_utterance=message.content,
        source_message_id=message.id, observed_at=row.observed_at))
    if not 0 <= row.record_index < len(result.activities) or result.activities[row.record_index] != report:
        raise ActivityLinkError
    return report


def _read_link(db, row, user_id):
    """기존 연결 재사용도 승인 Action과 고정된 대상 쌍을 검증합니다."""
    from agent.activity_link_schemas import bound_activity_link_arguments
    if not isinstance(row.metadata_, dict):
        raise ActivityLinkError
    if LINK_KEY not in row.metadata_:
        return None
    link = ActivityCompletionLink.model_validate(row.metadata_[LINK_KEY])
    approval = db.get(AgentAction, link.confirmation_action_id, populate_existing=True)
    if approval is None or approval.user_id != user_id:
        raise ActivityLinkError
    pair = bound_activity_link_arguments(approval)
    if (link.completion_activity_id != row.id or link.ongoing_activity_id == row.id
            or pair.ongoing_activity_id != link.ongoing_activity_id
            or pair.completion_activity_id != row.id or approval.confirmation_status != "confirmed"
            or approval.confirmation_id != link.confirmation_id or approval.confirmed_at is None
            or approval.conversation_id != row.conversation_id or approval.message_id != row.message_id):
        raise ActivityLinkError
    if _approval_time(db, approval) != link.confirmed_at:
        raise ActivityLinkError
    return link


def link_activity_completion(db, action, pair):
    """caller가 User/Action 잠금 및 commit/rollback을 관리합니다. 상태·원문·시간은 갱신하지 않습니다."""
    ongoing, completion = lock_activity_pair(db, action.user_id, pair)
    if (ongoing.conversation_id != completion.conversation_id
            or action.conversation_id != completion.conversation_id or action.message_id != completion.message_id
            or ongoing.message_id == completion.message_id):
        raise ActivityLinkError
    before = _validated_report(db, ongoing, action.user_id)
    after = _validated_report(db, completion, action.user_id)
    if before.status != "ongoing" or not is_explicit_completion_report(after) or before.action != after.action:
        raise ActivityLinkError
    if before.activity_date and after.activity_date and after.activity_date < before.activity_date:
        raise ActivityLinkError
    if (before.activity_date is not None and before.activity_date == after.activity_date
            and before.start_time is not None and after.end_time is not None and after.end_time < before.start_time):
        raise ActivityLinkError
    if "future_activity_date" in before.time_issues or "future_activity_date" in after.time_issues:
        raise ActivityLinkError
    if before.observed_at and after.observed_at and after.observed_at < before.observed_at:
        raise ActivityLinkError
    # 같은 ongoing 행을 잠근 뒤 재조회하므로 후발 요청은 먼저 commit된 연결을 발견합니다.
    existing = None
    rows = db.scalars(select(Activity).where(Activity.user_id == action.user_id,
        Activity.conversation_id == completion.conversation_id).execution_options(populate_existing=True))
    for row in rows:
        link = _read_link(db, row, action.user_id)
        if link is None:
            continue
        if row.id == ongoing.id or (row.id == completion.id and link.ongoing_activity_id != ongoing.id):
            raise ActivityLinkError
        if link.ongoing_activity_id == ongoing.id:
            if row.id != completion.id:
                raise ActivityLinkError
            existing = link
    if existing is not None:
        return True
    link = ActivityCompletionLink(ongoing_activity_id=ongoing.id, completion_activity_id=completion.id,
        confirmation_action_id=action.id, confirmation_id=action.confirmation_id, confirmed_at=_approval_time(db, action))
    completion.metadata_ = {**completion.metadata_, LINK_KEY: link.model_dump(mode="json")}
    db.flush()
    return False
