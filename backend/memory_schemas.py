"""수동 Memory 생성과 조회 API의 입력·출력 타입입니다."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


MemoryKind = Literal[
    "goal",
    "preference",
    "project",
    "experience",
    "person",
    "place",
    "routine",
    "decision",
    "other",
]


class MemoryCreate(BaseModel):
    """Swagger에서 원문 evidence를 지정해 기억을 생성하는 요청입니다."""

    user_id: UUID
    content: str
    kind: str = Field(max_length=50)
    importance: int | None = Field(default=None, ge=0, le=100)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    evidence_message_ids: list[UUID] = Field(min_length=1)

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        # 공백 여부만 검사하고 해석된 기억 문장은 입력 그대로 저장합니다.
        if not value.strip():
            raise ValueError("content는 공백일 수 없습니다.")
        return value

    @field_validator("kind")
    @classmethod
    def validate_kind(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("kind는 공백일 수 없습니다.")
        return normalized

    @field_validator("evidence_message_ids")
    @classmethod
    def validate_unique_evidence(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("같은 evidence_message_id를 중복 입력할 수 없습니다.")
        return value


class EvidenceMessageResponse(BaseModel):
    """기억에서 원문까지 추적할 때 필요한 최소 메시지 정보입니다."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    user_id: UUID | None
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: datetime


class MemoryEvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    created_at: datetime
    message: EvidenceMessageResponse


class MemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    supersedes_memory_id: UUID | None
    content: str
    kind: str
    importance: int | None
    confidence: float | None
    status: Literal["active", "superseded", "invalid"]
    created_at: datetime
    updated_at: datetime
    evidence: list[MemoryEvidenceResponse]


class MemoryExtractionDecision(BaseModel):
    """OpenAI structured output을 저장 전에 다시 검증하는 타입입니다."""

    should_remember: bool
    reason: str = Field(min_length=1)
    content: str
    kind: MemoryKind
    importance: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0.0, le=1.0)


class MemoryExtractionRequest(BaseModel):
    """인증 전 개발 단계에서 message 소유자를 명시하는 요청입니다."""

    user_id: UUID


class MemoryExtractionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    memory_id: UUID | None
    extractor_version: str
    status: Literal["processing", "completed", "failed"]
    should_remember: bool | None
    reason: str | None
    reconciliation_action: Literal["new", "reinforce", "supersede"] | None
    matched_memory_id: UUID | None
    reconciliation_reason: str | None
    reconciler_version: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class MemoryReconciliationDecision(BaseModel):
    """OpenAI의 조정 판단을 service 계층에서 다시 검증하기 위한 타입입니다."""

    action: Literal["new", "reinforce", "supersede"]
    matched_memory_id: UUID | None
    reason: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
