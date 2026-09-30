"""Memory 추출 선점, OpenAI 판단, Memory 저장을 안전하게 연결합니다."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from database import SessionLocal
from memory_extractor import EXTRACTOR_VERSION, extract_memory_with_openai
from memory_reconciler import reconcile_memory_candidate
from memory_reconciliation_service import (
    apply_reconciliation,
    find_reconciliation_candidates,
)
from models.conversation import Conversation
from models.memory_extraction import MemoryExtraction
from models.message import Message
from models.user import User


class MemoryExtractionNotFoundError(Exception):
    """활성 사용자의 message 또는 extraction을 찾지 못했을 때 사용합니다."""


class MemoryExtractionAccessError(Exception):
    """요청한 사용자와 message 소유자가 다를 때 사용합니다."""


class MemoryExtractionRoleError(Exception):
    """user 이외 role을 자동 추출하려 할 때 사용합니다."""


class MemoryExtractionDatabaseError(Exception):
    """내부 DB 오류를 외부 응답에서 감추기 위한 예외입니다."""


def _get_owned_user_message(db, message_id: UUID, expected_user_id: UUID | None):
    """활성 message와 conversation 소유자를 찾고 자동 추출 가능 여부를 검증합니다."""

    row = db.execute(
        select(Message, Conversation)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .join(User, Conversation.user_id == User.id)
        .where(
            Message.id == message_id,
            Conversation.deleted_at.is_(None),
            User.deleted_at.is_(None),
        )
    ).one_or_none()
    if row is None:
        raise MemoryExtractionNotFoundError

    message, conversation = row
    if expected_user_id is not None and conversation.user_id != expected_user_id:
        raise MemoryExtractionAccessError
    if message.role != "user":
        raise MemoryExtractionRoleError
    return message, conversation.user_id


def _get_extraction(message_id: UUID, expected_user_id: UUID | None):
    """소유권을 확인한 뒤 현재 version의 추출 상태를 조회합니다."""

    if SessionLocal is None:
        raise MemoryExtractionDatabaseError
    try:
        with SessionLocal() as db:
            _get_owned_user_message(db, message_id, expected_user_id)
            extraction = db.scalar(
                select(MemoryExtraction).where(
                    MemoryExtraction.message_id == message_id,
                    MemoryExtraction.extractor_version == EXTRACTOR_VERSION,
                )
            )
            if extraction is None:
                raise MemoryExtractionNotFoundError
            return extraction
    except (
        MemoryExtractionNotFoundError,
        MemoryExtractionAccessError,
        MemoryExtractionRoleError,
    ):
        raise
    except SQLAlchemyError as error:
        raise MemoryExtractionDatabaseError from error


def get_memory_extraction(message_id: UUID, expected_user_id: UUID):
    """개발용 조회 API에서 현재 extractor version의 결과를 반환합니다."""

    return _get_extraction(message_id, expected_user_id)


def _mark_failed(extraction_id: UUID, error: Exception) -> MemoryExtraction:
    """실패 종류만 기록하고 원문이나 외부 API 세부 정보는 저장하지 않습니다."""

    try:
        with SessionLocal() as db:
            extraction = db.get(MemoryExtraction, extraction_id)
            if extraction is None:
                raise MemoryExtractionDatabaseError
            extraction.status = "failed"
            extraction.error_message = f"Memory extraction failed: {type(error).__name__}"
            extraction.completed_at = datetime.now(timezone.utc)
            db.commit()
            # onupdate로 갱신된 updated_at을 세션이 닫히기 전에 읽어 둡니다.
            db.refresh(extraction)
            return extraction
    except SQLAlchemyError as database_error:
        raise MemoryExtractionDatabaseError from database_error


def extract_memory_for_message(
    message_id: UUID,
    expected_user_id: UUID | None = None,
) -> MemoryExtraction:
    """한 user message를 version별로 한 번만 분석하고 결과를 기록합니다."""

    if SessionLocal is None:
        raise MemoryExtractionDatabaseError

    try:
        with SessionLocal() as db:
            message, user_id = _get_owned_user_message(
                db,
                message_id,
                expected_user_id,
            )
            extraction = MemoryExtraction(
                message_id=message.id,
                extractor_version=EXTRACTOR_VERSION,
                status="processing",
            )
            db.add(extraction)
            try:
                # 동시에 같은 message를 분석해도 UNIQUE constraint가 한 요청만 선점합니다.
                db.flush()
                db.commit()
            except IntegrityError:
                db.rollback()
                existing = db.scalar(
                    select(MemoryExtraction).where(
                        MemoryExtraction.message_id == message_id,
                        MemoryExtraction.extractor_version == EXTRACTOR_VERSION,
                    )
                )
                if existing is None:
                    raise MemoryExtractionDatabaseError
                return existing

            extraction_id = extraction.id
            original_content = message.content
    except (
        MemoryExtractionNotFoundError,
        MemoryExtractionAccessError,
        MemoryExtractionRoleError,
        MemoryExtractionDatabaseError,
    ):
        raise
    except SQLAlchemyError as error:
        raise MemoryExtractionDatabaseError from error

    try:
        decision = extract_memory_with_openai(original_content)
        if decision.should_remember:
            candidates = find_reconciliation_candidates(user_id, decision.kind)
            reconciliation = reconcile_memory_candidate(decision, candidates)
            return apply_reconciliation(
                extraction_id=extraction_id,
                user_id=user_id,
                message_id=message_id,
                candidate=decision,
                decision=reconciliation,
                candidates=candidates,
            )

        with SessionLocal() as db:
            extraction = db.get(MemoryExtraction, extraction_id)
            if extraction is None:
                raise MemoryExtractionDatabaseError
            extraction.status = "completed"
            extraction.should_remember = decision.should_remember
            extraction.reason = decision.reason
            extraction.memory_id = None
            extraction.error_message = None
            extraction.completed_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(extraction)
            return extraction
    except Exception as error:
        # 실패한 version은 자동 재시도하지 않으며 수동 조회에서 원인을 확인할 수 있습니다.
        return _mark_failed(extraction_id, error)


def run_memory_extraction_background(message_id: UUID) -> None:
    """BackgroundTasks 실패가 기존 /chat 응답에 영향을 주지 않도록 감쌉니다."""

    try:
        extract_memory_for_message(message_id)
    except Exception as error:
        print(f"[noie] background memory extraction failed: {type(error).__name__}")
