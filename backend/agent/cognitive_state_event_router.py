"""Cognitive State를 변경하지 않는 소유자 제한 읽기 API입니다."""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from agent.cognitive_state_schemas import CognitiveStateEventResponse
from agent.cognitive_state_event_service import CognitiveStateDatabaseError, CognitiveStateNotFoundError, get_cognitive_state_event, list_cognitive_state_events
from database import get_db
from auth_context import AuthPrincipal
from auth_ownership import require_core_principal, require_matching_user_id

# AUTH ON에서는 client UUID만으로 다른 사용자 기록에 접근할 수 없습니다.
# Principal이 authority이며, path/query UUID는 일치 여부만 확인합니다.

router = APIRouter(tags=["cognitive-state-events"])


@router.get("/cognitive-state-events/{event_id}", response_model=CognitiveStateEventResponse)
def get_cognitive_state_by_id(event_id: UUID, user_id: UUID = Query(), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    """다른 사용자의 기록과 없는 기록 모두 404로 반환합니다."""
    try:
        return get_cognitive_state_event(db, event_id, require_matching_user_id(principal, user_id))
    except CognitiveStateNotFoundError as error:
        raise HTTPException(status_code=404, detail="Cognitive State 기록을 찾을 수 없습니다.") from error
    except CognitiveStateDatabaseError as error:
        raise HTTPException(status_code=500, detail="Cognitive State 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/cognitive-state-events", response_model=list[CognitiveStateEventResponse])
def get_user_cognitive_states(user_id: UUID, limit: int = Query(default=50, ge=1, le=100), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    """기본 50개, 최대 100개로 제한합니다."""
    try:
        return list_cognitive_state_events(db, require_matching_user_id(principal, user_id), limit)
    except CognitiveStateNotFoundError as error:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.") from error
    except CognitiveStateDatabaseError as error:
        raise HTTPException(status_code=500, detail="Cognitive State 목록 조회에 실패했습니다.") from error
