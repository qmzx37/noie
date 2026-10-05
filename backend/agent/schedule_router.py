"""내부 일정의 읽기 전용 API입니다. 생성은 confirm/execute 흐름을 사용합니다."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from agent.schedule_schemas import ScheduleResponse
from agent.schedule_service import ScheduleDatabaseError, ScheduleNotFoundError, get_schedule, list_schedules
from database import get_db
from auth_context import AuthPrincipal
from auth_ownership import require_core_principal, require_matching_user_id

# AUTH ON에서는 client UUID만으로 다른 사용자 기록에 접근할 수 없습니다.
# Principal이 authority이며, path/query UUID는 일치 여부만 확인합니다.

router = APIRouter(tags=["schedules"])


@router.get("/schedules/{schedule_id}", response_model=ScheduleResponse)
def get_schedule_by_id(schedule_id: UUID, user_id: UUID = Query(), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    """user_id로 소유권을 확인한 뒤 일정 상세를 반환합니다."""
    try:
        return get_schedule(db, schedule_id, require_matching_user_id(principal, user_id))
    except ScheduleNotFoundError as error:
        raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.") from error
    except ScheduleDatabaseError as error:
        raise HTTPException(status_code=500, detail="일정 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/schedules", response_model=list[ScheduleResponse])
def get_user_schedules(user_id: UUID, limit: int = Query(default=50, ge=1, le=100), principal: AuthPrincipal | None = Depends(require_core_principal), db: Session = Depends(get_db)):
    """사용자별 일정을 제한된 개수로 반환합니다."""
    try:
        return list_schedules(db, require_matching_user_id(principal, user_id), limit)
    except ScheduleNotFoundError as error:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.") from error
    except ScheduleDatabaseError as error:
        raise HTTPException(status_code=500, detail="일정 목록 조회에 실패했습니다.") from error
