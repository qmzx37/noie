"""사용자, 대화방, 원본 메시지의 DB 작업을 담당합니다."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from chat_storage_schemas import ConversationCreate, MessageCreate, UserCreate
from models.conversation import Conversation
from models.message import Message
from models.user import User


class StorageNotFoundError(Exception):
    """활성 상태의 요청 대상이 없을 때 사용합니다."""


class StorageDatabaseError(Exception):
    """내부 DB 오류를 API 응답에 그대로 노출하지 않기 위한 예외입니다."""


def _read_all(db: Session, statement: Select) -> list:
    """조회 오류가 나면 transaction을 정리한 뒤 일반화된 예외로 바꿉니다."""

    try:
        return list(db.scalars(statement).all())
    except SQLAlchemyError as error:
        db.rollback()
        raise StorageDatabaseError from error


def _read_one(db: Session, statement: Select):
    """단일 레코드를 조회하고 DB 오류만 안전하게 감춥니다."""

    try:
        return db.scalar(statement)
    except SQLAlchemyError as error:
        db.rollback()
        raise StorageDatabaseError from error


def _save(db: Session, instance):
    """한 번의 쓰기를 commit하고 DB가 채운 UUID와 시간을 다시 읽습니다."""

    try:
        db.add(instance)
        # flush와 refresh도 commit 전에 수행해 응답 생성까지 한 transaction으로 묶습니다.
        db.flush()
        db.refresh(instance)
        db.commit()
        return instance
    except SQLAlchemyError as error:
        db.rollback()
        raise StorageDatabaseError from error


def create_user(db: Session, data: UserCreate) -> User:
    """동일한 이름도 별도의 개발용 사용자로 생성합니다."""

    return _save(db, User(name=data.name))


def create_conversation(db: Session, data: ConversationCreate) -> Conversation:
    """활성 사용자인지 확인한 뒤 대화방을 생성합니다."""

    user = _read_one(
        db,
        select(User).where(User.id == data.user_id, User.deleted_at.is_(None)),
    )
    if user is None:
        raise StorageNotFoundError("활성 사용자를 찾을 수 없습니다.")

    return _save(
        db,
        Conversation(user_id=data.user_id, title=data.title),
    )


def list_user_conversations(db: Session, user_id: UUID) -> list[Conversation]:
    """활성 사용자의 활성 대화를 최신 생성 순으로 반환합니다."""

    user = _read_one(
        db,
        select(User.id).where(User.id == user_id, User.deleted_at.is_(None)),
    )
    if user is None:
        raise StorageNotFoundError("활성 사용자를 찾을 수 없습니다.")

    return _read_all(
        db,
        select(Conversation)
        .where(
            Conversation.user_id == user_id,
            Conversation.deleted_at.is_(None),
        )
        .order_by(Conversation.created_at.desc(), Conversation.id.desc()),
    )


def _get_active_conversation(db: Session, conversation_id: UUID) -> Conversation:
    """삭제된 대화를 외부에 노출하지 않고 활성 대화만 찾습니다."""

    conversation = _read_one(
        db,
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.deleted_at.is_(None),
        ),
    )
    if conversation is None:
        raise StorageNotFoundError("활성 대화를 찾을 수 없습니다.")
    return conversation


def create_message(
    db: Session,
    conversation_id: UUID,
    data: MessageCreate,
    metadata: dict | None = None,
) -> Message:
    """role에 맞는 user_id를 연결하고 content 원문을 그대로 저장합니다."""

    conversation = _get_active_conversation(db, conversation_id)
    message_user_id = conversation.user_id if data.role == "user" else None

    return _save(
        db,
        Message(
            conversation_id=conversation.id,
            user_id=message_user_id,
            role=data.role,
            content=data.content,
            metadata_=metadata or {},
        ),
    )


def list_conversation_messages(
    db: Session,
    conversation_id: UUID,
) -> list[Message]:
    """복합 인덱스 순서와 같은 created_at, id 오름차순으로 조회합니다."""

    _get_active_conversation(db, conversation_id)
    return _read_all(
        db,
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc()),
    )
