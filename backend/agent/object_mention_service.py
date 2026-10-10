"""Approved source mentions only; no SDK, identity resolution or source updates."""

import os
from types import SimpleNamespace
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from auth_context import AuthPrincipal
from agent.object_mention_schemas import ObjectMentionResponse, bound_object_mention_arguments
from agent.object_reference_service import preview_activity_object_reference
from models.activity import Activity
from models.agent_action import AgentAction
from models.object_mention import ObjectMention
from models.user import User


class ObjectMentionError(ValueError):
    """Fixed error type; never carries source text, IDs or DB details."""


def object_mentions_enabled():
    return os.getenv("NOIE_OBJECT_MENTION_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def validate_object_plan(plan):
    from agent.tool_gateway import create_tool_plan
    from agent.tool_schemas import GatewayAction, ToolPlanRequest

    checked = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
        action_id=plan.action_id, type=plan.action_type, intent=plan.intent, mode=plan.mode,
        reason="Explicit object mention", confidence=plan.confidence,
        requires_confirmation=plan.requires_confirmation, execution_order=plan.execution_order,
        arguments=plan.arguments,
    )])).plans[0]
    if (checked.status != "pending_confirmation" or plan.status != checked.status
            or plan.tool_name != checked.tool_name or plan.requires_confirmation is not True
            or plan.idempotency_key != checked.idempotency_key):
        raise ObjectMentionError


def validate_object_source(db, user_id, arguments, *, conversation_id, message_id):
    preview = preview_activity_object_reference(db, AuthPrincipal(user_id), arguments)
    with db.no_autoflush:
        source = db.execute(select(Activity.message_id, Activity.conversation_id)
            .where(Activity.id == preview.activity_id, Activity.user_id == user_id)).one_or_none()
    if source is None or source.message_id != message_id or source.conversation_id != conversation_id:
        raise ObjectMentionError
    return preview


def validate_object_action(db, action, *, require_mention=False):
    arguments = bound_object_mention_arguments(action)
    if action.confirmation_status != "confirmed" or action.confirmed_at is None:
        raise ObjectMentionError
    preview = validate_object_source(db, action.user_id, arguments,
                                    conversation_id=action.conversation_id, message_id=action.message_id)
    if require_mention:
        with db.no_autoflush:
            row = db.execute(select(ObjectMention.__table__).where(
                ObjectMention.agent_action_id == action.id)).mappings().one_or_none()
        if row is None:
            raise ObjectMentionError
        _checked_saved_mention(row, action, preview)
    return preview


def _checked_saved_mention(row, action, preview):
    if (row["user_id"] != action.user_id or row["agent_action_id"] != action.id
            or row["message_id"] != action.message_id or row["conversation_id"] != action.conversation_id
            or row["activity_id"] != preview.activity_id or row["kind"] != preview.kind
            or row["label"] != preview.label or row["source_start"] != preview.source_span.start
            or row["source_end"] != preview.source_span.end or row["kind_basis"] != "user_selected"
            or row["identity_status"] != "unresolved" or row["observed_at"] != preview.observed_at
            or row["deleted_at"] is not None or row["status"] != "active"
            or row["supersedes_mention_id"] is not None):
        raise ObjectMentionError
    return ObjectMentionResponse(id=row["id"], **preview.model_dump())


def persist_object_mention(db, action, *, attempt_count):
    """Called inside the executor's User/Action/source locks; caller commits."""
    if action.status != "processing" or action.attempt_count != attempt_count:
        raise ObjectMentionError
    preview = validate_object_action(db, action)
    inserted = db.scalar(pg_insert(ObjectMention).values(user_id=action.user_id,
        activity_id=preview.activity_id, message_id=action.message_id, conversation_id=action.conversation_id,
        agent_action_id=action.id, kind=preview.kind, label=preview.label,
        source_start=preview.source_span.start, source_end=preview.source_span.end,
        kind_basis="user_selected", identity_status="unresolved", observed_at=preview.observed_at,
        status="active", supersedes_mention_id=None,
    ).on_conflict_do_nothing(index_elements=[ObjectMention.agent_action_id]).returning(ObjectMention.id))
    row = db.execute(select(ObjectMention.__table__).where(
        ObjectMention.agent_action_id == action.id)).mappings().one_or_none()
    if row is None:
        raise ObjectMentionError
    response = _checked_saved_mention(row, action, preview)
    return response.id, inserted is None


def read_object_mentions(db, principal, *, mention_id: UUID | None = None, limit=50):
    """Owner-only service; intentionally no new HTTP endpoint in Phase 1."""
    if not isinstance(principal, AuthPrincipal):
        raise HTTPException(401, "Authentication required")
    if type(limit) is not int or not 1 <= limit <= 50:
        raise HTTPException(422, "Invalid page size")
    if not object_mentions_enabled():
        raise HTTPException(503, "Object mentions unavailable")
    try:
        with db.no_autoflush:
            if db.scalar(select(User.id).where(User.id == principal.user_id, User.deleted_at.is_(None))) is None:
                raise HTTPException(404, "Object mention not found")
            query = select(ObjectMention.__table__).where(ObjectMention.user_id == principal.user_id,
                ObjectMention.deleted_at.is_(None), ObjectMention.status == "active")
            if mention_id is not None:
                query = query.where(ObjectMention.id == mention_id)
            rows = db.execute(query.order_by(ObjectMention.created_at.desc(), ObjectMention.id.desc())
                              .limit(limit)).mappings().all()
            responses = []
            for row in rows:
                saved = db.execute(select(AgentAction.__table__).where(AgentAction.id == row["agent_action_id"],
                    AgentAction.user_id == principal.user_id)).mappings().one_or_none()
                if saved is None:
                    continue
                action = SimpleNamespace(**dict(saved), metadata_=saved["metadata"])
                try:
                    preview = validate_object_action(db, action)
                    responses.append(_checked_saved_mention(row, action, preview))
                except (ValueError, TypeError, KeyError, AttributeError):
                    continue
                except HTTPException as error:
                    if error.status_code not in {404, 409, 422}:
                        raise
            if mention_id is not None:
                if not responses:
                    raise HTTPException(404, "Object mention not found")
                return responses[0]
            return responses
    except SQLAlchemyError:
        raise HTTPException(503, "Object mentions unavailable") from None
