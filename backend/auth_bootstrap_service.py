"""전용 onboarding에서만 local User와 검증된 외부 신원을 원자적으로 생성합니다."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from auth_context import VerifiedAuthIdentity
from models.auth_identity import AuthIdentity
from models.user import User


class BootstrapError(Exception):
    """식별자/DB 원문 대신 고정 실패 코드만 전달합니다."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _existing_active_user(db: Session, identity: VerifiedAuthIdentity) -> UUID | None:
    """기존 mapping을 변경하지 않으며 삭제된 사용자를 새 계정으로 대체하지 않습니다."""
    mapping = db.scalar(select(AuthIdentity).where(
        AuthIdentity.provider == identity.provider, AuthIdentity.subject == identity.subject,
    ))
    if mapping is None:
        return None
    owner = db.scalar(select(User.id).where(User.id == mapping.user_id, User.deleted_at.is_(None)))
    if owner is None:
        raise BootstrapError('INACTIVE_AUTH_USER')
    return owner


def bootstrap_auth_identity(db: Session, identity: VerifiedAuthIdentity) -> UUID:
    """같은 subject의 UNIQUE 경쟁에서 패자의 User까지 rollback하여 고아 계정을 남기지 않습니다."""
    try:
        if not isinstance(identity, VerifiedAuthIdentity) or identity.provider != 'supabase':
            raise ValueError
        subject = UUID(identity.subject)
        if subject.int == 0 or str(subject) != identity.subject:
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise BootstrapError('INVALID_VERIFIED_IDENTITY') from None

    try:
        existing = _existing_active_user(db, identity)
        if existing is not None:
            return existing
        # local UUID는 ORM uuid4로 생성합니다. 외부 subject/email/dev-user를 ID로 사용하지 않습니다.
        user = User(name='noie-user')
        db.add(user)
        db.flush()
        owner = user.id
        db.add(AuthIdentity(user_id=owner, provider=identity.provider, subject=identity.subject))
        db.commit()  # 두 행 모두 같은 transaction에서 확정합니다.
        return owner
    except IntegrityError:
        db.rollback()  # 새 User까지 취소한 뒤 이미 commit된 경쟁 승자의 mapping만 재사용합니다.
        try:
            winner = _existing_active_user(db, identity)
            if winner is not None:
                return winner
        except BootstrapError:
            db.rollback()
            raise
        except SQLAlchemyError:
            db.rollback()
        raise BootstrapError('BOOTSTRAP_UNAVAILABLE') from None
    except BootstrapError:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise BootstrapError('BOOTSTRAP_UNAVAILABLE') from None
