"""Dream Goal을 변경하지 않는 read-only API입니다."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from agent.dream_goal_event_schemas import DreamGoalResponse
from agent.dream_goal_event_service import DreamGoalDatabaseError, DreamGoalNotFoundError, get_dream_goal, list_dream_goals
from database import get_db
from auth_context import AuthPrincipal
from auth_ownership import require_core_principal, require_matching_user_id

# AUTH ON에서는 client UUID만으로 다른 사용자 기록에 접근할 수 없습니다.
# Principal이 authority이며, path/query UUID는 일치 여부만 확인합니다.

router = APIRouter(tags=["dream-goals"])


@router.get("/dream-goals/{dream_goal_id}", response_model=DreamGoalResponse)
def get_dream_goal_by_id(dream_goal_id: UUID, user_id: UUID = Query(), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    try: return get_dream_goal(db, dream_goal_id, require_matching_user_id(principal, user_id))
    except DreamGoalNotFoundError as error: raise HTTPException(status_code=404, detail="Dream Goal을 찾을 수 없습니다.") from error
    except DreamGoalDatabaseError as error: raise HTTPException(status_code=500, detail="Dream Goal 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/dream-goals", response_model=list[DreamGoalResponse])
def get_user_dream_goals(user_id: UUID, limit: int = Query(default=50, ge=1, le=100), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    try: return list_dream_goals(db, require_matching_user_id(principal, user_id), limit)
    except DreamGoalNotFoundError as error: raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.") from error
    except DreamGoalDatabaseError as error: raise HTTPException(status_code=500, detail="Dream Goal 목록 조회에 실패했습니다.") from error
