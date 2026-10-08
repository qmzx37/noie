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
from account_write_guard import AccountWriteRejected, lock_account_for_write, require_active_account_for_write

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


class AuthenticatedOwnershipError(Exception):
    """검증된 사용자 문맥을 안전하게 확정하지 못했습니다. 개발 사용자로 대체하지 않습니다."""


def require_active_chat_user(user_id: UUID) -> None:
    """후속 모델 호출 직전에 원래 사용자의 활성 상태만 조회하고 세션을 닫습니다."""
    if SessionLocal is None or not isinstance(user_id, UUID):
        raise AuthenticatedOwnershipError
    try:
        with SessionLocal() as db:
            active = db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None)))
            if active is None:
                raise AuthenticatedOwnershipError
    except Exception:
        # 오류도 fail-closed로 처리하며 다른 dev-user를 찾거나 생성하지 않습니다.
        raise AuthenticatedOwnershipError from None


_DUPLICATE_WAIT_SECONDS = 60.0
_DUPLICATE_POLL_SECONDS = 0.2


def _configured_uuid(name: str) -> UUID | None:
    """선택적 UUID 환경변수를 읽고 잘못된 값은 저장 실패로 처리합니다."""

    value = os.getenv(name, "").strip()
    return UUID(value) if value else None


def _resolve_context(db, authenticated_user_id: UUID | None = None) -> ChatPersistenceContext:
    """인증 계층의 UUID를 우선하고, 없을 때만 기존 개발용 선택/bootstrap을 사용합니다."""

    if authenticated_user_id is not None:
        # 이 인자는 request body가 아니라 미래 인증 계층이 검증한 UUID만 받는 내부 경계입니다.
        if not isinstance(authenticated_user_id, UUID):
            raise AuthenticatedOwnershipError
        user = db.scalar(select(User).where(
            User.id == authenticated_user_id, User.deleted_at.is_(None),
        ))
        if user is None:
            raise AuthenticatedOwnershipError
        conversation = db.scalar(
            select(Conversation).where(
                Conversation.user_id == authenticated_user_id,
                Conversation.deleted_at.is_(None),
            ).order_by(Conversation.created_at.desc(), Conversation.id.desc()).limit(1)
        )
        if conversation is None:
            conversation = create_conversation(db, ConversationCreate(
                user_id=authenticated_user_id,
                title=os.getenv("NOIE_DEV_CONVERSATION_TITLE", "NOIE 개발 대화"),
            ))
        return ChatPersistenceContext(authenticated_user_id, conversation.id)

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
    *,
    authenticated_user_id: UUID | None = None,
) -> ChatPersistenceStart:
    """동시에 들어온 동일 요청이 끝날 때까지 짧게 기다린 뒤 결과를 재사용합니다."""

    deadline = time.monotonic() + _DUPLICATE_WAIT_SECONDS
    while time.monotonic() < deadline:
        with SessionLocal() as db:
            record = db.get(ChatRequestRecord, request_id)
            if record is None:
                time.sleep(_DUPLICATE_POLL_SECONDS)
                continue
            if authenticated_user_id is not None:
                # 전역 request UUID가 같아도 다른 사용자의 cached 결과는 절대 반환하지 않습니다.
                owner = db.scalar(select(Conversation.user_id).join(User, User.id == Conversation.user_id).where(
                    Conversation.id == record.conversation_id,
                    Conversation.user_id == authenticated_user_id,
                    Conversation.deleted_at.is_(None),
                    User.deleted_at.is_(None),
                ))
                if owner != authenticated_user_id:
                    raise AuthenticatedOwnershipError
            if record.request_hash != request_hash:
                raise RequestIdConflictError
            if record.status == "completed" and record.response is not None:
                return ChatPersistenceStart(
                    context=ChatPersistenceContext(
                        user_id=authenticated_user_id,
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
    *,
    authenticated_user_id: UUID | None = None,
) -> ChatPersistenceStart:
    """요청을 선점하고 사용자 원문을 OpenAI 호출 전에 한 번만 저장합니다."""

    if SessionLocal is None:
        # 실제 인증 경로는 DB 검증 없이 저장을 건너뛰어 성공한 것처럼 진행하지 않습니다.
        if authenticated_user_id is not None:
            raise AuthenticatedOwnershipError
        print("[noie] chat persistence skipped: DATABASE_URL is not configured")
        return ChatPersistenceStart(context=None)

    request_hash = _request_hash(content)
    try:
        with SessionLocal() as db:
            context = _resolve_context(db, authenticated_user_id=authenticated_user_id)
            # bootstrap의 commit 이후 새 쓰기 transaction에서 원래 소유자를 다시 보호합니다.
            try:
                require_active_account_for_write(db, context.user_id)
            except Exception as error:
                # 검사 장애도 삭제 거부와 동일하게 종료합니다. dev 응답 fallback으로 우회하지 않습니다.
                raise AuthenticatedOwnershipError from error

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
                return _wait_for_existing_request(
                    # 개발 모드 duplicate도 최초 선택한 local 계정 밖으로 결과를 돌려주지 않습니다.
                    request_id, request_hash, authenticated_user_id=context.user_id,
                )

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
    except AccountWriteRejected as error:
        # 개발 경로도 이미 확인한 계정이 삭제됐다면 다른 사용자로 fallback하지 않습니다.
        raise AuthenticatedOwnershipError from error
    except (RequestIdConflictError, RequestStillProcessingError, AuthenticatedOwnershipError):
        raise
    except Exception as error:
        if authenticated_user_id is not None:
            # 인증된 사용자 검증/저장 오류는 fail closed합니다. 외부에 DB 오류 원문을 전달하지 않습니다.
            raise AuthenticatedOwnershipError from error
        # 저장 장애가 기존 채팅 기능까지 막지 않도록 request_id 저장만 건너뜁니다.
        print(f"[noie] user message persistence failed: {type(error).__name__}")
        return ChatPersistenceStart(context=None)


def complete_chat_request(
    context: ChatPersistenceContext | None,
    content: str,
    source: str,
    response: dict[str, Any],
    *,
    reject_unsafe_response: bool = False,
) -> bool:
    """최종 assistant 원문과 재사용할 API 응답을 한 transaction으로 완료합니다."""

    if context is None:
        return False
    if SessionLocal is None:
        if reject_unsafe_response:
            raise AuthenticatedOwnershipError
        return False

    try:
        with SessionLocal() as db:
            # 외부 응답 생성은 끝났습니다. User -> request 순서로 잠그고 같은 transaction에서 저장합니다.
            require_active_account_for_write(db, context.user_id)
            owner = db.scalar(select(Conversation.user_id).where(
                Conversation.id == context.conversation_id,
                Conversation.deleted_at.is_(None),
            ))
            if owner != context.user_id:
                raise AccountWriteRejected("account_write_rejected")
            if context.request_id is None:
                create_message(
                    db,
                    context.conversation_id,
                    MessageCreate(role="assistant", content=content),
                    metadata={"source": source},
                )
                return True

            record = db.scalar(
                select(ChatRequestRecord)
                .where(ChatRequestRecord.request_id == context.request_id)
                .with_for_update()
            )
            if record is None or record.status == "completed":
                if reject_unsafe_response:
                    raise AccountWriteRejected("account_write_rejected")
                return False
            if record.conversation_id != context.conversation_id or record.user_message_id != context.user_message_id:
                raise AccountWriteRejected("account_write_rejected")

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
            return True
    except Exception as error:
        # 실패 상태만 기록하며, 검사 실패 후 생성 결과를 성공 응답으로 전달하지 않습니다.
        print(f"[noie] assistant message persistence failed: {type(error).__name__}")
        mark_chat_request_failed(context)
        if reject_unsafe_response:
            raise AuthenticatedOwnershipError from error
        return False


def mark_chat_request_failed(context: ChatPersistenceContext | None) -> None:
    """응답 생성 실패를 표시해 중복 요청이 무한히 기다리지 않게 합니다."""

    if context is None or context.request_id is None or SessionLocal is None:
        return

    try:
        with SessionLocal() as db:
            # 실패 정리도 User -> request 순서입니다. 비활성 계정에는 상태만 바꾸며 payload는 쓰지 않습니다.
            lock_account_for_write(db, context.user_id)
            # 취소 상태도 원래 소유자가 일치할 때만 변경합니다. 잘못된 context는 타인 요청을 건드리지 않습니다.
            owner = db.scalar(select(Conversation.user_id).where(Conversation.id == context.conversation_id))
            if owner != context.user_id:
                return
            record = db.scalar(select(ChatRequestRecord).where(
                ChatRequestRecord.request_id == context.request_id,
                ChatRequestRecord.conversation_id == context.conversation_id,
            ).with_for_update())
            if record is not None and record.status == "processing":
                record.status = "failed"
                db.commit()
    except Exception as error:
        print(f"[noie] chat request failure marking failed: {type(error).__name__}")


# TODO: 프로세스가 강제 종료되어 processing에 남은 요청을 복구하는 lease 정책은
# 운영 트래픽과 worker 구성이 정해진 뒤 별도 단계에서 추가합니다.
