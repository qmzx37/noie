"""PostgreSQL 채팅 저장 API의 요청/응답 타입입니다."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrmResponse(BaseModel):
    """SQLAlchemy 모델을 API 응답으로 변환하기 위한 공통 설정입니다."""

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    """개발용 사용자 생성 요청입니다."""

    name: str = Field(max_length=100)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("name은 공백일 수 없습니다.")
        return value


class UserResponse(OrmResponse):
    id: UUID
    name: str
    created_at: datetime


class ConversationCreate(BaseModel):
    """활성 사용자의 대화방 생성 요청입니다."""

    user_id: UUID
    title: str | None = Field(default=None, max_length=255)


class ConversationResponse(OrmResponse):
    id: UUID
    user_id: UUID
    title: str | None
    created_at: datetime


class MessageCreate(BaseModel):
    """원문을 그대로 저장할 메시지 요청입니다."""

    role: Literal["user", "assistant", "system"]
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        # 공백 여부만 검사하고 원문은 strip하지 않은 채 그대로 반환합니다.
        if not value.strip():
            raise ValueError("content는 공백일 수 없습니다.")
        return value


class MessageResponse(OrmResponse):
    id: UUID
    conversation_id: UUID
    user_id: UUID | None
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: datetime
