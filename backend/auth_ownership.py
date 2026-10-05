"""직접 Core Data API의 인증/소유권 경계입니다. 개발 모드와 업무 로직은 분리합니다."""

from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth_context import AuthPrincipal, auth_enabled, resolve_auth_principal
from models.conversation import Conversation
from models.memory import Memory
from models.user import User


def require_core_principal(
    principal: AuthPrincipal | None = Depends(resolve_auth_principal),
) -> AuthPrincipal | None:
    """ON에서는 잘못된 dependency의 None도 개발 경로로 내려가지 못하게 합니다."""
    if principal is None and auth_enabled():
        raise HTTPException(401, "인증이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})
    return principal


def require_matching_user_id(principal: AuthPrincipal | None, supplied_user_id: UUID) -> UUID:
    """client UUID는 일치 확인용일 뿐이며 실제 authority는 서버 Principal입니다."""
    if principal is None:
        return supplied_user_id
    if supplied_user_id != principal.user_id:
        raise HTTPException(403, "요청한 사용자로 접근할 수 없습니다.")
    return principal.user_id


def require_dev_user_creation(
    principal: AuthPrincipal | None = Depends(require_core_principal),
) -> None:
    """DB 세션 dependency를 열기 전에 개발용 사용자 생성 API를 404로 닫습니다."""
    if principal is not None:
        raise HTTPException(404, "요청한 활성 리소스를 찾을 수 없습니다.")


def _require_resource_owner(db: Session, principal: AuthPrincipal | None, model, resource_id: UUID):
    """소유자 조건을 SQL에 넣어 다른 사용자 자원의 존재/내용을 읽어 반환하지 않습니다."""
    if principal is None:
        return
    try:
        found = db.scalar(select(model.id).join(User, model.user_id == User.id).where(
            model.id == resource_id, model.user_id == principal.user_id,
            model.deleted_at.is_(None), User.deleted_at.is_(None),
        ))
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500, "데이터베이스 작업 중 오류가 발생했습니다.") from None
    if found is None:
        raise HTTPException(404, "요청한 활성 리소스를 찾을 수 없습니다.")


def require_conversation_owner(db: Session, principal: AuthPrincipal | None, conversation_id: UUID):
    """assistant/system의 user_id가 NULL이어도 대화 소유자로 메시지 접근을 검증합니다."""
    _require_resource_owner(db, principal, Conversation, conversation_id)


def require_memory_owner(db: Session, principal: AuthPrincipal | None, memory_id: UUID):
    """Memory와 그 evidence를 읽기 전에 소유권을 확인합니다."""
    _require_resource_owner(db, principal, Memory, memory_id)
