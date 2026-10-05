"""Action persistence와 사용자 승인 상태를 다루는 개발용 API입니다."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from auth_context import AuthPrincipal
from auth_ownership import require_core_principal, require_matching_user_id

from agent.action_schemas import (
    AgentActionResponse,
    ConfirmationRequest,
    ExecuteActionRequest,
    ExecuteActionResponse,
    PersistActionPlanRequest,
)
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
from agent.executor_service import (
    ExecutorBusyError,
    ExecutorConflictError,
    ExecutorDatabaseError,
    ExecutorNotFoundError,
    can_retry,
    execute_action,
)


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
def post_action_plan(data: PersistActionPlanRequest,
                     principal: AuthPrincipal | None = Depends(require_core_principal),
                     db: Session = Depends(get_db)):
    try:
        # Client UUID는 일치 확인용입니다. 기존 서비스가 대화/메시지의 owner를 함께 검증합니다.
        owner = require_matching_user_id(principal, data.user_id)
        owned_data = data if principal is None else data.model_copy(update={"user_id": owner})
        return persist_action_plan(db, owned_data)
    except (ActionNotFoundError, ActionConflictError, ActionConfirmationError, ActionValidationError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.get("/agent/actions/{action_id}", response_model=AgentActionResponse)
def get_action_by_id(action_id: UUID, user_id: UUID = Query(),
                     principal: AuthPrincipal | None = Depends(require_core_principal),
                     db: Session = Depends(get_db)):
    try:
        # 다른 사용자 action은 기존 SQL 소유권 필터가 동일한 404로 차단합니다.
        return get_action(db, action_id, require_matching_user_id(principal, user_id))
    except (ActionNotFoundError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.post("/agent/actions/{action_id}/confirm", response_model=AgentActionResponse)
def post_confirm_action(action_id: UUID, data: ConfirmationRequest,
                        principal: AuthPrincipal | None = Depends(require_core_principal),
                        db: Session = Depends(get_db)):
    try:
        # 인증된 Principal만 자신의 저장된 Action을 승인할 수 있습니다.
        owner = require_matching_user_id(principal, data.user_id)
        owned_data = data if principal is None else data.model_copy(update={"user_id": owner})
        return confirm_action(db, action_id, owned_data)
    except (ActionNotFoundError, ActionConflictError, ActionConfirmationError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.post("/agent/actions/{action_id}/reject", response_model=AgentActionResponse)
def post_reject_action(action_id: UUID, data: ConfirmationRequest,
                       principal: AuthPrincipal | None = Depends(require_core_principal),
                       db: Session = Depends(get_db)):
    try:
        # confirmation_id를 알아도 다른 사용자 Action에는 상태 변경을 할 수 없습니다.
        owner = require_matching_user_id(principal, data.user_id)
        owned_data = data if principal is None else data.model_copy(update={"user_id": owner})
        return reject_action(db, action_id, owned_data)
    except (ActionNotFoundError, ActionConflictError, ActionConfirmationError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.get("/users/{user_id}/agent-actions", response_model=list[AgentActionResponse])
def get_user_agent_actions(user_id: UUID,
                           principal: AuthPrincipal | None = Depends(require_core_principal),
                           db: Session = Depends(get_db)):
    try:
        # Auth OFF는 기존 path UUID, Auth ON은 Principal UUID로만 목록을 조회합니다.
        return list_user_actions(db, require_matching_user_id(principal, user_id))
    except (ActionNotFoundError, ActionDatabaseError) as error:
        raise _translate(error) from error


@router.post("/agent/actions/{action_id}/execute", response_model=ExecuteActionResponse)
def post_execute_action(action_id: UUID, data: ExecuteActionRequest,
                        principal: AuthPrincipal | None = Depends(require_core_principal)):
    """실제 업무 Tool 없이 등록된 테스트 executor만 공통 계층으로 실행합니다."""

    try:
        # 서버 Principal을 lease 획득 계층에 전달하며 기존 retry/fencing은 변경하지 않습니다.
        outcome = execute_action(action_id, require_matching_user_id(principal, data.user_id))
        return ExecuteActionResponse(
            action=AgentActionResponse.model_validate(outcome.action),
            executor_called=outcome.executor_called,
            fenced=outcome.fenced,
            can_retry=can_retry(outcome.action),
        )
    except ExecutorNotFoundError as error:
        raise HTTPException(status_code=404, detail="요청한 action을 찾을 수 없습니다.") from error
    except ExecutorBusyError as error:
        raise HTTPException(status_code=409, detail="action이 처리 중입니다.") from error
    except ExecutorConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ExecutorDatabaseError as error:
        raise HTTPException(status_code=500, detail="Action 실행 상태 처리에 실패했습니다.") from error
