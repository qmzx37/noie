"""Place 기록을 변경하지 않는 소유자 제한 읽기 API입니다."""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from auth_context import AuthPrincipal
from auth_ownership import require_core_principal, require_matching_user_id

# AUTH ON에서는 client UUID만으로 다른 사용자 기록에 접근할 수 없습니다.
# Principal이 authority이며, path/query UUID는 일치 여부만 확인합니다.
from agent.place_schemas import PlaceEventResponse
from agent.place_event_service import PlaceEventDatabaseError, PlaceEventNotFoundError, get_place_event, list_place_events

router = APIRouter(tags=["place-events"])


@router.get("/place-events/{place_event_id}", response_model=PlaceEventResponse)
def get_place_event_by_id(place_event_id: UUID, user_id: UUID = Query(), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    """다른 소유자와 없는 기록은 동일한 404로 처리합니다."""
    try:
        return get_place_event(db, place_event_id, require_matching_user_id(principal, user_id))
    except PlaceEventNotFoundError as error:
        raise HTTPException(status_code=404, detail="Place 기록을 찾을 수 없습니다.") from error
    except PlaceEventDatabaseError as error:
        raise HTTPException(status_code=500, detail="Place 기록 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/place-events", response_model=list[PlaceEventResponse])
def get_user_place_events(user_id: UUID, limit: int = Query(default=50, ge=1, le=100), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    """목록은 기본 50개, 최대 100개로 제한합니다."""
    try:
        return list_place_events(db, require_matching_user_id(principal, user_id), limit)
    except PlaceEventNotFoundError as error:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.") from error
    except PlaceEventDatabaseError as error:
        raise HTTPException(status_code=500, detail="Place 목록 조회에 실패했습니다.") from error
