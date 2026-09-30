"""기존 Memory 후보 검색과 조정 결과의 원자적 DB 반영을 담당합니다."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.exc import SQLAlchemyError

from database import SessionLocal
from memory_reconciler import RECONCILER_VERSION
from memory_schemas import (
    MemoryCreate,
    MemoryExtractionDecision,
    MemoryReconciliationDecision,
)
from memory_service import create_memory_in_transaction
from models.memory import Memory, MemoryEvidence
from models.memory_extraction import MemoryExtraction


MAX_RECONCILIATION_CANDIDATES = 30


class MemoryReconciliationValidationError(Exception):
    """AI가 후보 밖 ID나 행동과 맞지 않는 ID를 반환했을 때 사용합니다."""


class MemoryReconciliationDatabaseError(Exception):
    """최종 조정 transaction 실패를 외부에 안전하게 전달합니다."""


def find_reconciliation_candidates(
    user_id: UUID,
    candidate_kind: str,
) -> list[dict[str, Any]]:
    """같은 사용자의 active Memory를 동일 kind 우선으로 최대 30개 조회합니다."""

    if SessionLocal is None:
        raise MemoryReconciliationDatabaseError
    try:
        with SessionLocal() as db:
            memories = list(
                db.scalars(
                    select(Memory)
                    .where(
                        Memory.user_id == user_id,
                        Memory.deleted_at.is_(None),
                        Memory.status == "active",
                    )
                    .order_by(
                        case((Memory.kind == candidate_kind, 0), else_=1),
                        Memory.importance.desc().nullslast(),
                        Memory.updated_at.desc(),
                        Memory.id.desc(),
                    )
                    .limit(MAX_RECONCILIATION_CANDIDATES)
                ).all()
            )
            return [
                {
                    "id": str(memory.id),
                    "content": memory.content,
                    "kind": memory.kind,
                    "importance": memory.importance,
                    "confidence": memory.confidence,
                }
                for memory in memories
            ]
    except SQLAlchemyError as error:
        raise MemoryReconciliationDatabaseError from error


def validate_reconciliation_decision(
    decision: MemoryReconciliationDecision,
    candidates: list[dict[str, Any]],
) -> None:
    """AI가 실제 제공된 candidate ID만 행동 규칙에 맞게 선택했는지 확인합니다."""

    candidate_ids = {UUID(str(candidate["id"])) for candidate in candidates}
    if decision.action == "new":
        if decision.matched_memory_id is not None:
            raise MemoryReconciliationValidationError
        return
    if (
        decision.matched_memory_id is None
        or decision.matched_memory_id not in candidate_ids
    ):
        raise MemoryReconciliationValidationError


def apply_reconciliation(
    extraction_id: UUID,
    user_id: UUID,
    message_id: UUID,
    candidate: MemoryExtractionDecision,
    decision: MemoryReconciliationDecision,
    candidates: list[dict[str, Any]],
) -> MemoryExtraction:
    """조정 행동과 extraction 감사를 하나의 짧은 transaction으로 확정합니다."""

    validate_reconciliation_decision(decision, candidates)
    if SessionLocal is None:
        raise MemoryReconciliationDatabaseError

    try:
        with SessionLocal() as db:
            extraction = db.scalar(
                select(MemoryExtraction)
                .where(MemoryExtraction.id == extraction_id)
                .with_for_update()
            )
            if extraction is None:
                raise MemoryReconciliationDatabaseError
            if extraction.status != "processing":
                return extraction

            matched_memory = None
            if decision.matched_memory_id is not None:
                matched_memory = db.scalar(
                    select(Memory)
                    .where(
                        Memory.id == decision.matched_memory_id,
                        Memory.user_id == user_id,
                        Memory.deleted_at.is_(None),
                        Memory.status == "active",
                    )
                    .with_for_update()
                )
                if matched_memory is None:
                    raise MemoryReconciliationValidationError

            memory_data = MemoryCreate(
                user_id=user_id,
                content=candidate.content,
                kind=candidate.kind,
                importance=candidate.importance,
                confidence=candidate.confidence,
                evidence_message_ids=[message_id],
            )

            if decision.action == "new":
                result_memory = create_memory_in_transaction(db, memory_data)
            elif decision.action == "reinforce":
                # 같은 evidence는 UNIQUE constraint와 사전 조회로 이중 방어합니다.
                evidence_exists = db.scalar(
                    select(MemoryEvidence.id).where(
                        MemoryEvidence.memory_id == matched_memory.id,
                        MemoryEvidence.message_id == message_id,
                    )
                )
                if evidence_exists is None:
                    db.add(
                        MemoryEvidence(
                            memory_id=matched_memory.id,
                            message_id=message_id,
                        )
                    )
                matched_memory.updated_at = func.now()
                result_memory = matched_memory
            else:
                result_memory = create_memory_in_transaction(
                    db,
                    memory_data,
                    supersedes_memory_id=matched_memory.id,
                )
                matched_memory.status = "superseded"

            extraction.status = "completed"
            extraction.should_remember = True
            extraction.reason = candidate.reason
            extraction.memory_id = result_memory.id
            extraction.reconciliation_action = decision.action
            extraction.matched_memory_id = (
                matched_memory.id if matched_memory is not None else None
            )
            extraction.reconciliation_reason = decision.reason
            extraction.reconciler_version = RECONCILER_VERSION
            extraction.error_message = None
            extraction.completed_at = func.now()
            db.flush()
            db.commit()
            db.refresh(extraction)
            return extraction
    except MemoryReconciliationValidationError:
        raise
    except SQLAlchemyError as error:
        raise MemoryReconciliationDatabaseError from error
