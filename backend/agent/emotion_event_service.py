"""사용자 소유권을 적용한 Emotion Event 읽기 전용 조회입니다."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.emotion_event import EmotionEvent
from models.user import User


class EmotionEventNotFoundError(Exception):
    """다른 사용자 데이터의 존재 여부도 노출하지 않는 조회 실패입니다."""


class EmotionEventDatabaseError(Exception):
    """내부 DB 오류를 API 응답과 분리합니다."""


def get_emotion_event(db: Session, event_id: UUID, user_id: UUID) -> EmotionEvent:
    try:
        event = db.scalar(
            select(EmotionEvent).where(
                EmotionEvent.id == event_id,
                EmotionEvent.user_id == user_id,
            )
        )
        if event is None:
            raise EmotionEventNotFoundError
        return event
    except EmotionEventNotFoundError:
        raise
    except SQLAlchemyError as error:
        raise EmotionEventDatabaseError from error


def list_emotion_events(db: Session, user_id: UUID, limit: int) -> list[EmotionEvent]:
    try:
        active_user = db.scalar(
            select(User.id).where(User.id == user_id, User.deleted_at.is_(None))
        )
        if active_user is None:
            raise EmotionEventNotFoundError
        return list(
            db.scalars(
                select(EmotionEvent)
                .where(EmotionEvent.user_id == user_id)
                .order_by(EmotionEvent.created_at.desc(), EmotionEvent.id.desc())
                .limit(limit)
            ).all()
        )
    except EmotionEventNotFoundError:
        raise
    except SQLAlchemyError as error:
        raise EmotionEventDatabaseError from error
