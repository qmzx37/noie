"""사용자 소유권을 적용한 Daily Life Event 조회 서비스입니다."""
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from models.daily_life_event import DailyLifeEvent
from models.user import User


class DailyLifeEventNotFoundError(Exception): pass
class DailyLifeEventDatabaseError(Exception): pass


def get_daily_life_event(db: Session, event_id: UUID, user_id: UUID) -> DailyLifeEvent:
    try:
        event=db.scalar(select(DailyLifeEvent).where(DailyLifeEvent.id==event_id,DailyLifeEvent.user_id==user_id))
        if event is None: raise DailyLifeEventNotFoundError
        return event
    except DailyLifeEventNotFoundError: raise
    except SQLAlchemyError as error: raise DailyLifeEventDatabaseError from error


def list_daily_life_events(db: Session, user_id: UUID, limit: int) -> list[DailyLifeEvent]:
    try:
        if db.scalar(select(User.id).where(User.id==user_id,User.deleted_at.is_(None))) is None:
            raise DailyLifeEventNotFoundError
        return list(db.scalars(select(DailyLifeEvent).where(DailyLifeEvent.user_id==user_id).order_by(DailyLifeEvent.created_at.desc(),DailyLifeEvent.id.desc()).limit(limit)).all())
    except DailyLifeEventNotFoundError: raise
    except SQLAlchemyError as error: raise DailyLifeEventDatabaseError from error
