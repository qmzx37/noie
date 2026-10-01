"""Swagger에서 수동으로 Memory 구조를 검증하기 위한 최소 API입니다."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_db
from memory_extraction_service import (
    MemoryExtractionAccessError,
    MemoryExtractionDatabaseError,
    MemoryExtractionNotFoundError,
    MemoryExtractionRoleError,
    extract_memory_for_message,
    get_memory_extraction,
)
from memory_schemas import (
    MemoryCreate,
    MemoryExtractionRequest,
    MemoryExtractionResponse,
    MemoryRetrievalPreviewRequest,
    MemoryRetrievalPreviewResponse,
    MemoryResponse,
)
from memory_retriever import retrieve_relevant_memories
from memory_service import (
    MemoryDatabaseError,
    MemoryEvidenceValidationError,
    MemoryNotFoundError,
    create_memory,
    get_memory,
    list_user_memories,
)


router = APIRouter(tags=["memories"])


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="요청한 활성 리소스 또는 evidence를 찾을 수 없습니다.",
    )


def _invalid_evidence(error: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=str(error),
    )


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="데이터베이스 작업 중 오류가 발생했습니다.",
    )


@router.post(
    "/memories",
    response_model=MemoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_memory(data: MemoryCreate, db: Session = Depends(get_db)) -> MemoryResponse:
    try:
        return create_memory(db, data)
    except MemoryNotFoundError as error:
        raise _not_found() from error
    except MemoryEvidenceValidationError as error:
        raise _invalid_evidence(error) from error
    except MemoryDatabaseError as error:
        raise _database_error() from error


@router.get("/users/{user_id}/memories", response_model=list[MemoryResponse])
def get_user_memories(
    user_id: UUID,
    db: Session = Depends(get_db),
) -> list[MemoryResponse]:
    try:
        return list_user_memories(db, user_id)
    except MemoryNotFoundError as error:
        raise _not_found() from error
    except MemoryDatabaseError as error:
        raise _database_error() from error


@router.get("/memories/{memory_id}", response_model=MemoryResponse)
def get_memory_by_id(
    memory_id: UUID,
    db: Session = Depends(get_db),
) -> MemoryResponse:
    try:
        return get_memory(db, memory_id)
    except MemoryNotFoundError as error:
        raise _not_found() from error
    except MemoryDatabaseError as error:
        raise _database_error() from error


def _raise_extraction_error(error: Exception) -> None:
    """추출 API의 내부 예외를 안정적인 HTTP 상태로 변환합니다."""

    if isinstance(error, MemoryExtractionNotFoundError):
        raise _not_found() from error
    if isinstance(error, MemoryExtractionAccessError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="다른 사용자의 message에는 접근할 수 없습니다.",
        ) from error
    if isinstance(error, MemoryExtractionRoleError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user message만 자동 Memory 추출 대상으로 사용할 수 있습니다.",
        ) from error
    raise _database_error() from error


@router.post(
    "/messages/{message_id}/extract-memory",
    response_model=MemoryExtractionResponse,
)
def post_extract_memory(
    message_id: UUID,
    data: MemoryExtractionRequest,
) -> MemoryExtractionResponse:
    try:
        return extract_memory_for_message(message_id, data.user_id)
    except (
        MemoryExtractionNotFoundError,
        MemoryExtractionAccessError,
        MemoryExtractionRoleError,
        MemoryExtractionDatabaseError,
    ) as error:
        _raise_extraction_error(error)


@router.get(
    "/messages/{message_id}/memory-extraction",
    response_model=MemoryExtractionResponse,
)
def get_message_memory_extraction(
    message_id: UUID,
    user_id: UUID = Query(),
) -> MemoryExtractionResponse:
    try:
        return get_memory_extraction(message_id, user_id)
    except (
        MemoryExtractionNotFoundError,
        MemoryExtractionAccessError,
        MemoryExtractionRoleError,
        MemoryExtractionDatabaseError,
    ) as error:
        _raise_extraction_error(error)


@router.post(
    "/memory-retrieval/preview",
    response_model=MemoryRetrievalPreviewResponse,
)
def post_memory_retrieval_preview(
    data: MemoryRetrievalPreviewRequest,
) -> MemoryRetrievalPreviewResponse:
    """후보와 최종 선택을 개발자가 Swagger에서 함께 확인합니다."""

    try:
        candidates, selected = retrieve_relevant_memories(data.user_id, data.query)
        return MemoryRetrievalPreviewResponse(
            candidates=candidates,
            selected_memories=selected,
        )
    except Exception as error:
        # Preview도 내부 오류를 노출하지 않고 fallback 여부만 명시합니다.
        print(f"[noie] memory retrieval preview failed: {type(error).__name__}")
        return MemoryRetrievalPreviewResponse(
            candidates=[],
            selected_memories=[],
            fallback_used=True,
        )
