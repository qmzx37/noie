"""추천 이력의 읽기 전용 소유권 검증 서비스입니다."""

from uuid import UUID
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from models.recommendation import Recommendation
from models.user import User


class RecommendationNotFoundError(Exception):
    """다른 사용자와 없는 이력을 같은 오류로 처리합니다."""


class RecommendationDatabaseError(Exception):
    """DB 내부 정보가 외부에 노출되지 않게 합니다."""


def get_recommendation(db: Session, event_id: UUID, user_id: UUID) -> Recommendation:
    """활성 소유자의 추천만 반환합니다. user_id 필터는 아직 인증이 아닙니다."""
    try:
        item = db.scalar(select(Recommendation).join(User).where(
            Recommendation.id == event_id, Recommendation.user_id == user_id, User.deleted_at.is_(None),
        ))
        if item is None:
            raise RecommendationNotFoundError
        return item
    except SQLAlchemyError as error:
        raise RecommendationDatabaseError from error


def list_recommendations(db: Session, user_id: UUID, limit: int) -> list[Recommendation]:
    """인덱스와 일치하는 최신 시각/UUID 역순으로 제한된 목록을 반환합니다."""
    try:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise RecommendationNotFoundError
        return list(db.scalars(select(Recommendation).where(Recommendation.user_id == user_id)
                              .order_by(Recommendation.created_at.desc(), Recommendation.id.desc()).limit(limit)).all())
    except SQLAlchemyError as error:
        raise RecommendationDatabaseError from error
