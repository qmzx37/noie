"""소유권과 활성 사용자 정책을 적용한 Cognitive State 읽기 서비스입니다."""

from uuid import UUID
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from models.cognitive_state_event import CognitiveStateEvent
from models.user import User


class CognitiveStateNotFoundError(Exception):
    """없는 기록과 다른 사용자의 기록을 동일하게 처리합니다."""


class CognitiveStateDatabaseError(Exception):
    """외부 응답에 DB 내부 정보를 숨기기 위한 오류입니다."""


def get_cognitive_state_event(db: Session, event_id: UUID, user_id: UUID) -> CognitiveStateEvent:
    """상세 조회에서 활성 소유자까지 함께 검증합니다."""
    try:
        item = db.scalar(select(CognitiveStateEvent).join(User).where(
            CognitiveStateEvent.id == event_id, CognitiveStateEvent.user_id == user_id, User.deleted_at.is_(None),
        ))
        if item is None:
            raise CognitiveStateNotFoundError
        return item
    except SQLAlchemyError as error:
        raise CognitiveStateDatabaseError from error


def list_cognitive_state_events(db: Session, user_id: UUID, limit: int) -> list[CognitiveStateEvent]:
    """복합 인덱스로 생성 시각/UUID 역순의 안정된 목록을 조회합니다."""
    try:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise CognitiveStateNotFoundError
        return list(db.scalars(select(CognitiveStateEvent).where(CognitiveStateEvent.user_id == user_id)
                    .order_by(CognitiveStateEvent.created_at.desc(), CognitiveStateEvent.id.desc()).limit(limit)).all())
    except SQLAlchemyError as error:
        raise CognitiveStateDatabaseError from error
