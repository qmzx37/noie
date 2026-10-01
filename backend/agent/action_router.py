"""Action persistence와 사용자 승인 상태를 다루는 개발용 API입니다."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from agent.action_schemas import AgentActionResponse, ConfirmationRequest, PersistActionPlanRequest
from agent.action_service import (
    ActionConflictError,
    ActionConfirmationError,
    ActionDatabaseError,
    ActionNotFoundError,
    ActionValidationError,
    confirm_action,
    get_action,
    list_user_actions,
    persist_action_plan,
    reject_action,
)
from database import get_db


router = APIRouter(tags=["agent-actions"])


def _translate(error: Exception) -> HTTPException:
    if isinstance(error, ActionNotFoundError):
        return HTTPException(status_code=404, detail="요청한 action을 찾을 수 없습니다.")
    if isinstance(error, ActionConfirmationError):
        return HTTPException(status_code=403, detail="confirmation 정보가 일치하지 않습니다.")
    if isinstance(error, ActionConflictError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, ActionValidationError):
        return HTTPException(status_code=400, detail=str(error))
    return HTTPException(status_code=500, detail="Action 데이터베이스 작업에 실패했습니다.")


@router.post("/agent/actions/plan", response_model=list[AgentActionResponse], status_code=status.HTTP_201_CREATED)
def post_action_plan(data: PersistActionPlanRequest, db: Session = Depends(get_db)):
    try:
        return persist_action_plan(db, data)
    except (ActionNotFoundError, ActionConflictError, ActionConfirmationError, ActionValidationError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.get("/agent/actions/{action_id}", response_model=AgentActionResponse)
def get_action_by_id(action_id: UUID, user_id: UUID = Query(), db: Session = Depends(get_db)):
    try:
        return get_action(db, action_id, user_id)
    except (ActionNotFoundError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.post("/agent/actions/{action_id}/confirm", response_model=AgentActionResponse)
def post_confirm_action(action_id: UUID, data: ConfirmationRequest, db: Session = Depends(get_db)):
    try:
        return confirm_action(db, action_id, data)
    except (ActionNotFoundError, ActionConflictError, ActionConfirmationError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.post("/agent/actions/{action_id}/reject", response_model=AgentActionResponse)
def post_reject_action(action_id: UUID, data: ConfirmationRequest, db: Session = Depends(get_db)):
    try:
        return reject_action(db, action_id, data)
    except (ActionNotFoundError, ActionConflictError, ActionConfirmationError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.get("/users/{user_id}/agent-actions", response_model=list[AgentActionResponse])
def get_user_agent_actions(user_id: UUID, db: Session = Depends(get_db)):
    try:
        return list_user_actions(db, user_id)
    except (ActionNotFoundError, ActionDatabaseError) as error:
        raise _translate(error) from error
