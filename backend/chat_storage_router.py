"""PostgreSQL 원본 채팅 저장 API 라우터입니다."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

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
def post_user(data: UserCreate, db: Session = Depends(get_db)) -> UserResponse:
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
    db: Session = Depends(get_db),
) -> ConversationResponse:
    try:
        return create_conversation(db, data)
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
    db: Session = Depends(get_db),
) -> list[ConversationResponse]:
    try:
        return list_user_conversations(db, user_id)
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
    db: Session = Depends(get_db),
) -> MessageResponse:
    try:
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
    db: Session = Depends(get_db),
) -> list[MessageResponse]:
    try:
        return list_conversation_messages(db, conversation_id)
    except StorageNotFoundError as error:
        raise _not_found() from error
    except StorageDatabaseError as error:
        raise _database_error() from error
