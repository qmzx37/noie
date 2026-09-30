"""Swagger에서 수동으로 Memory 구조를 검증하기 위한 최소 API입니다."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from memory_schemas import MemoryCreate, MemoryResponse
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
