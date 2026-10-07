"""Action 계획 저장, 조회, 승인과 거절의 transaction을 관리합니다."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from account_write_guard import AccountWriteRejected, require_active_account_for_write

from agent.action_schemas import ConfirmationRequest, PersistActionPlanRequest
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.user import User


INITIAL_STATUSES = {
    "planned",
    "pending_confirmation",
    "ready",
    "needs_review",
    "not_implemented",
    "rejected",
}
SAFE_POLICY_MESSAGES = {
    "unsupported_intent",
    "mode_not_allowed",
    "confirmation_forced_by_gateway",
    "unnecessary_confirmation_removed",
    "confidence_below_policy_threshold",
    "tool_not_implemented",
    "executor_not_connected",
    "duplicate_execution_order",
}


class ActionNotFoundError(Exception):
    """요청 사용자에게 노출할 수 있는 action이 없을 때 사용합니다."""


class ActionConflictError(Exception):
    """idempotency 충돌이나 허용되지 않은 상태 전이일 때 사용합니다."""


class ActionConfirmationError(Exception):
    """confirmation ID가 action과 일치하지 않을 때 사용합니다."""


class ActionValidationError(Exception):
    """활성 사용자/대화/메시지 또는 초기 상태가 올바르지 않을 때 사용합니다."""


class ActionDatabaseError(Exception):
    """DB 내부 정보를 외부에 노출하지 않기 위한 예외입니다."""


def _validate_owner_context(db: Session, data: PersistActionPlanRequest) -> None:
    # LLM 호출 후의 계획/인자 저장도 개인정보 쓰기이므로 User 잠금을 commit까지 유지합니다.
    try:
        require_active_account_for_write(db, data.user_id)
    except AccountWriteRejected as error:
        raise ActionValidationError("활성 사용자를 찾을 수 없습니다.") from error

    if data.conversation_id is not None:
        conversation = db.scalar(
            select(Conversation).where(
                Conversation.id == data.conversation_id,
                Conversation.user_id == data.user_id,
                Conversation.deleted_at.is_(None),
            )
        )
        if conversation is None:
            raise ActionValidationError("사용자의 활성 conversation을 찾을 수 없습니다.")

    if data.message_id is not None:
        row = db.execute(
            select(Message, Conversation)
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Message.id == data.message_id,
                Conversation.user_id == data.user_id,
                Conversation.deleted_at.is_(None),
            )
        ).one_or_none()
        if row is None:
            raise ActionValidationError("사용자의 message를 찾을 수 없습니다.")
        message, conversation = row
        if data.conversation_id is not None and message.conversation_id != data.conversation_id:
            raise ActionValidationError("message와 conversation이 일치하지 않습니다.")


def _action_values(data: PersistActionPlanRequest, plan) -> dict:
    if plan.status not in INITIAL_STATUSES:
        raise ActionValidationError("실행 이후 상태는 plan API로 저장할 수 없습니다.")
    if plan.can_execute:
        raise ActionValidationError("Persistence 단계에서는 Tool 실행을 활성화할 수 없습니다.")
    if plan.status == "pending_confirmation" and not plan.requires_confirmation:
        raise ActionValidationError("승인 대기 action에는 confirmation이 필요합니다.")
    if plan.status == "ready" and plan.requires_confirmation:
        raise ActionValidationError("승인 전 execute action을 ready로 저장할 수 없습니다.")
    confirmation_pending = plan.status == "pending_confirmation"
    confirmation_id = uuid4() if confirmation_pending else None
    confirmation_status = "pending" if confirmation_pending else "not_required"
    rejected_at = datetime.now(timezone.utc) if plan.status == "rejected" else None
    return {
        "user_id": data.user_id,
        "conversation_id": data.conversation_id,
        "message_id": data.message_id,
        "action_id": plan.action_id,
        "tool_name": plan.tool_name,
        "action_type": plan.action_type,
        "intent": plan.intent,
        "mode": plan.mode,
        "status": plan.status,
        "confidence": plan.confidence,
        "requires_confirmation": plan.requires_confirmation,
        "execution_order": plan.execution_order,
        "idempotency_key": plan.idempotency_key,
        "confirmation_status": confirmation_status,
        "confirmation_id": confirmation_id,
        "rejected_at": rejected_at,
        "attempt_count": 0,
        "arguments": plan.arguments.model_dump(mode="json") if plan.arguments else None,
        "metadata": {
            "gateway_implemented": plan.implemented,
            "policy_messages": [
                message for message in plan.policy_messages if message in SAFE_POLICY_MESSAGES
            ],
        },
    }


def persist_action_plan(db: Session, data: PersistActionPlanRequest) -> list[AgentAction]:
    """한 Orchestrator 결과의 계획들을 한 transaction으로 저장하거나 재사용합니다."""

    try:
        _validate_owner_context(db, data)
        saved: list[AgentAction] = []
        for plan in sorted(data.plans, key=lambda item: item.execution_order):
            values = _action_values(data, plan)
            inserted_id = db.scalar(
                pg_insert(AgentAction)
                .values(**values)
                .on_conflict_do_nothing()
                .returning(AgentAction.id)
            )
            if inserted_id is not None:
                row = db.get(AgentAction, inserted_id)
            else:
                row = db.scalar(
                    select(AgentAction).where(
                        or_(
                            AgentAction.action_id == plan.action_id,
                            AgentAction.idempotency_key == plan.idempotency_key,
                        )
                    )
                )
                if (
                    row is None
                    or row.action_id != plan.action_id
                    or row.idempotency_key != plan.idempotency_key
                    or row.user_id != data.user_id
                ):
                    raise ActionConflictError("action_id 또는 idempotency_key가 충돌합니다.")
            saved.append(row)
        db.commit()
        for row in saved:
            db.refresh(row)
        return saved
    except (ActionValidationError, ActionConflictError):
        db.rollback()
        raise
    except SQLAlchemyError as error:
        db.rollback()
        raise ActionDatabaseError from error


def get_action(db: Session, action_id: UUID, user_id: UUID) -> AgentAction:
    try:
        row = db.scalar(
            select(AgentAction).where(
                AgentAction.action_id == action_id,
                AgentAction.user_id == user_id,
            )
        )
        if row is None:
            raise ActionNotFoundError
        return row
    except ActionNotFoundError:
        raise
    except SQLAlchemyError as error:
        raise ActionDatabaseError from error


def list_user_actions(db: Session, user_id: UUID) -> list[AgentAction]:
    try:
        active_user = db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None)))
        if active_user is None:
            raise ActionNotFoundError
        return list(
            db.scalars(
                select(AgentAction)
                .where(AgentAction.user_id == user_id)
                .order_by(AgentAction.created_at.desc(), AgentAction.execution_order.asc())
            ).all()
        )
    except ActionNotFoundError:
        raise
    except SQLAlchemyError as error:
        raise ActionDatabaseError from error


def _transition_confirmation(
    db: Session,
    action_id: UUID,
    data: ConfirmationRequest,
    *,
    reject: bool,
) -> AgentAction:
    try:
        # 승인/거절도 User -> Action 순서를 지켜 purge와 잠금 순서가 뒤집히지 않습니다.
        require_active_account_for_write(db, data.user_id)
        row = db.scalar(
            select(AgentAction)
            .where(AgentAction.action_id == action_id, AgentAction.user_id == data.user_id)
            .with_for_update()
        )
        if row is None:
            raise ActionNotFoundError
        if row.confirmation_id != data.confirmation_id:
            raise ActionConfirmationError
        if row.status != "pending_confirmation" or row.confirmation_status != "pending":
            raise ActionConflictError("현재 상태에서는 승인 또는 거절할 수 없습니다.")

        now = datetime.now(timezone.utc)
        if reject:
            row.status = "rejected"
            row.confirmation_status = "rejected"
            row.rejected_at = now
        else:
            row.status = "ready"
            row.confirmation_status = "confirmed"
            row.confirmed_at = now
        db.commit()
        db.refresh(row)
        return row
    except (ActionNotFoundError, ActionConfirmationError, ActionConflictError):
        db.rollback()
        raise
    except SQLAlchemyError as error:
        db.rollback()
        raise ActionDatabaseError from error


def confirm_action(db: Session, action_id: UUID, data: ConfirmationRequest) -> AgentAction:
    return _transition_confirmation(db, action_id, data, reject=False)


def reject_action(db: Session, action_id: UUID, data: ConfirmationRequest) -> AgentAction:
    return _transition_confirmation(db, action_id, data, reject=True)
