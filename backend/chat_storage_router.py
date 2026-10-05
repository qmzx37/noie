"""PostgreSQL 원본 채팅 저장 API 라우터입니다."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from auth_context import AuthPrincipal
from auth_ownership import (
    require_core_principal,
    require_dev_user_creation,
    require_matching_user_id,
    require_conversation_owner,
)

from chat_storage_schemas import (
    ConversationCreate,
    ConversationResponse,
    MessageCreate,
    MessageResponse,
    UserCreate,
    UserResponse,
)
from chat_storage_service import (
    StorageDatabaseError,
    StorageNotFoundError,
    create_conversation,
    create_message,
    create_user,
    list_conversation_messages,
    list_user_conversations,
)
from database import get_db


router = APIRouter(tags=["chat-storage"])


def _not_found() -> HTTPException:
    # 삭제된 자원의 존재 여부도 노출하지 않기 위해 410 대신 404를 사용합니다.
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="요청한 활성 리소스를 찾을 수 없습니다.",
    )


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="데이터베이스 작업 중 오류가 발생했습니다.",
    )


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def post_user(data: UserCreate,
              _dev_only: None = Depends(require_dev_user_creation),
              db: Session = Depends(get_db)) -> UserResponse:
    # ON 차단은 세션을 열기 전 dependency에서 수행하고 OFF의 생성 로직은 그대로 둡니다.
    try:
        return create_user(db, data)
    except StorageDatabaseError as error:
        raise _database_error() from error


@router.post(
    "/conversations",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_conversation(
    data: ConversationCreate,
    principal: AuthPrincipal | None = Depends(require_core_principal),
    db: Session = Depends(get_db),
) -> ConversationResponse:
    try:
        # body 계약은 유지하되 실제 owner는 검증된 Principal에서 가져옵니다.
        owner = require_matching_user_id(principal, data.user_id)
        owned_data = data if principal is None else data.model_copy(update={"user_id": owner})
        return create_conversation(db, owned_data)
    except StorageNotFoundError as error:
        raise _not_found() from error
    except StorageDatabaseError as error:
        raise _database_error() from error


@router.get(
    "/users/{user_id}/conversations",
    response_model=list[ConversationResponse],
)
def get_user_conversations(
    user_id: UUID,
    principal: AuthPrincipal | None = Depends(require_core_principal),
    db: Session = Depends(get_db),
) -> list[ConversationResponse]:
    try:
        return list_user_conversations(db, require_matching_user_id(principal, user_id))
    except StorageNotFoundError as error:
        raise _not_found() from error
    except StorageDatabaseError as error:
        raise _database_error() from error


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_message(
    conversation_id: UUID,
    data: MessageCreate,
    principal: AuthPrincipal | None = Depends(require_core_principal),
    db: Session = Depends(get_db),
) -> MessageResponse:
    try:
        # role 정책과 원문 저장은 기존 서비스에 맡기고 대화 소유권만 먼저 확인합니다.
        require_conversation_owner(db, principal, conversation_id)
        return create_message(db, conversation_id, data)
    except StorageNotFoundError as error:
        raise _not_found() from error
    except StorageDatabaseError as error:
        raise _database_error() from error


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageResponse],
)
def get_conversation_messages(
    conversation_id: UUID,
    principal: AuthPrincipal | None = Depends(require_core_principal),
    db: Session = Depends(get_db),
) -> list[MessageResponse]:
    try:
        # 조회 전에 다른 사용자 대화를 안전한 404로 차단합니다.
        require_conversation_owner(db, principal, conversation_id)
        return list_conversation_messages(db, conversation_id)
    except StorageNotFoundError as error:
        raise _not_found() from error
    except StorageDatabaseError as error:
        raise _database_error() from error
