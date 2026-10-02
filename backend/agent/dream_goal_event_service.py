"""사용자 소유권을 적용한 Dream Goal 조회 서비스입니다."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.dream_goal import DreamGoal
from models.user import User


class DreamGoalNotFoundError(Exception): pass
class DreamGoalDatabaseError(Exception): pass


def get_dream_goal(db: Session, dream_goal_id: UUID, user_id: UUID) -> DreamGoal:
    try:
        item = db.scalar(select(DreamGoal).where(DreamGoal.id == dream_goal_id, DreamGoal.user_id == user_id))
        if item is None: raise DreamGoalNotFoundError
        return item
    except DreamGoalNotFoundError: raise
    except SQLAlchemyError as error: raise DreamGoalDatabaseError from error


def list_dream_goals(db: Session, user_id: UUID, limit: int) -> list[DreamGoal]:
    try:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise DreamGoalNotFoundError
        return list(db.scalars(select(DreamGoal).where(DreamGoal.user_id == user_id).order_by(DreamGoal.created_at.desc(), DreamGoal.id.desc()).limit(limit)).all())
    except DreamGoalNotFoundError: raise
    except SQLAlchemyError as error: raise DreamGoalDatabaseError from error
