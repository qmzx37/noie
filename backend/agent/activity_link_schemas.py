"""확인 대상 Activity 쌍과 원문 근거를 고정하는 lifecycle 입력 계약입니다."""

import hashlib
import json
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator


class LinkActivityCompletionArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ongoing_activity_id: UUID
    completion_activity_id: UUID

    @model_validator(mode="after")
    def distinct_records(self):
        if self.ongoing_activity_id == self.completion_activity_id:
            raise ValueError("Activity pair must be distinct")
        return self


class ActivityCompletionLink(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal["activity-link-v01"] = "activity-link-v01"
    ongoing_activity_id: UUID
    completion_activity_id: UUID
    basis: Literal["user_confirmed"] = "user_confirmed"
    confirmation_action_id: UUID
    confirmation_id: UUID
    confirmed_at: AwareDatetime


def activity_link_binding(arguments, *, user_id, conversation_id, message_id):
    """클라이언트 인자 대신 서버가 저장한 정확한 쌍/owner/source를 검증합니다."""
    pair = LinkActivityCompletionArguments.model_validate(arguments)
    if conversation_id is None or message_id is None:
        raise ValueError("activity_link_source_required")
    payload = dict(pair.model_dump(mode="json"), user_id=str(user_id),
                   conversation_id=str(conversation_id), message_id=str(message_id))
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def bound_activity_link_arguments(action):
    """승인 이후 인자가 달라져도 기존 confirmation으로 다른 쌍을 실행할 수 없습니다."""
    pair = LinkActivityCompletionArguments.model_validate(action.arguments)
    expected = activity_link_binding(pair, user_id=action.user_id,
                                     conversation_id=action.conversation_id, message_id=action.message_id)
    if (action.tool_name != "link_activity_completion" or action.intent != "link_activity_completion"
            or action.action_type != "daily_life" or action.mode != "execute"
            or action.requires_confirmation is not True or not isinstance(action.metadata_, dict)
            or action.metadata_.get("activity_link_binding") != expected):
        raise ValueError("activity_link_confirmation_changed")
    return pair
