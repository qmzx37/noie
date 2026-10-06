"""일반 ownership과 분리된 최소 관리자 API입니다. 관리자 provisioning HTTP API는 없습니다."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from auth_context import AuthPrincipal, resolve_auth_principal
from database import get_db
import admin_access_service as service


class SafeAdminRoute(APIRoute):
    """불필요하게 입력 token/자유 reason 등을 validation 응답에 되돌리지 않습니다."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def safe_handler(request):
            try:
                return await handler(request)
            except RequestValidationError:
                return JSONResponse({"detail": "관리자 요청 형식이 올바르지 않습니다."}, status_code=422)
        return safe_handler


def require_admin_identity(principal: AuthPrincipal | None = Depends(resolve_auth_principal)) -> AuthPrincipal:
    """Auth OFF에서도 dev-user fallback은 관리자 신원이 될 수 없습니다."""
    if not isinstance(principal, AuthPrincipal):
        raise HTTPException(401, "인증이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})
    return principal


class BreakGlassCreate(BaseModel):
    """role/free-text reason은 입력 계약에 없습니다."""

    model_config = ConfigDict(extra="forbid")
    target_user_id: UUID
    scope: Literal["memory_read", "conversation_read"]
    reason_code: Literal["user_support_request", "security_incident", "account_recovery", "other"]
    ttl_seconds: int = Field(default=service.DEFAULT_TTL_SECONDS, ge=1, le=service.MAX_TTL_SECONDS, strict=True)
    case_reference: str | None = Field(default=None, pattern=r"^CASE-[0-9]{1,12}$")


router = APIRouter(prefix="/admin", tags=["admin"], route_class=SafeAdminRoute)


@router.get("/users/{user_id}/summary")
def summary(user_id: UUID, principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """지원 관리자는 원문 없이 한 계정의 운영 상태만 봅니다."""
    return service.admin_operation(db, principal, action="admin_summary.read", allowed=service.ROLES,
        target_user_id=user_id, operation=lambda: service.user_summary(db, user_id))


@router.post("/break-glass", status_code=201)
def create_session(data: BreakGlassCreate, principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """특정 대상/scope를 위한 짧은 접근 허가를 발급하고 감사와 함께 commit합니다."""
    return service.admin_operation(db, principal, action="break_glass.create", target_user_id=data.target_user_id,
        reason_code=data.reason_code, case_reference=data.case_reference,
        operation=lambda: service.create_break_glass(db, principal, **data.model_dump()))


@router.get("/users/{user_id}/memories/{memory_id}")
def owner_memory(user_id: UUID, memory_id: UUID,
                 principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """OWNER 전용 직접 읽기입니다. SECURITY_ADMIN은 기존 Break-glass 경로를 사용합니다."""
    return service.admin_operation(db, principal, action="owner.memory.read", allowed=service.OWNER_ROLES,
        target_user_id=user_id, resource_type="memory", resource_id=memory_id,
        operation=lambda: service.read_owner_memory(db, user_id, memory_id))


@router.get("/users/{user_id}/conversations/{conversation_id}")
def owner_conversation(user_id: UUID, conversation_id: UUID,
                       principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """정확한 대상의 대화 정보만 읽고 임의 metadata는 반환하지 않습니다."""
    return service.admin_operation(db, principal, action="owner.conversation.read", allowed=service.OWNER_ROLES,
        target_user_id=user_id, resource_type="conversation", resource_id=conversation_id,
        operation=lambda: service.read_owner_conversation(db, user_id, conversation_id))


@router.get("/users/{user_id}/conversations/{conversation_id}/messages")
def owner_messages(user_id: UUID, conversation_id: UUID,
                   limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
                   principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """OWNER는 비상 허가 없이 원문을 읽지만 감사 commit은 반드시 성공해야 합니다."""
    return service.admin_operation(db, principal, action="owner.conversation.read", allowed=service.OWNER_ROLES,
        target_user_id=user_id, resource_type="conversation", resource_id=conversation_id,
        operation=lambda: service.read_owner_messages(db, user_id, conversation_id, limit, offset))


@router.get("/users/{user_id}/records/{record_type}")
def owner_records(user_id: UUID, record_type: str,
                  limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
                  principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """모델 allowlist의 사용자 기록만 조회하며 arbitrary table/전체 사용자 dump는 지원하지 않습니다."""
    return service.admin_operation(db, principal, action="owner.record.read", allowed=service.OWNER_ROLES,
        target_user_id=user_id, resource_type=record_type if record_type in service.OWNER_RECORDS else None,
        operation=lambda: service.read_owner_records(db, user_id, record_type, limit, offset))


@router.post("/break-glass/{session_id}/revoke")
def revoke_session(session_id: UUID, principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """데이터 변경이 아닌 비상 접근 허가 철회만 제공합니다."""
    return service.admin_operation(db, principal, action="break_glass.revoke", resource_type="break_glass",
        resource_id=session_id, operation=lambda: service.revoke_break_glass(db, principal, session_id))


@router.get("/break-glass/{session_id}/users/{user_id}/memories/{memory_id}")
def memory(session_id: UUID, user_id: UUID, memory_id: UUID,
           principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """감사 저장 실패 시 이미 조회한 민감 payload도 반환하지 않습니다."""
    return service.admin_operation(db, principal, action="memory.break_glass_read", target_user_id=user_id,
        resource_type="memory", resource_id=memory_id,
        operation=lambda: service.read_memory(db, principal, session_id, user_id, memory_id))


@router.get("/break-glass/{session_id}/users/{user_id}/conversations/{conversation_id}/messages")
def messages(session_id: UUID, user_id: UUID, conversation_id: UUID,
             limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
             principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """원문 한 대화를 페이지 단위로 읽으며 전체 사용자 목록은 제공하지 않습니다."""
    return service.admin_operation(db, principal, action="conversation.break_glass_read", target_user_id=user_id,
        resource_type="conversation", resource_id=conversation_id,
        operation=lambda: service.read_messages(db, principal, session_id, user_id, conversation_id, limit, offset))


@router.get("/audit-logs")
def audits(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
           principal: AuthPrincipal = Depends(require_admin_identity), db: Session = Depends(get_db)):
    """조회 자체도 audit하며 수정/삭제 route는 만들지 않습니다."""
    return service.admin_operation(db, principal, action="audit_log.read",
        operation=lambda: service.list_audits(db, limit=limit, offset=offset))
