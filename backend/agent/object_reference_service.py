"""Activity 원문 근거 안의 언급을 검증합니다. 쓰기/로그/외부 호출은 없습니다."""

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from auth_context import AuthPrincipal
from agent.activity_recorder import analyze_activity
from agent.activity_schemas import ActivityObservation
from agent.activity_service import _owned_query
from agent.behavior_schemas import BehaviorContext
from agent.object_reference_schemas import (
    ActivityObjectReferencePreview,
    ActivityObjectReferenceRequest,
)
from models.activity import Activity
from models.message import Message


def _validated_evidence(row):
    """Lifecycle과 같은 재분석 계약을 ORM 갱신 없이 DB column snapshot에 적용합니다."""
    metadata = row["metadata"]
    if (not isinstance(metadata, dict) or metadata.get("version") != "activity-v01"
            or metadata.get("user_reported") is not True):
        raise ValueError("invalid_activity_evidence")
    observed = row["message_created_at"]
    if observed is not None and observed.utcoffset() is None:
        observed = None
    if row["observed_at"] != observed:
        raise ValueError("invalid_activity_observation")
    report = ActivityObservation(
        action=row["action"], status=row["status"], activity_date=row["activity_date"],
        start_time=row["start_time"], end_time=row["end_time"], duration_minutes=row["duration_minutes"],
        reported_duration_minutes=metadata["reported_duration_minutes"],
        calculated_duration_minutes=metadata["calculated_duration_minutes"],
        time_issues=metadata["time_issues"], observed_at=row["observed_at"],
        confidence=row["confidence"], evidence=metadata["evidence"],
    )
    result = analyze_activity(BehaviorContext(current_utterance=row["content"],
        source_message_id=row["message_id"], observed_at=observed))
    index = row["record_index"]
    if (type(index) is not int or not 0 <= index < len(result.activities)
            or result.activities[index] != report):
        raise ValueError("invalid_activity_evidence")
    quote = report.evidence.summary
    start = row["content"].find(quote)
    # offsets가 없는 기존 evidence에서 반복 문장의 위치를 임의로 결정하지 않습니다.
    if start < 0 or row["content"].find(quote, start + 1) != -1:
        raise ValueError("ambiguous_activity_evidence")
    return report, start, start + len(quote)


def preview_activity_object_reference(db, principal: AuthPrincipal, request: ActivityObjectReferenceRequest):
    """내부 읽기 전용 서비스. caller의 transaction/미저장 변경을 commit/rollback하지 않습니다.

    401 인증 없음, 404 소유권/활성 부모 없음, 409 손상·모호한 근거,
    422 입력/구간 불일치, 503 DB 조회 실패. 오류에 원문/UUID를 넣지 않습니다.
    """
    if not isinstance(principal, AuthPrincipal):
        raise HTTPException(401, "인증이 필요합니다.")
    try:
        supplied = request.model_dump() if isinstance(request, ActivityObjectReferenceRequest) else request
        checked = ActivityObjectReferenceRequest.model_validate(supplied)
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(422, "대상 참조 입력이 올바르지 않습니다.") from None
    try:
        with db.no_autoflush:
            # Entity 조회 대신 column을 투영해 stale ORM 캐시와 caller의 pending 값을 분리합니다.
            query = _owned_query(principal.user_id).where(Activity.id == checked.activity_id).with_only_columns(
                Activity.record_index, Activity.action, Activity.status, Activity.activity_date,
                Activity.start_time, Activity.end_time, Activity.duration_minutes, Activity.observed_at,
                Activity.confidence, Activity.metadata_.label("metadata"),
                Message.id.label("message_id"), Message.content, Message.created_at.label("message_created_at"),
            )
            row = db.execute(query).mappings().one_or_none()
            if row is None:
                raise HTTPException(404, "활동을 찾을 수 없습니다.")
            try:
                report, evidence_start, evidence_end = _validated_evidence(row)
            except (ValidationError, KeyError, TypeError, ValueError, AttributeError):
                raise HTTPException(409, "활동 근거를 명확하게 확인할 수 없습니다.") from None
            span = checked.source_span
            if (span.end > len(row["content"]) or span.start < evidence_start or span.end > evidence_end
                    or row["content"][span.start:span.end] != checked.label):
                raise HTTPException(422, "대상 표현과 활동 원문 구간이 일치하지 않습니다.")
            return ActivityObjectReferencePreview(**checked.model_dump(), observed_at=report.observed_at)
    except SQLAlchemyError:
        raise HTTPException(503, "활동 근거를 조회할 수 없습니다.") from None
