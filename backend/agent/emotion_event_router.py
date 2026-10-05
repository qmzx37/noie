"""Emotion Event를 변경하지 않고 조회하는 개발 단계 API입니다."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from agent.emotion_event_schemas import EmotionEventResponse
from agent.emotion_event_service import (
    EmotionEventDatabaseError,
    EmotionEventNotFoundError,
    get_emotion_event,
    list_emotion_events,
)
from database import get_db
from auth_context import AuthPrincipal
from auth_ownership import require_core_principal, require_matching_user_id

# AUTH ON에서는 client UUID만으로 다른 사용자 기록에 접근할 수 없습니다.
# Principal이 authority이며, path/query UUID는 일치 여부만 확인합니다.


router = APIRouter(tags=["emotion-events"])


@router.get("/emotion-events/{emotion_event_id}", response_model=EmotionEventResponse)
def get_emotion_event_by_id(
    emotion_event_id: UUID,
    user_id: UUID = Query(),
    principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db),
):
    try:
        return get_emotion_event(db, emotion_event_id, require_matching_user_id(principal, user_id))
    except EmotionEventNotFoundError as error:
        raise HTTPException(status_code=404, detail="Emotion Event를 찾을 수 없습니다.") from error
    except EmotionEventDatabaseError as error:
        raise HTTPException(status_code=500, detail="Emotion Event 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/emotion-events", response_model=list[EmotionEventResponse])
def get_user_emotion_events(
    user_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db),
):
    try:
        return list_emotion_events(db, require_matching_user_id(principal, user_id), limit)
    except EmotionEventNotFoundError as error:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.") from error
    except EmotionEventDatabaseError as error:
        raise HTTPException(status_code=500, detail="Emotion Event 목록 조회에 실패했습니다.") from error
