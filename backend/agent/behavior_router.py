"""기존 Agent router에 연결하는 소유자 전용 Behavior 조회 API입니다."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth_context import AuthPrincipal
from auth_ownership import require_core_principal
from database import get_db
from agent.behavior_schemas import BehaviorAnalysis
from agent.behavior_service import analyze_owned_behavior


router = APIRouter(tags=["behavior"])


def require_behavior_principal(
    principal: AuthPrincipal | None = Depends(require_core_principal),
) -> AuthPrincipal:
    """익명 요청은 DB dependency를 실행하기 전에 거부합니다."""
    if principal is None:
        raise HTTPException(401, "인증이 필요합니다.")
    return principal


@router.get("/messages/{message_id}/behavior", response_model=BehaviorAnalysis)
def get_behavior(
    message_id: UUID,
    principal: AuthPrincipal = Depends(require_behavior_principal),
    db: Session = Depends(get_db),
) -> BehaviorAnalysis:
    """읽기만 수행합니다. Auth OFF에서도 새 API는 익명 dev-user로 fallback하지 않습니다."""
    return analyze_owned_behavior(db, message_id, principal)
