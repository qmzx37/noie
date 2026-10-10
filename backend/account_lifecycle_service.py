"""명시적 자기 계정 비활성화와 원자적 purge입니다. 외부 Auth 계정은 삭제하지 않습니다."""

from datetime import datetime, timezone
from uuid import UUID
from account_write_guard import bound_lifecycle_lock_wait

from sqlalchemy import delete, or_, select, text, update

from auth_context import AuthPrincipal
from database import Base, SessionLocal
import models  # 전체 FK inventory를 먼저 등록합니다.
from models.admin_audit_log import AdminAuditLog
from models.admin_grant import AdminGrant
from models.admin_break_glass_session import AdminBreakGlassSession
from models.user import User

# 순서는 실제 FK 기준 child -> parent입니다. 새 테이블은 검토 없이 자동 삭제하지 않습니다.
PURGE_ORDER = (
    "memory_evidence", "memory_extractions", "object_mentions", "activities", "body_state_events", "cognitive_state_events",
    "daily_life_events", "dream_goals", "emotion_events", "place_events", "recommendations",
    "relationship_events", "schedules", "chat_requests", "agent_actions", "messages",
    "memories", "conversations", "admin_break_glass_sessions", "admin_grants",
    "auth_identities", "users",
)
RETAINED_TABLES = frozenset({"admin_audit_logs"})


class AccountLifecycleError(Exception):
    """원문/식별자/DB 상세 대신 고정 code만 전달합니다."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


def validate_inventory():
    """삭제 대상 누락과 삭제 순서 회귀를 runtime/test 모두에서 차단합니다."""
    tables = Base.metadata.tables
    if set(tables) != set(PURGE_ORDER) | RETAINED_TABLES:
        raise AccountLifecycleError("UNREVIEWED_SCHEMA")
    position = {name: index for index, name in enumerate(PURGE_ORDER)}
    for name in PURGE_ORDER:
        for fk in tables[name].foreign_keys:
            parent = fk.column.table.name
            if parent != name and position[name] >= position[parent]:
                raise AccountLifecycleError("INVALID_PURGE_ORDER")


def _audit(db, user_id, action, *, operator=False):
    """계정이 사라진 뒤에도 남는 최소 사건입니다. 원문과 외부 subject는 저장하지 않습니다."""
    db.add(AdminAuditLog(actor_user_id=None if operator else user_id,
        actor_kind="operator" if operator else "user", target_user_id=user_id,
        action=action, outcome="success"))
    db.flush()


def deactivate_account(db, principal):
    """Phase A: 먼저 잠그고 audit와 함께 commit합니다. purge 실패가 이를 되돌리지 않습니다."""
    if not isinstance(principal, AuthPrincipal):
        raise AccountLifecycleError("UNAUTHENTICATED")
    try:
        validate_inventory()
        # User-first 저장 잠금과 만나는 삭제 경계도 무한 대기하지 않습니다.
        bound_lifecycle_lock_wait(db)
        # 동시 OWNER 두 명의 삭제가 서로를 '다른 OWNER'로 보는 경쟁을 직렬화합니다.
        # CLI의 명시적 권한 재배치는 별도 운영 권한이며 이 HTTP 잠금을 우회하는 자동 경로가 아닙니다.
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(1180001)"))
        user = db.scalar(select(User).where(User.id == principal.user_id)
            .with_for_update().execution_options(populate_existing=True))
        if user is None:
            raise AccountLifecycleError("ACCOUNT_UNAVAILABLE")
        if user.deleted_at is not None:
            db.rollback()
            return
        owners = set(db.scalars(select(AdminGrant.user_id).join(User, User.id == AdminGrant.user_id)
            .where(AdminGrant.role == "owner", AdminGrant.is_active.is_(True),
                AdminGrant.revoked_at.is_(None), User.deleted_at.is_(None))
            .order_by(AdminGrant.user_id).with_for_update(read=True, of=AdminGrant)).all())
        if principal.user_id in owners and not (owners - {principal.user_id}):
            raise AccountLifecycleError("LAST_OWNER")
        now = datetime.now(timezone.utc)
        user.deleted_at = now
        db.execute(update(AdminGrant).where(AdminGrant.user_id == user.id)
            .values(is_active=False, revoked_at=now))
        db.execute(update(AdminBreakGlassSession).where(or_(
            AdminBreakGlassSession.admin_user_id == user.id,
            AdminBreakGlassSession.target_user_id == user.id),
            AdminBreakGlassSession.revoked_at.is_(None)).values(revoked_at=now))
        _audit(db, user.id, "account.delete.request")
        db.commit()  # AuthIdentity를 유지하여 pending purge 중 bootstrap도 차단합니다.
        db.expire_all()  # 같은 세션의 이미 로드된 grant/session도 철회 상태로 다시 읽습니다.
    except AccountLifecycleError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise AccountLifecycleError("DEACTIVATION_UNAVAILABLE") from None


def _purge_targets(db, user_id):
    """ID subquery만 구성합니다. 원문/대량 UUID 목록을 Python으로 가져오지 않습니다."""
    tables = Base.metadata.tables
    # 큰 계정도 PostgreSQL bind parameter 한도를 넘지 않게 IN (SELECT ...)를 사용합니다.
    targets = {}
    targets["users"] = select(tables["users"].c.id).where(tables["users"].c.id == user_id).correlate(None)
    for name in PURGE_ORDER:
        table = tables[name]
        if name not in {"users", "messages", "admin_break_glass_sessions"} and "user_id" in table.c:
            targets[name] = select(table.c.id).where(table.c.user_id == user_id).correlate(None)
    messages = tables["messages"]
    targets["messages"] = select(messages.c.id).where(
        messages.c.conversation_id.in_(targets["conversations"])).correlate(None)
    sessions = tables["admin_break_glass_sessions"]
    targets[sessions.name] = select(sessions.c.id).where(or_(
        sessions.c.admin_user_id == user_id, sessions.c.target_user_id == user_id)).correlate(None)
    for name in ("memory_evidence", "memory_extractions", "chat_requests"):
        table = tables[name]
        references = [fk.parent.in_(targets[fk.column.table.name]) for fk in table.foreign_keys]
        pk = next(iter(table.primary_key.columns))
        targets[name] = select(pk).where(or_(*references)).correlate(None)
    # cross-user legacy FK 문제는 다른 사람의 데이터를 지우거나 SET NULL시키지 않고 중단합니다.
    for name in PURGE_ORDER:
        table = tables[name]
        pk = next(iter(table.primary_key.columns))
        for fk in table.foreign_keys:
            parent = fk.column.table.name
            if parent == "users" and name == "admin_break_glass_sessions":
                continue  # 대상/발급자가 삭제 계정인 보안 허가 자체를 제거하는 정책입니다.
            # 삭제 부모를 참조하는 다른 소유 행이 있으면 purge 전체를 rollback합니다.
            foreign = select(pk).where(fk.parent.in_(targets[parent]), pk.not_in(targets[name])).limit(1)
            if db.scalar(foreign) is not None:
                raise AccountLifecycleError("CROSS_ACCOUNT_REFERENCE")
            # 링크의 한쪽만 자기 소유인 경우도 거부합니다. 타 사용자 근거 연결까지 삭제하지 않습니다.
            outgoing = select(pk).where(pk.in_(targets[name]), fk.parent.is_not(None),
                fk.parent.not_in(targets[parent])).limit(1)
            if db.scalar(outgoing) is not None:
                raise AccountLifecycleError("CROSS_ACCOUNT_REFERENCE")
            # Message.user_id NULL(assistant/system)은 허용하되 다른 사용자 원문은 삭제하지 않습니다.
            if name == "messages" and parent == "users":
                wrong = select(pk).where(pk.in_(targets[name]), fk.parent.is_not(None), fk.parent != user_id).limit(1)
                if db.scalar(wrong) is not None:
                    raise AccountLifecycleError("CROSS_ACCOUNT_REFERENCE")
    return targets


def purge_deleted_account(db, user_id: UUID):
    """Phase B: 삭제 계정만 한 transaction으로 purge합니다. 재호출은 안전하게 no-op입니다."""
    try:
        validate_inventory()
        # purge도 동일한 User 잠금 전에 transaction-local 대기 한도를 설정합니다.
        bound_lifecycle_lock_wait(db)
        user = db.scalar(select(User).where(User.id == user_id)
            .with_for_update().execution_options(populate_existing=True))
        if user is None:
            db.rollback()
            return "already_absent"
        if user.deleted_at is None:
            raise AccountLifecycleError("ACTIVE_ACCOUNT")
        targets = _purge_targets(db, user_id)
        memories = Base.metadata.tables["memories"]
        # RESTRICT 자기 참조는 같은 계정의 purge transaction 안에서만 먼저 해제합니다.
        db.execute(update(memories).where(memories.c.id.in_(targets["memories"]))
            .values(supersedes_memory_id=None))
        mentions = Base.metadata.tables["object_mentions"]
        db.execute(update(mentions).where(mentions.c.id.in_(targets["object_mentions"]))
            .values(supersedes_mention_id=None))
        for name in PURGE_ORDER:
            table = Base.metadata.tables[name]
            pk = next(iter(table.primary_key.columns))
            db.execute(delete(table).where(pk.in_(targets[name])))
        _audit(db, user_id, "account.delete.purge", operator=True)
        db.commit()  # 감사 실패도 모든 hard delete를 취소합니다. Phase A는 이미 독립 commit입니다.
        db.expire_all()
        return "purged"
    except AccountLifecycleError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise AccountLifecycleError("PURGE_UNAVAILABLE") from None


def run_account_purge(user_id):
    """best-effort BackgroundTasks입니다. 실패하면 운영자 CLI가 복구하며 durable queue가 아닙니다."""
    try:
        if SessionLocal is None:
            raise AccountLifecycleError("PURGE_UNAVAILABLE")
        with SessionLocal() as db:
            purge_deleted_account(db, user_id)
    except Exception:
        # 원문 UUID/DB 오류/secret를 로그에 넣지 않습니다. 비활성 상태를 복원하지 않습니다.
        print("[noie] account_purge retry_required", flush=True)
