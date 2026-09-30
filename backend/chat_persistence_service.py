"""기존 NOIE 채팅 흐름에 원본 PostgreSQL 저장을 연결합니다."""

from __future__ import annotations

import os
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select

from chat_storage_schemas import ConversationCreate, MessageCreate, UserCreate
from chat_storage_service import (
    create_conversation,
    create_message,
    create_user,
)
from database import SessionLocal
from models.conversation import Conversation
from models.user import User


@dataclass(frozen=True)
class ChatPersistenceContext:
    """한 채팅 요청에서 사용자/assistant 저장이 공유하는 식별자입니다."""

    user_id: UUID
    conversation_id: UUID


def _configured_uuid(name: str) -> UUID | None:
    """선택적 UUID 환경변수를 읽고 잘못된 값은 저장 실패로 처리합니다."""

    value = os.getenv(name, "").strip()
    return UUID(value) if value else None


def _resolve_context(db) -> ChatPersistenceContext:
    """환경변수 ID를 우선 사용하고 없으면 개발용 활성 데이터를 bootstrap합니다."""

    configured_user_id = _configured_uuid("NOIE_DEV_USER_ID")
    configured_conversation_id = _configured_uuid("NOIE_DEV_CONVERSATION_ID")

    if configured_conversation_id is not None:
        conversation = db.scalar(
            select(Conversation).where(
                Conversation.id == configured_conversation_id,
                Conversation.deleted_at.is_(None),
            )
        )
        if conversation is None:
            raise LookupError("Configured conversation is missing or soft deleted.")
        if configured_user_id is not None and conversation.user_id != configured_user_id:
            raise LookupError("Configured user and conversation do not match.")

        user = db.scalar(
            select(User.id).where(
                User.id == conversation.user_id,
                User.deleted_at.is_(None),
            )
        )
        if user is None:
            raise LookupError("Conversation owner is missing or soft deleted.")
        return ChatPersistenceContext(conversation.user_id, conversation.id)

    user = None
    if configured_user_id is not None:
        user = db.scalar(
            select(User).where(
                User.id == configured_user_id,
                User.deleted_at.is_(None),
            )
        )
        if user is None:
            raise LookupError("Configured user is missing or soft deleted.")
    else:
        development_user_name = os.getenv("NOIE_DEV_USER_NAME", "dev-user").strip()
        if not development_user_name:
            raise ValueError("NOIE_DEV_USER_NAME must not be blank.")
        user = db.scalar(
            select(User)
            .where(
                User.name == development_user_name,
                User.deleted_at.is_(None),
            )
            .order_by(User.created_at.asc(), User.id.asc())
            .limit(1)
        )
        if user is None:
            user = create_user(db, UserCreate(name=development_user_name))

    # ID가 지정되지 않은 개발 단계에서는 해당 사용자의 최신 활성 대화를 재사용합니다.
    conversation = db.scalar(
        select(Conversation)
        .where(
            Conversation.user_id == user.id,
            Conversation.deleted_at.is_(None),
        )
        .order_by(Conversation.created_at.desc(), Conversation.id.desc())
        .limit(1)
    )
    if conversation is None:
        title = os.getenv("NOIE_DEV_CONVERSATION_TITLE", "NOIE 개발 대화")
        conversation = create_conversation(
            db,
            ConversationCreate(user_id=user.id, title=title),
        )

    return ChatPersistenceContext(user.id, conversation.id)


def persist_user_message(content: str) -> ChatPersistenceContext | None:
    """사용자 원문을 OpenAI 호출 전에 독립 transaction으로 저장합니다."""

    if SessionLocal is None:
        print("[noie] chat persistence skipped: DATABASE_URL is not configured")
        return None

    try:
        with SessionLocal() as db:
            context = _resolve_context(db)
            create_message(
                db,
                context.conversation_id,
                MessageCreate(role="user", content=content),
            )
            return context
    except Exception as error:
        # 메시지 원문이나 DB 접속 정보를 로그에 포함하지 않습니다.
        print(f"[noie] user message persistence failed: {type(error).__name__}")
        return None


def persist_assistant_message(
    context: ChatPersistenceContext | None,
    content: str,
    source: str,
) -> None:
    """사용자에게 반환할 최종 답변을 출처와 함께 별도 transaction으로 저장합니다."""

    if context is None or SessionLocal is None:
        return

    try:
        with SessionLocal() as db:
            create_message(
                db,
                context.conversation_id,
                MessageCreate(role="assistant", content=content),
                metadata={"source": source},
            )
    except Exception as error:
        # DB 저장 실패가 이미 생성된 기존 채팅 응답을 막지 않게 합니다.
        print(f"[noie] assistant message persistence failed: {type(error).__name__}")


# TODO: 모바일이 request_id를 보내도록 한 뒤 DB unique constraint 기반의
# idempotency를 추가합니다. 동일 text 비교로는 의도적인 반복 발화를 구분할 수 없습니다.
