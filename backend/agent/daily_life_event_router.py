"""Daily Life Event를 변경하지 않는 read-only API입니다."""
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException,Query
from sqlalchemy.orm import Session
from agent.daily_life_event_schemas import DailyLifeEventResponse
from agent.daily_life_event_service import DailyLifeEventDatabaseError,DailyLifeEventNotFoundError,get_daily_life_event,list_daily_life_events
from database import get_db
from auth_context import AuthPrincipal
from auth_ownership import require_core_principal, require_matching_user_id

# AUTH ON에서는 client UUID만으로 다른 사용자 기록에 접근할 수 없습니다.
# Principal이 authority이며, path/query UUID는 일치 여부만 확인합니다.

router=APIRouter(tags=["daily-life-events"])

@router.get("/daily-life-events/{daily_life_event_id}",response_model=DailyLifeEventResponse)
def get_daily_life_event_by_id(daily_life_event_id:UUID,user_id:UUID=Query(),principal: AuthPrincipal | None = Depends(require_core_principal),db:Session=Depends(get_db)):
    try:return get_daily_life_event(db,daily_life_event_id,require_matching_user_id(principal, user_id))
    except DailyLifeEventNotFoundError as error:raise HTTPException(status_code=404,detail="Daily Life Event를 찾을 수 없습니다.") from error
    except DailyLifeEventDatabaseError as error:raise HTTPException(status_code=500,detail="Daily Life Event 조회에 실패했습니다.") from error

@router.get("/users/{user_id}/daily-life-events",response_model=list[DailyLifeEventResponse])
def get_user_daily_life_events(user_id:UUID,limit:int=Query(default=50,ge=1,le=100),principal: AuthPrincipal | None = Depends(require_core_principal),db:Session=Depends(get_db)):
    try:return list_daily_life_events(db,require_matching_user_id(principal, user_id),limit)
    except DailyLifeEventNotFoundError as error:raise HTTPException(status_code=404,detail="사용자를 찾을 수 없습니다.") from error
    except DailyLifeEventDatabaseError as error:raise HTTPException(status_code=500,detail="Daily Life Event 목록 조회에 실패했습니다.") from error
