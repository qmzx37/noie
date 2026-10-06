"""Memory와 원문 evidence의 검증·저장·조회 작업을 담당합니다."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload, selectinload

from memory_schemas import MemoryCreate
from memory_privacy import PrivacyClass, classify_memory_text
from models.conversation import Conversation
from models.memory import Memory, MemoryEvidence
from models.message import Message
from models.user import User


class MemoryNotFoundError(Exception):
    """활성 사용자, memory 또는 evidence 원문을 찾지 못했을 때 사용합니다."""


class MemoryEvidenceValidationError(Exception):
    """evidence가 memory 소유자와 논리적으로 맞지 않을 때 사용합니다."""


class MemoryDatabaseError(Exception):
    """내부 DB 오류가 API 사용자에게 직접 노출되지 않도록 감쌉니다."""


def _memory_with_evidence_statement(memory_id: UUID):
    """Memory와 연결된 원문 메시지를 한 번에 조회할 statement를 만듭니다."""

    return (
        select(Memory)
        .join(User, Memory.user_id == User.id)
        .where(
            Memory.id == memory_id,
            Memory.deleted_at.is_(None),
            User.deleted_at.is_(None),
        )
        .options(selectinload(Memory.evidence).joinedload(MemoryEvidence.message))
    )


def create_memory_in_transaction(
    db: Session,
    data: MemoryCreate,
    supersedes_memory_id: UUID | None = None,
) -> Memory:
    """검증과 INSERT만 수행하고 commit은 호출자가 결정하도록 둡니다."""

    user = db.scalar(
        select(User).where(User.id == data.user_id, User.deleted_at.is_(None))
    )
    if user is None:
        raise MemoryNotFoundError("활성 사용자를 찾을 수 없습니다.")

    # Message.user_id가 NULL인 assistant/system 원문도 있으므로 conversation 소유자를 봅니다.
    evidence_rows = db.execute(
        select(Message, Conversation)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.id.in_(data.evidence_message_ids))
    ).all()
    if len(evidence_rows) != len(data.evidence_message_ids):
        raise MemoryNotFoundError("일부 evidence 메시지를 찾을 수 없습니다.")

    for _message, conversation in evidence_rows:
        if conversation.deleted_at is not None:
            raise MemoryEvidenceValidationError(
                "삭제된 conversation의 메시지는 evidence로 사용할 수 없습니다."
            )
        if conversation.user_id != data.user_id:
            raise MemoryEvidenceValidationError(
                "다른 사용자의 메시지는 evidence로 연결할 수 없습니다."
            )

    # explicit manual sensitive 저장은 유지하되 secret은 명시 요청이어도 Memory로 복제하지 않습니다.
    if classify_memory_text(data.content) == PrivacyClass.RESTRICTED_SECRET:
        raise MemoryEvidenceValidationError("Credential/secret은 Memory에 저장할 수 없습니다.")
    memory = Memory(
        user_id=data.user_id,
        supersedes_memory_id=supersedes_memory_id,
        content=data.content,
        kind=data.kind,
        importance=data.importance,
        confidence=data.confidence,
    )
    db.add(memory)
    db.flush()

    # 입력 순서대로 evidence를 추가하되 DB UNIQUE constraint도 중복을 최종 방어합니다.
    db.add_all(
        MemoryEvidence(memory_id=memory.id, message_id=message_id)
        for message_id in data.evidence_message_ids
    )
    db.flush()
    return memory


def create_memory(db: Session, data: MemoryCreate) -> Memory:
    """활성 사용자와 원문 소유권을 검증한 뒤 memory/evidence를 함께 저장합니다."""

    try:
        memory = create_memory_in_transaction(db, data)

        saved_memory = db.scalar(_memory_with_evidence_statement(memory.id))
        if saved_memory is None:
            raise MemoryDatabaseError
        # 검증, memory, evidence, 응답 조회까지 성공한 경우에만 전체를 확정합니다.
        db.commit()
        return saved_memory
    except (MemoryNotFoundError, MemoryEvidenceValidationError):
        db.rollback()
        raise
    except SQLAlchemyError as error:
        db.rollback()
        raise MemoryDatabaseError from error


def list_user_memories(db: Session, user_id: UUID) -> list[Memory]:
    """활성 사용자의 활성 memory를 최신 생성 순서로 반환합니다."""

    try:
        user = db.scalar(
            select(User.id).where(User.id == user_id, User.deleted_at.is_(None))
        )
        if user is None:
            raise MemoryNotFoundError("활성 사용자를 찾을 수 없습니다.")

        return list(
            db.scalars(
                select(Memory)
                .where(Memory.user_id == user_id, Memory.deleted_at.is_(None))
                .options(
                    selectinload(Memory.evidence).joinedload(MemoryEvidence.message)
                )
                .order_by(Memory.created_at.desc(), Memory.id.desc())
            ).all()
        )
    except MemoryNotFoundError:
        db.rollback()
        raise
    except SQLAlchemyError as error:
        db.rollback()
        raise MemoryDatabaseError from error


def get_memory(db: Session, memory_id: UUID) -> Memory:
    """활성 memory 한 건과 그 근거 원문을 반환합니다."""

    try:
        memory = db.scalar(_memory_with_evidence_statement(memory_id))
        if memory is None:
            raise MemoryNotFoundError("활성 memory를 찾을 수 없습니다.")
        return memory
    except MemoryNotFoundError:
        db.rollback()
        raise
    except SQLAlchemyError as error:
        db.rollback()
        raise MemoryDatabaseError from error
