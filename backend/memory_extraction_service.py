"""Memory 추출 선점, OpenAI 판단, Memory 저장을 안전하게 연결합니다."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from database import SessionLocal
from account_write_guard import AccountWriteRejected, require_active_account_for_write
from memory_extractor import EXTRACTOR_VERSION, extract_memory_with_openai
from memory_privacy import automatic_memory_allowed, blocked_memory_decision, validate_auto_decision
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


def _positive_int_setting(name: str, default: int) -> int:
    """환경변수가 없거나 양의 정수가 아니면 안전한 기본값을 사용합니다."""

    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


PROCESSING_TIMEOUT_SECONDS = _positive_int_setting(
    "NOIE_MEMORY_PROCESSING_TIMEOUT_SECONDS",
    300,
)
MAX_EXTRACTION_ATTEMPTS = _positive_int_setting(
    "NOIE_MEMORY_MAX_EXTRACTION_ATTEMPTS",
    3,
)


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


def _acquire_processing_lease(
    message_id: UUID,
    expected_user_id: UUID | None,
) -> tuple[MemoryExtraction, bool, UUID | None, str | None]:
    """짧은 transaction과 row lock으로 한 worker만 lease를 얻도록 합니다."""

    if SessionLocal is None:
        raise MemoryExtractionDatabaseError

    # 최초 INSERT 경쟁은 UNIQUE(message_id, extractor_version)가 최종 방어합니다.
    for _ in range(2):
        try:
            with SessionLocal() as db:
                message, user_id = _get_owned_user_message(
                    db, message_id, expected_user_id
                )
                # User -> extraction 순서이며 commit 뒤 외부 호출에는 잠금을 가져가지 않습니다.
                require_active_account_for_write(db, user_id)
                extraction = db.scalar(
                    select(MemoryExtraction)
                    .where(
                        MemoryExtraction.message_id == message_id,
                        MemoryExtraction.extractor_version == EXTRACTOR_VERSION,
                    )
                    .with_for_update()
                )
                now = datetime.now(timezone.utc)

                if extraction is None:
                    extraction = MemoryExtraction(
                        message_id=message.id,
                        extractor_version=EXTRACTOR_VERSION,
                        attempt_count=0,
                    )
                    db.add(extraction)
                elif extraction.status == "completed":
                    return extraction, False, None, None
                elif (
                    extraction.status == "processing"
                    and extraction.lease_expires_at is not None
                    and extraction.lease_expires_at > now
                ):
                    return extraction, False, None, None

                if extraction.attempt_count >= MAX_EXTRACTION_ATTEMPTS:
                    if extraction.status == "processing":
                        extraction.status = "failed"
                        extraction.error_message = "Memory extraction retry limit reached"
                        extraction.lease_expires_at = None
                        extraction.completed_at = now
                        db.commit()
                        db.refresh(extraction)
                    return extraction, False, None, None

                extraction.status = "processing"
                extraction.attempt_count += 1
                extraction.processing_started_at = now
                extraction.lease_expires_at = now + timedelta(
                    seconds=PROCESSING_TIMEOUT_SECONDS
                )
                extraction.error_message = None
                extraction.completed_at = None
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
                    continue
                db.refresh(extraction)
                return extraction, True, user_id, message.content
        except IntegrityError:
            continue
        except (
            MemoryExtractionNotFoundError,
            MemoryExtractionAccessError,
            MemoryExtractionRoleError,
        ):
            raise
        except SQLAlchemyError as error:
            raise MemoryExtractionDatabaseError from error

    raise MemoryExtractionDatabaseError


def _guard_extraction_write(db, extraction_id: UUID) -> None:
    """원래 extraction의 message 소유자를 찾아 User부터 보호합니다. 재가입 사용자는 찾지 않습니다."""
    with db.no_autoflush:
        owner = db.scalar(
            select(Conversation.user_id).join(Message, Message.conversation_id == Conversation.id)
            .join(MemoryExtraction, MemoryExtraction.message_id == Message.id)
            .where(MemoryExtraction.id == extraction_id, Message.role == "user",
                   Conversation.deleted_at.is_(None), Message.user_id == Conversation.user_id)
        )
    if owner is None:
        db.rollback()
        raise MemoryExtractionNotFoundError
    try:
        require_active_account_for_write(db, owner)
    except AccountWriteRejected as error:
        raise MemoryExtractionNotFoundError from error


def _mark_failed(
    extraction_id: UUID,
    expected_attempt_count: int,
    error: Exception,
) -> MemoryExtraction:
    """실패 종류만 기록하고 원문이나 외부 API 세부 정보는 저장하지 않습니다."""

    try:
        with SessionLocal() as db:
            # 삭제된 계정에는 실패 응답 경유로 기존 private 결과를 반환하지도 않습니다.
            _guard_extraction_write(db, extraction_id)
            extraction = db.scalar(
                select(MemoryExtraction)
                .where(MemoryExtraction.id == extraction_id)
                .with_for_update()
            )
            if extraction is None:
                raise MemoryExtractionDatabaseError
            # 만료된 worker는 새 attempt의 상태를 덮어쓰지 않습니다.
            if (
                extraction.status != "processing"
                or extraction.attempt_count != expected_attempt_count
            ):
                return extraction
            extraction.status = "failed"
            extraction.error_message = f"Memory extraction failed: {type(error).__name__}"
            extraction.lease_expires_at = None
            extraction.completed_at = datetime.now(timezone.utc)
            db.commit()
            # onupdate로 갱신된 updated_at을 세션이 닫히기 전에 읽어 둡니다.
            db.refresh(extraction)
            return extraction
    except SQLAlchemyError as database_error:
        raise MemoryExtractionDatabaseError from database_error


def _complete_without_memory(
    extraction_id: UUID,
    expected_attempt_count: int,
    decision: Any,
) -> MemoryExtraction:
    """기억을 만들지 않는 결과도 현재 lease 소유자만 완료 처리합니다."""

    try:
        with SessionLocal() as db:
            # should_remember=False의 reason 역시 개인 결과이므로 같은 저장 경계를 사용합니다.
            _guard_extraction_write(db, extraction_id)
            extraction = db.scalar(
                select(MemoryExtraction)
                .where(MemoryExtraction.id == extraction_id)
                .with_for_update()
            )
            if extraction is None:
                raise MemoryExtractionDatabaseError
            if (
                extraction.status != "processing"
                or extraction.attempt_count != expected_attempt_count
            ):
                return extraction
            extraction.status = "completed"
            extraction.should_remember = decision.should_remember
            extraction.reason = decision.reason
            extraction.memory_id = None
            extraction.error_message = None
            extraction.lease_expires_at = None
            extraction.completed_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(extraction)
            return extraction
    except SQLAlchemyError as error:
        raise MemoryExtractionDatabaseError from error


def extract_memory_for_message(
    message_id: UUID,
    expected_user_id: UUID | None = None,
) -> MemoryExtraction:
    """한 user message를 version별로 한 번만 분석하고 결과를 기록합니다."""

    extraction, acquired, user_id, original_content = _acquire_processing_lease(
        message_id,
        expected_user_id,
    )
    if not acquired:
        return extraction

    extraction_id = extraction.id
    attempt_count = extraction.attempt_count
    if user_id is None or original_content is None:
        raise MemoryExtractionDatabaseError

    try:
        # lease/소유권 확인은 유지하고 세션을 닫은 뒤 privacy 검사합니다. 원문은 삭제하지 않습니다.
        if not automatic_memory_allowed(original_content):
            return _complete_without_memory(extraction_id, attempt_count, blocked_memory_decision())
        # mock/향후 extractor가 prompt 정책을 무시해도 service에서 최종 검사합니다.
        decision = validate_auto_decision(extract_memory_with_openai(original_content))
        if decision.should_remember:
            candidates = find_reconciliation_candidates(user_id, decision.kind)
            reconciliation = reconcile_memory_candidate(decision, candidates)
            if not automatic_memory_allowed(reconciliation.reason):
                return _complete_without_memory(extraction_id, attempt_count, blocked_memory_decision())
            return apply_reconciliation(
                extraction_id=extraction_id,
                user_id=user_id,
                message_id=message_id,
                candidate=decision,
                decision=reconciliation,
                candidates=candidates,
                expected_attempt_count=attempt_count,
            )

        return _complete_without_memory(extraction_id, attempt_count, decision)
    except Exception as error:
        return _mark_failed(extraction_id, attempt_count, error)


def run_memory_extraction_background(message_id: UUID) -> None:
    """BackgroundTasks 실패가 기존 /chat 응답에 영향을 주지 않도록 감쌉니다."""

    try:
        extract_memory_for_message(message_id)
    except Exception as error:
        print(f"[noie] background memory extraction failed: {type(error).__name__}")
