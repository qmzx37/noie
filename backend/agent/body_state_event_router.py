"""Body State를 변경하지 않는 소유자 제한 읽기 API입니다."""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from agent.body_state_schemas import BodyStateEventResponse
from agent.body_state_event_service import BodyStateDatabaseError, BodyStateNotFoundError, get_body_state_event, list_body_state_events
from database import get_db

router = APIRouter(tags=["body-state-events"])


@router.get("/body-state-events/{event_id}", response_model=BodyStateEventResponse)
def get_body_state_by_id(event_id: UUID, user_id: UUID = Query(), db: Session = Depends(get_db)):
    """다른 사용자의 기록과 없는 기록 모두 404로 반환합니다."""
    try:
        return get_body_state_event(db, event_id, user_id)
    except BodyStateNotFoundError as error:
        raise HTTPException(status_code=404, detail="Body State 기록을 찾을 수 없습니다.") from error
    except BodyStateDatabaseError as error:
        raise HTTPException(status_code=500, detail="Body State 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/body-state-events", response_model=list[BodyStateEventResponse])
def get_user_body_states(user_id: UUID, limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db)):
    """기본 50개, 최대 100개로 제한합니다."""
    try:
        return list_body_state_events(db, user_id, limit)
    except BodyStateNotFoundError as error:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.") from error
    except BodyStateDatabaseError as error:
        raise HTTPException(status_code=500, detail="Body State 목록 조회에 실패했습니다.") from error
