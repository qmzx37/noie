"""사용자 소유권과 활성 사용자 정책을 적용한 Place 읽기 서비스입니다."""

from uuid import UUID
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from models.place_event import PlaceEvent
from models.user import User


class PlaceEventNotFoundError(Exception):
    """존재하지 않거나 다른 사용자의 기록입니다."""


class PlaceEventDatabaseError(Exception):
    """외부 응답에서 DB 내부 내용을 숨기기 위한 오류입니다."""


def get_place_event(db: Session, place_event_id: UUID, user_id: UUID) -> PlaceEvent:
    """식별자뿐 아니라 활성 소유자도 확인합니다."""
    try:
        item = db.scalar(select(PlaceEvent).join(User).where(
            PlaceEvent.id == place_event_id, PlaceEvent.user_id == user_id, User.deleted_at.is_(None),
        ))
        if item is None:
            raise PlaceEventNotFoundError
        return item
    except SQLAlchemyError as error:
        raise PlaceEventDatabaseError from error


def list_place_events(db: Session, user_id: UUID, limit: int) -> list[PlaceEvent]:
    """복합 인덱스로 생성 시각과 UUID 역순의 안정된 목록을 반환합니다."""
    try:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise PlaceEventNotFoundError
        return list(db.scalars(select(PlaceEvent).where(PlaceEvent.user_id == user_id)
                    .order_by(PlaceEvent.created_at.desc(), PlaceEvent.id.desc()).limit(limit)).all())
    except SQLAlchemyError as error:
        raise PlaceEventDatabaseError from error
