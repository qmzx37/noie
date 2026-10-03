"""활성 사용자와 대화 소유권을 적용한 일정 조회 서비스입니다."""

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.conversation import Conversation
from models.schedule import Schedule
from models.user import User


class ScheduleNotFoundError(Exception):
    """다른 사용자 일정도 존재하지 않는 일정과 동일하게 응답합니다."""


class ScheduleDatabaseError(Exception):
    """내부 DB 오류 정보를 응답에서 숨깁니다."""


def _visible_schedules(user_id: UUID):
    """삭제된 사용자/대화의 일정은 기본 읽기 API에서 제외합니다."""
    return (
        select(Schedule).join(User, Schedule.user_id == User.id)
        .outerjoin(Conversation, Schedule.conversation_id == Conversation.id)
        .where(Schedule.user_id == user_id, User.deleted_at.is_(None),
               or_(Schedule.conversation_id.is_(None), Conversation.deleted_at.is_(None)))
    )


def get_schedule(db: Session, schedule_id: UUID, user_id: UUID) -> Schedule:
    """요청한 사용자의 일정 한 개를 조회합니다."""
    try:
        item = db.scalar(_visible_schedules(user_id).where(Schedule.id == schedule_id))
        if item is None:
            raise ScheduleNotFoundError
        return item
    except SQLAlchemyError as error:
        raise ScheduleDatabaseError from error


def list_schedules(db: Session, user_id: UUID, limit: int) -> list[Schedule]:
    """시작 시각과 UUID 순서로 일정 목록을 반환합니다."""
    try:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise ScheduleNotFoundError
        return list(db.scalars(_visible_schedules(user_id).order_by(Schedule.start_at, Schedule.id).limit(limit)).all())
    except SQLAlchemyError as error:
        raise ScheduleDatabaseError from error
