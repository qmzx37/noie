"""관리자 전용 접근과 감사 commit 경계입니다. 일반 ownership 서비스는 변경하지 않습니다."""

import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from auth_context import AuthPrincipal
from chat_storage_schemas import ConversationResponse, MessageResponse
from memory_schemas import MemoryResponse
from models.admin_audit_log import AdminAuditLog
from models.admin_break_glass_session import AdminBreakGlassSession
from models.admin_grant import AdminGrant
from models.conversation import Conversation
from models.memory import Memory, MemoryEvidence
from models.message import Message
from models.user import User
from models.agent_action import AgentAction
from models.emotion_event import EmotionEvent
from models.daily_life_event import DailyLifeEvent
from models.dream_goal import DreamGoal
from models.schedule import Schedule
from models.place_event import PlaceEvent
from models.body_state_event import BodyStateEvent
from models.cognitive_state_event import CognitiveStateEvent
from models.recommendation import Recommendation
from models.relationship_event import RelationshipEvent
from agent.emotion_event_schemas import EmotionEventResponse
from agent.daily_life_event_schemas import DailyLifeEventResponse
from agent.dream_goal_event_schemas import DreamGoalResponse
from agent.schedule_schemas import ScheduleResponse
from agent.place_schemas import PlaceEventResponse
from agent.body_state_schemas import BodyStateEventResponse
from agent.cognitive_state_schemas import CognitiveStateEventResponse
from agent.recommendation_schemas import RecommendationResponse
from agent.relationship_schemas import RelationshipEventResponse

ROLES = frozenset({"owner", "security_admin", "support_admin"})
PRIVATE_ROLES = frozenset({"owner", "security_admin"})
OWNER_ROLES = frozenset({"owner"})
SCOPES = frozenset({"memory_read", "conversation_read"})
REASONS = frozenset({"user_support_request", "security_incident", "account_recovery", "other"})
DEFAULT_TTL_SECONDS = 600
MAX_TTL_SECONDS = 900

# 임의 테이블 이름으로 조회하지 않습니다. 기존 읽기 계약이 있는 사용자 기록만 허용합니다.
OWNER_RECORDS = {
    "emotion": (EmotionEvent, EmotionEventResponse),
    "daily": (DailyLifeEvent, DailyLifeEventResponse),
    "dream-goal": (DreamGoal, DreamGoalResponse),
    "schedule": (Schedule, ScheduleResponse),
    "place": (PlaceEvent, PlaceEventResponse),
    "body": (BodyStateEvent, BodyStateEventResponse),
    "cognitive": (CognitiveStateEvent, CognitiveStateEventResponse),
    "recommendation": (Recommendation, RecommendationResponse),
    "relationship": (RelationshipEvent, RelationshipEventResponse),
}


def operational_metadata(metadata):
    """임의 JSON 내용 대신 알려진 버전/파이프라인 코드만 공개합니다. token/identity는 제외합니다."""
    if not isinstance(metadata, dict):
        return {}
    values = {"emotion-v1", "daily-life-v1", "dream-goal-v1", "schedule-v1", "place-v1",
              "body-state-v1", "cognitive-state-v1", "recommendation-v1", "relationship-v1",
              "emotion_event", "daily_life_event", "explicit_user_statement",
              "orchestrator-record-emotion", "orchestrator-record-daily-trace",
              "orchestrator-record-dream-goal", "orchestrator-create-schedule"}
    return {key: value for key, value in metadata.items()
            if key in {"extractor_version", "version", "record_kind", "pipeline", "evidence_basis"}
            and isinstance(value, str) and value in values}


class AdminAccessError(Exception):
    """입력/DB/원문을 담지 않는 고정된 접근 실패입니다."""

    def __init__(self, status_code=403):
        self.status_code = status_code


def validate_case_reference(value):
    """reason은 code만, case는 숫자 운영 번호만 허용해 자유 원문 복사를 막습니다."""
    if value is not None and (not isinstance(value, str) or not re.fullmatch(r"CASE-[0-9]{1,12}", value)):
        raise AdminAccessError(400)
    return value


def _now():
    return datetime.now(timezone.utc)


def _aware(value):
    """PostgreSQL timestamptz를 사용하며 격리 SQLite fixture의 UTC naive 값을 보정합니다."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _user(db, user_id, *, active=True, exclusive=False):
    """짧은 읽기 동안 활성 상태를 고정합니다. 외부 API 호출은 전혀 없습니다."""
    stmt = select(User).where(User.id == user_id)
    if active:
        stmt = stmt.where(User.deleted_at.is_(None))
    row = db.scalar(stmt.with_for_update(read=not exclusive))
    if row is None:
        raise AdminAccessError(404)
    return row


def _authorize(db, principal, allowed):
    """오직 검증된 local Principal과 현재 DB grant만 권한입니다. client role은 읽지 않습니다."""
    if not isinstance(principal, AuthPrincipal):
        raise AdminAccessError(401)
    try:
        _user(db, principal.user_id)
    except AdminAccessError:
        raise AdminAccessError(403) from None
    grants = db.scalars(select(AdminGrant).where(
        AdminGrant.user_id == principal.user_id, AdminGrant.is_active.is_(True),
        AdminGrant.revoked_at.is_(None), AdminGrant.role.in_(allowed),
    ).with_for_update(read=True)).all()
    if not grants:
        raise AdminAccessError(403)


def _append_audit(db, *, actor_user_id, actor_kind, target_user_id, action, outcome,
                  resource_type=None, resource_id=None, reason_code=None, case_reference=None):
    """내용/이메일/token/네트워크 정보 없이 allowlisted 사건 필드만 INSERT합니다."""
    # 향후 내부 caller가 추가되어도 자유 reason/case/resource 문자열을 저장하지 않습니다.
    validate_case_reference(case_reference)
    if reason_code is not None and reason_code not in REASONS:
        raise AdminAccessError(400)
    if resource_type is not None and resource_type not in {"memory", "conversation", "break_glass", "admin_grant", *OWNER_RECORDS}:
        raise AdminAccessError(400)
    row = AdminAuditLog(actor_user_id=actor_user_id, actor_kind=actor_kind,
        target_user_id=target_user_id, action=action, outcome=outcome,
        resource_type=resource_type, resource_id=resource_id,
        reason_code=reason_code, case_reference=case_reference, created_at=_now())
    db.add(row)
    db.flush()
    return row


def _commit_audit(db, **event):
    """INSERT나 commit이 실패하면 응답 payload를 반환하지 않고 rollback합니다."""
    try:
        _append_audit(db, **event)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(503, "감사 기록을 안전하게 저장할 수 없습니다.") from None


def admin_operation(db, principal, *, action, allowed=PRIVATE_ROLES, target_user_id=None,
                    resource_type=None, resource_id=None, reason_code=None, case_reference=None,
                    operation):
    """직렬화된 응답을 먼저 준비하고 durable audit 성공 후에만 반환합니다."""
    event = dict(actor_user_id=principal.user_id, actor_kind="user", target_user_id=target_user_id,
                 action=action, resource_type=resource_type, resource_id=resource_id,
                 reason_code=reason_code, case_reference=case_reference)
    try:
        _authorize(db, principal, allowed)
        payload = operation()
    except AdminAccessError as error:
        db.rollback()
        _commit_audit(db, **event, outcome="not_found" if error.status_code == 404 else "denied")
        detail = "요청한 리소스를 찾을 수 없습니다." if error.status_code == 404 else "관리자 접근이 허용되지 않습니다."
        raise HTTPException(error.status_code, detail) from None
    except Exception:
        db.rollback()
        _commit_audit(db, **event, outcome="failed")
        raise HTTPException(503, "관리자 요청을 안전하게 처리할 수 없습니다.") from None
    _commit_audit(db, **event, outcome="success")
    return payload


def user_summary(db, user_id):
    """정확한 UUID 한 건의 운영 상태/개수만 반환합니다. 이름/metadata/원문은 제외합니다."""
    row = _user(db, user_id, active=False)
    return dict(user_id=row.id, status="active" if row.deleted_at is None else "inactive",
        created_at=row.created_at,
        conversation_count=db.scalar(select(func.count()).select_from(Conversation).where(
            Conversation.user_id == user_id, Conversation.deleted_at.is_(None))),
        memory_count=db.scalar(select(func.count()).select_from(Memory).where(
            Memory.user_id == user_id, Memory.deleted_at.is_(None), Memory.status == "active")))


def create_break_glass(db, principal, *, target_user_id, scope, reason_code,
                       ttl_seconds=DEFAULT_TTL_SECONDS, case_reference=None):
    """grant 확인은 caller 경계에서 하고 대상/scope/TTL을 여기서도 검증합니다."""
    if scope not in SCOPES or reason_code not in REASONS or type(ttl_seconds) is not int or not 1 <= ttl_seconds <= MAX_TTL_SECONDS:
        raise AdminAccessError(400)
    validate_case_reference(case_reference)
    _user(db, target_user_id)
    now = _now()
    row = AdminBreakGlassSession(admin_user_id=principal.user_id, target_user_id=target_user_id,
        scope=scope, reason_code=reason_code, case_reference=case_reference,
        created_at=now, expires_at=now + timedelta(seconds=ttl_seconds))
    db.add(row)
    db.flush()
    return dict(id=row.id, target_user_id=row.target_user_id, scope=row.scope, expires_at=row.expires_at)


def _session(db, principal, session_id, *, target=None, scope=None):
    """현재 관리자와 session 소유자를 묶고 wrong target/resource는 존재 여부 없이 404입니다."""
    row = db.scalar(select(AdminBreakGlassSession).where(
        AdminBreakGlassSession.id == session_id,
        AdminBreakGlassSession.admin_user_id == principal.user_id,
    ).with_for_update(read=True).execution_options(populate_existing=True))
    if row is None or (target is not None and row.target_user_id != target):
        raise AdminAccessError(404)
    if row.revoked_at is not None or _aware(row.expires_at) <= _now() or (scope is not None and row.scope != scope):
        raise AdminAccessError(403)
    _user(db, row.target_user_id)
    return row


def revoke_break_glass(db, principal, session_id):
    """본인 session만 철회하며 만료/이미 철회된 session도 idempotent하게 처리합니다."""
    row = db.scalar(select(AdminBreakGlassSession).where(
        AdminBreakGlassSession.id == session_id, AdminBreakGlassSession.admin_user_id == principal.user_id,
    ).with_for_update())
    if row is None:
        raise AdminAccessError(404)
    if row.revoked_at is None:
        row.revoked_at = _now()
    return {"status": "revoked"}


def read_memory(db, principal, session_id, user_id, memory_id):
    """특정 활성 Memory와 동일 사용자/활성 대화의 evidence만 직렬화합니다."""
    _session(db, principal, session_id, target=user_id, scope="memory_read")
    return _read_target_memory(db, user_id, memory_id)


def _read_target_memory(db, user_id, memory_id):
    """OWNER와 Break-glass가 공통 ownership/evidence 조회를 사용합니다."""
    row = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id,
        Memory.deleted_at.is_(None), Memory.status == "active").options(
            selectinload(Memory.evidence).joinedload(MemoryEvidence.message)).execution_options(populate_existing=True))
    if row is None:
        raise AdminAccessError(404)
    # legacy 데이터의 잘못된 evidence 연결까지 원문 노출 경계에서 재검사합니다.
    ids = {e.message.conversation_id for e in row.evidence}
    found = set(db.scalars(select(Conversation.id).where(Conversation.id.in_(ids),
        Conversation.user_id == user_id, Conversation.deleted_at.is_(None))).all())
    if ids != found:
        raise AdminAccessError(404)
    return MemoryResponse.model_validate(row).model_dump(mode="json")


def read_messages(db, principal, session_id, user_id, conversation_id, limit=50, offset=0):
    """대상 소유 대화만 created_at/id 순서로 제한 조회하며 metadata는 제외합니다."""
    _session(db, principal, session_id, target=user_id, scope="conversation_read")
    return _read_target_messages(db, user_id, conversation_id, limit, offset)


def _read_target_messages(db, user_id, conversation_id, limit, offset):
    """권한 경로와 무관하게 target와 실제 대화 소유자를 항상 일치시킵니다."""
    row = db.scalar(select(Conversation.id).where(Conversation.id == conversation_id,
        Conversation.user_id == user_id, Conversation.deleted_at.is_(None)))
    if row is None:
        raise AdminAccessError(404)
    rows = db.scalars(select(Message).where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at, Message.id).limit(min(max(limit, 1), 100)).offset(offset)).all()
    return [MessageResponse.model_validate(row).model_dump(mode="json") for row in rows]


def read_owner_memory(db, user_id, memory_id):
    """caller의 OWNER 검사/audit 경계 안에서만 직접 읽습니다. 일반 API는 사용하지 않습니다."""
    _user(db, user_id)
    return _read_target_memory(db, user_id, memory_id)


def read_owner_messages(db, user_id, conversation_id, limit=50, offset=0):
    """OWNER는 session 없이 조회하되 동일 target 검증과 페이지 제한을 유지합니다."""
    _user(db, user_id)
    return _read_target_messages(db, user_id, conversation_id, limit, offset)


def read_owner_conversation(db, user_id, conversation_id):
    """원문과 별개인 대화 제목/생성일 등 기존 공개 계약의 운영 정보를 읽습니다."""
    _user(db, user_id)
    row = db.scalar(select(Conversation).where(Conversation.id == conversation_id,
        Conversation.user_id == user_id, Conversation.deleted_at.is_(None)).execution_options(populate_existing=True))
    if row is None:
        raise AdminAccessError(404)
    payload = ConversationResponse.model_validate(row).model_dump(mode="json")
    payload["metadata"] = operational_metadata(row.metadata_)
    return payload


def read_owner_records(db, user_id, record_type, limit=50, offset=0):
    """기존 9개 도메인 기록만 페이지 조회합니다. Tool/Agent 실행이나 기록 변경은 없습니다."""
    _user(db, user_id)
    if record_type not in OWNER_RECORDS:
        raise AdminAccessError(404)
    model, response = OWNER_RECORDS[record_type]
    rows = db.scalars(select(model).where(model.user_id == user_id)
        .order_by(model.created_at.desc(), model.id.desc()).limit(min(max(limit, 1), 100)).offset(offset)
        .execution_options(populate_existing=True)).all()
    # legacy의 잘못된 FK 조합으로 타 사용자 근거/작업 ID까지 노출하지 않도록 재검사합니다.
    conversations = {row.conversation_id for row in rows if row.conversation_id is not None}
    messages = {row.message_id for row in rows if row.message_id is not None}
    actions = {row.agent_action_id for row in rows}
    owned_conversations = set(db.scalars(select(Conversation.id).where(Conversation.id.in_(conversations),
        Conversation.user_id == user_id, Conversation.deleted_at.is_(None))).all())
    owned_messages = set(db.scalars(select(Message.id).join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.id.in_(messages), Conversation.user_id == user_id, Conversation.deleted_at.is_(None))).all())
    owned_actions = set(db.scalars(select(AgentAction.id).where(AgentAction.id.in_(actions), AgentAction.user_id == user_id)).all())
    if (conversations, messages, actions) != (owned_conversations, owned_messages, owned_actions):
        raise AdminAccessError(404)
    payload = []
    for row in rows:
        item = response.model_validate(row).model_dump(mode="json", exclude={"metadata"})
        item["metadata"] = operational_metadata(row.metadata_)
        payload.append(item)
    return payload


def list_audits(db, *, limit=50, offset=0):
    """감사 테이블만 읽습니다. resource/identity 원문 테이블을 join하지 않습니다."""
    rows = db.scalars(select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
        .limit(min(max(limit, 1), 100)).offset(offset)).all()
    fields = ("id", "actor_user_id", "actor_kind", "target_user_id", "action", "resource_type",
              "resource_id", "outcome", "reason_code", "case_reference", "created_at")
    return [dict((field, getattr(row, field)) for field in fields) for row in rows]


def provision_admin_grant(db, *, user_id: UUID, role: str, reason_code: str, revoke=False, case_reference=None):
    """operator-only CLI 계약입니다. user 행 lock으로 동일 grant 생성 경쟁을 직렬화합니다."""
    try:
        if role not in ROLES or reason_code not in REASONS:
            raise AdminAccessError(400)
        validate_case_reference(case_reference)
        _user(db, user_id, exclusive=True)
        row = db.scalar(select(AdminGrant).where(AdminGrant.user_id == user_id, AdminGrant.role == role).with_for_update())
        if row is None:
            if revoke:
                raise AdminAccessError(404)
            row = AdminGrant(user_id=user_id, role=role, is_active=True)
            db.add(row)
        elif revoke:
            row.is_active = False
            row.revoked_at = row.revoked_at or _now()
        else:
            row.is_active = True
            row.revoked_at = None
        db.flush()
        result = {"status": "revoked" if revoke else "granted"}
        _commit_audit(db, actor_user_id=None, actor_kind="operator", target_user_id=user_id,
            action="admin_grant.revoke" if revoke else "admin_grant.provision", outcome="success",
            resource_type="admin_grant", resource_id=row.id, reason_code=reason_code, case_reference=case_reference)
        return result
    except AdminAccessError as error:
        db.rollback()
        # 잘못된 code/자유 case 원문은 감사에 복제하지 않습니다. 미존재 UUID 사건도 기록합니다.
        safe_case = case_reference if isinstance(case_reference, str) and re.fullmatch(r"CASE-[0-9]{1,12}", case_reference) else None
        _commit_audit(db, actor_user_id=None, actor_kind="operator", target_user_id=user_id,
            action="admin_grant.revoke" if revoke else "admin_grant.provision",
            outcome="not_found" if error.status_code == 404 else "denied", resource_type="admin_grant",
            reason_code=reason_code if reason_code in REASONS else None, case_reference=safe_case)
        raise
    except Exception:
        db.rollback()
        raise
