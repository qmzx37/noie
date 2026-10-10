"""Explicit mention approval; the Orchestrator contract is unchanged."""

import hashlib
import json
from typing import Literal
from uuid import UUID

from agent.object_reference_schemas import ActivityObjectReferenceRequest, ActivityObjectReferencePreview
from agent.schemas import AgentType


GatewayActionType = AgentType | Literal["object"]


def object_mention_binding(arguments, *, user_id, conversation_id, message_id):
    checked = ActivityObjectReferenceRequest.model_validate(arguments)
    if user_id is None or conversation_id is None or message_id is None:
        raise ValueError("invalid_object_source")
    data = dict(arguments=checked.model_dump(mode="json"), user_id=str(user_id),
                conversation_id=str(conversation_id), message_id=str(message_id))
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False).encode("utf-8")).hexdigest()


def bound_object_mention_arguments(action):
    checked = ActivityObjectReferenceRequest.model_validate(action.arguments)
    expected = object_mention_binding(checked.model_dump(mode="json"), user_id=action.user_id,
                                     conversation_id=action.conversation_id, message_id=action.message_id)
    if (action.tool_name != "save_object_mention" or action.intent != "save_object_mention"
            or action.action_type != "object" or action.mode != "execute"
            or action.requires_confirmation is not True or action.confirmation_id is None
            or not isinstance(action.metadata_, dict)
            or action.metadata_.get("object_mention_binding") != expected):
        raise ValueError("invalid_object_approval")
    return checked


class ObjectMentionResponse(ActivityObjectReferencePreview):
    id: UUID
    status: Literal["active"] = "active"
