"""기존 NOIE 채팅 흐름에 원본 PostgreSQL 저장을 연결합니다."""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from chat_storage_schemas import ConversationCreate, MessageCreate, UserCreate
from chat_storage_service import (
    create_conversation,
    create_message,
    create_user,
)
from database import SessionLocal
from models.chat_request import ChatRequestRecord
from models.conversation import Conversation
from models.message import Message
from models.user import User


@dataclass(frozen=True)
class ChatPersistenceContext:
    """한 채팅 요청에서 사용자/assistant 저장이 공유하는 식별자입니다."""

    user_id: UUID | None
    conversation_id: UUID
    request_id: UUID | None = None
    user_message_id: UUID | None = None


@dataclass(frozen=True)
class ChatPersistenceStart:
    """새 요청의 저장 문맥 또는 중복 요청의 기존 응답을 전달합니다."""

    context: ChatPersistenceContext | None
    cached_response: dict[str, Any] | None = None


class RequestIdConflictError(Exception):
    """같은 request_id가 서로 다른 요청에 재사용됐을 때 발생합니다."""


class RequestStillProcessingError(Exception):
    """동일 요청이 다른 서버 작업에서 아직 처리 중일 때 발생합니다."""


_DUPLICATE_WAIT_SECONDS = 60.0
_DUPLICATE_POLL_SECONDS = 0.2


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


def _request_hash(content: str) -> str:
    """텍스트 중복 판정이 아니라 request_id 오사용 감지용 해시를 만듭니다."""

    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _wait_for_existing_request(
    request_id: UUID,
    request_hash: str,
) -> ChatPersistenceStart:
    """동시에 들어온 동일 요청이 끝날 때까지 짧게 기다린 뒤 결과를 재사용합니다."""

    deadline = time.monotonic() + _DUPLICATE_WAIT_SECONDS
    while time.monotonic() < deadline:
        with SessionLocal() as db:
            record = db.get(ChatRequestRecord, request_id)
            if record is None:
                time.sleep(_DUPLICATE_POLL_SECONDS)
                continue
            if record.request_hash != request_hash:
                raise RequestIdConflictError
            if record.status == "completed" and record.response is not None:
                return ChatPersistenceStart(
                    context=ChatPersistenceContext(
                        user_id=None,
                        conversation_id=record.conversation_id,
                        request_id=record.request_id,
                        user_message_id=record.user_message_id,
                    ),
                    cached_response=record.response,
                )
            if record.status == "failed":
                raise RequestIdConflictError
        time.sleep(_DUPLICATE_POLL_SECONDS)

    raise RequestStillProcessingError


def begin_chat_request(
    content: str,
    request_id: UUID | None,
) -> ChatPersistenceStart:
    """요청을 선점하고 사용자 원문을 OpenAI 호출 전에 한 번만 저장합니다."""

    if SessionLocal is None:
        print("[noie] chat persistence skipped: DATABASE_URL is not configured")
        return ChatPersistenceStart(context=None)

    request_hash = _request_hash(content)
    try:
        with SessionLocal() as db:
            context = _resolve_context(db)

            # request_id가 없는 구버전 클라이언트는 기존 저장 동작을 그대로 유지합니다.
            if request_id is None:
                user_message = create_message(
                    db,
                    context.conversation_id,
                    MessageCreate(role="user", content=content),
                )
                return ChatPersistenceStart(
                    context=ChatPersistenceContext(
                        user_id=context.user_id,
                        conversation_id=context.conversation_id,
                        user_message_id=user_message.id,
                    )
                )

            record = ChatRequestRecord(
                request_id=request_id,
                conversation_id=context.conversation_id,
                request_hash=request_hash,
                status="processing",
            )
            db.add(record)
            try:
                # PK unique constraint가 동시에 들어온 요청 중 하나만 선점하게 합니다.
                db.flush()
            except IntegrityError:
                db.rollback()
                return _wait_for_existing_request(request_id, request_hash)

            user_message = Message(
                conversation_id=context.conversation_id,
                user_id=context.user_id,
                role="user",
                content=content,
                metadata_={"request_id": str(request_id)},
            )
            db.add(user_message)
            db.flush()
            record.user_message_id = user_message.id
            db.commit()

            return ChatPersistenceStart(
                context=ChatPersistenceContext(
                    user_id=context.user_id,
                    conversation_id=context.conversation_id,
                    request_id=request_id,
                    user_message_id=user_message.id,
                )
            )
    except (RequestIdConflictError, RequestStillProcessingError):
        raise
    except Exception as error:
        # 저장 장애가 기존 채팅 기능까지 막지 않도록 request_id 저장만 건너뜁니다.
        print(f"[noie] user message persistence failed: {type(error).__name__}")
        return ChatPersistenceStart(context=None)


def complete_chat_request(
    context: ChatPersistenceContext | None,
    content: str,
    source: str,
    response: dict[str, Any],
) -> None:
    """최종 assistant 원문과 재사용할 API 응답을 한 transaction으로 완료합니다."""

    if context is None or SessionLocal is None:
        return

    try:
        with SessionLocal() as db:
            if context.request_id is None:
                create_message(
                    db,
                    context.conversation_id,
                    MessageCreate(role="assistant", content=content),
                    metadata={"source": source},
                )
                return

            record = db.scalar(
                select(ChatRequestRecord)
                .where(ChatRequestRecord.request_id == context.request_id)
                .with_for_update()
            )
            if record is None or record.status == "completed":
                return

            assistant_message = Message(
                conversation_id=context.conversation_id,
                user_id=None,
                role="assistant",
                content=content,
                metadata_={
                    "source": source,
                    "request_id": str(context.request_id),
                },
            )
            db.add(assistant_message)
            db.flush()
            record.assistant_message_id = assistant_message.id
            record.status = "completed"
            record.response = jsonable_encoder(response)
            db.commit()
    except Exception as error:
        # DB 저장 실패가 사용자에게 반환할 기존 응답을 깨뜨리지 않게 합니다.
        print(f"[noie] assistant message persistence failed: {type(error).__name__}")
        mark_chat_request_failed(context)


def mark_chat_request_failed(context: ChatPersistenceContext | None) -> None:
    """응답 생성 실패를 표시해 중복 요청이 무한히 기다리지 않게 합니다."""

    if context is None or context.request_id is None or SessionLocal is None:
        return

    try:
        with SessionLocal() as db:
            record = db.get(ChatRequestRecord, context.request_id)
            if record is not None and record.status == "processing":
                record.status = "failed"
                db.commit()
    except Exception as error:
        print(f"[noie] chat request failure marking failed: {type(error).__name__}")


# TODO: 프로세스가 강제 종료되어 processing에 남은 요청을 복구하는 lease 정책은
# 운영 트래픽과 worker 구성이 정해진 뒤 별도 단계에서 추가합니다.
