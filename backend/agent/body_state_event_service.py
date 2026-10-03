"""소유권과 활성 사용자 정책을 적용한 Body State 읽기 서비스입니다."""

from uuid import UUID
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from models.body_state_event import BodyStateEvent
from models.user import User


class BodyStateNotFoundError(Exception):
    """없는 기록과 다른 사용자의 기록을 동일하게 처리합니다."""


class BodyStateDatabaseError(Exception):
    """외부 응답에 DB 내부 정보를 숨기기 위한 오류입니다."""


def get_body_state_event(db: Session, event_id: UUID, user_id: UUID) -> BodyStateEvent:
    """상세 조회에서 활성 소유자까지 함께 검증합니다."""
    try:
        item = db.scalar(select(BodyStateEvent).join(User).where(
            BodyStateEvent.id == event_id, BodyStateEvent.user_id == user_id, User.deleted_at.is_(None),
        ))
        if item is None:
            raise BodyStateNotFoundError
        return item
    except SQLAlchemyError as error:
        raise BodyStateDatabaseError from error


def list_body_state_events(db: Session, user_id: UUID, limit: int) -> list[BodyStateEvent]:
    """복합 인덱스로 생성 시각/UUID 역순의 안정된 목록을 조회합니다."""
    try:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise BodyStateNotFoundError
        return list(db.scalars(select(BodyStateEvent).where(BodyStateEvent.user_id == user_id)
                    .order_by(BodyStateEvent.created_at.desc(), BodyStateEvent.id.desc()).limit(limit)).all())
    except SQLAlchemyError as error:
        raise BodyStateDatabaseError from error
