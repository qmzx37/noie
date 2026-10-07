"""계정 삭제와 늦은 결과 저장의 순서를 같은 User 행에서 보장합니다."""

from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.user import User


class AccountWriteRejected(SQLAlchemyError):
    """비활성/삭제된 계정에는 결과를 저장하거나 성공으로 반환하지 않습니다."""


def bound_lifecycle_lock_wait(db: Session) -> None:
    """현재 transaction에만 잠금 대기 한도를 적용합니다. 자동 재시도는 없습니다."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET LOCAL lock_timeout = '3s'"))


def lock_account_for_write(db: Session, user_id: UUID) -> bool:
    """User를 먼저 잠그고 최신 활성 상태를 읽습니다. 호출자가 commit까지 잠금을 유지합니다."""
    try:
        # ORM 캐시 대신 컬럼을 직접 조회하며, 검사 전에 pending 개인정보를 flush하지 않습니다.
        with db.no_autoflush:
            bound_lifecycle_lock_wait(db)
            row = db.execute(
                select(User.id, User.deleted_at).where(User.id == user_id)
                .with_for_update(read=True)
            ).one_or_none()
        # FOR SHARE는 비활성화/purge의 FOR UPDATE와 충돌합니다. KEY SHARE로 낮추면 안 됩니다.
        return row is not None and row.deleted_at is None
    except Exception:
        db.rollback()
        raise


def require_active_account_for_write(db: Session, user_id: UUID) -> None:
    """성공 시 commit하지 않습니다. 실패 시 pending 쓰기를 취소하고 fail closed합니다."""
    if not lock_account_for_write(db, user_id):
        db.rollback()
        raise AccountWriteRejected("account_write_rejected")
