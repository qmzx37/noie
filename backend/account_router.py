"""검증된 자기 계정만 대상으로 하는 lifecycle API입니다."""

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from auth_context import AuthPrincipal, resolve_auth_principal
from database import get_db
from models.user import User
from account_lifecycle_service import AccountLifecycleError, deactivate_account, run_account_purge


class SafeAccountRoute(APIRoute):
    """validation에 confirmation/token 등 입력 원문을 되돌리지 않습니다."""

    def get_route_handler(self):
        handler = super().get_route_handler()
        async def safe_handler(request):
            try:
                return await handler(request)
            except RequestValidationError:
                return JSONResponse({"detail": "계정 요청 형식이 올바르지 않습니다."}, status_code=422)
        return safe_handler


def require_account_principal(principal=Depends(resolve_auth_principal)):
    """Auth OFF여도 dev-user를 삭제 대상으로 사용하지 않습니다."""
    if not isinstance(principal, AuthPrincipal):
        raise HTTPException(401, "인증이 필요합니다.")
    return principal


class DeleteAccountRequest(BaseModel):
    """삭제 대상 ID를 받지 않고 정확한 사용자 확인만 받습니다."""

    model_config = ConfigDict(extra="forbid")
    confirmation: Literal["DELETE_MY_NOIE_ACCOUNT"]


router = APIRouter(tags=["account"], route_class=SafeAccountRoute)


@router.get("/account")
def account_identity(principal=Depends(require_account_principal), db: Session = Depends(get_db)):
    """local 계정 incarnation으로 기기의 재가입 데이터를 이전 계정과 구분합니다."""
    user_id = db.scalar(select(User.id).where(User.id == principal.user_id, User.deleted_at.is_(None)))
    if user_id is None:
        raise HTTPException(403, "계정을 사용할 수 없습니다.")
    return {"user_id": user_id}


@router.post("/account/delete", status_code=202)
def delete_account(data: DeleteAccountRequest, background_tasks: BackgroundTasks, request: Request,
                   principal=Depends(require_account_principal), db: Session = Depends(get_db)):
    """응답은 비활성화 요청 접수일 뿐 provider/기기/백업 완전 삭제를 의미하지 않습니다."""
    if request.query_params:
        raise HTTPException(400, "계정 요청 형식이 올바르지 않습니다.")
    try:
        deactivate_account(db, principal)
    except AccountLifecycleError as error:
        if error.code == "LAST_OWNER":
            raise HTTPException(409, "다른 OWNER 지정 후 계정을 삭제할 수 있습니다.") from None
        raise HTTPException(503, "계정 삭제 요청을 안전하게 처리할 수 없습니다.") from None
    background_tasks.add_task(run_account_purge, principal.user_id)
    return {"status": "deletion_requested"}
