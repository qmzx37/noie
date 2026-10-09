"""기존 인증 principal만 사용하는 최소 Activity 읽기 API입니다."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth_context import AuthPrincipal
from auth_ownership import require_core_principal
from database import get_db
from agent.activity_schemas import ActivityResponse
from agent.activity_service import read_activities


router = APIRouter(tags=["activities"])


def require_activity_principal(principal: AuthPrincipal | None = Depends(require_core_principal)) -> AuthPrincipal:
    """Auth OFF여도 이 새 private API는 익명 dev-user로 fallback하지 않습니다."""
    if principal is None:
        raise HTTPException(401, "인증이 필요합니다.")
    return principal


@router.get("/activities", response_model=list[ActivityResponse])
def get_activities(limit: int = Query(default=50, ge=1, le=100),
    principal: AuthPrincipal = Depends(require_activity_principal), db: Session = Depends(get_db)):
    """현재 계정의 최근 관찰만 제한해서 반환합니다. user_id 입력은 받지 않습니다."""
    return read_activities(db, principal, limit=limit)


@router.get("/activities/{activity_id}", response_model=ActivityResponse)
def get_activity(activity_id: UUID, principal: AuthPrincipal = Depends(require_activity_principal),
    db: Session = Depends(get_db)):
    """다른 사용자/없는/삭제된 근거는 동일한 404로 처리합니다."""
    return read_activities(db, principal, activity_id=activity_id)
