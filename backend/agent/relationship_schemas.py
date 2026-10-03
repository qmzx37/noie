"""사용자 진술과 사람 관련 근거를 구분하며 추론을 사실로 합치지 않습니다."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

SOCIAL_TYPES = ("family", "friend", "colleague", "acquaintance", "partner", "other")
MEANING_TYPES = ("fan_of", "role_model", "inspired_by", "follows", "likes")
RelationshipScore = Annotated[float, Field(strict=True, ge=0, le=1)]


class RelationshipRecord(BaseModel):
    """한 원문 구간에서 직접 지지되는 한 종류의 근거입니다."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    person_label: str = Field(min_length=1, max_length=120)
    identity_kind: Literal["named", "temporary"]
    record_kind: Literal["social_relation", "relationship_state", "meaning_relation", "observation"]
    relationship_type: Literal["family", "friend", "colleague", "acquaintance", "partner", "other"] | None = None
    meaning_relation_type: Literal["fan_of", "role_model", "inspired_by", "follows", "likes"] | None = None
    relationship_statement: str = Field(min_length=1, max_length=500)
    temporal_scope: Literal["past", "current"]
    confidence: RelationshipScore

    @model_validator(mode="after")
    def validate_record_kind(self) -> "RelationshipRecord":
        """종류에 맞지 않는 관계 필드와 이름 없는 추측을 거부합니다."""
        if not self.person_label.strip() or not self.relationship_statement.strip():
            raise ValueError("대상과 근거는 공백일 수 없습니다.")
        if self.person_label not in self.relationship_statement:
            raise ValueError("대상 label은 해당 원문 근거에 있어야 합니다.")
        if (self.record_kind == "social_relation") != (self.relationship_type is not None):
            raise ValueError("social_relation에만 사회관계 종류가 필요합니다.")
        if (self.record_kind == "meaning_relation") != (self.meaning_relation_type is not None):
            raise ValueError("meaning_relation에만 의미관계 종류가 필요합니다.")
        if self.person_label.strip() in {"걔", "그 사람", "그 개발자", "저 사람", "누군가"}:
            raise ValueError("대상이 식별되지 않으면 추측하지 않습니다.")
        return self


class RecordRelationshipArguments(BaseModel):
    """한 action의 여러 역할/대상 근거를 원자적으로 보존합니다."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    records: list[RelationshipRecord] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def validate_duplicates(self) -> "RecordRelationshipArguments":
        """같은 출력 내부의 중복만 거부하며 다른 요청/과거 기록은 병합하지 않습니다."""
        keys = [tuple(record.model_dump().get(key) for key in (
            "person_label", "identity_kind", "record_kind", "relationship_type",
            "meaning_relation_type", "relationship_statement", "temporal_scope",
        )) for record in self.records]
        if len(set(keys)) != len(keys):
            raise ValueError("한 action 안의 동일 근거를 중복 기록할 수 없습니다.")
        return self


class RelationshipEventResponse(RelationshipRecord):
    """최종 인간관계 정답이 아니라 당시의 근거 이벤트를 반환합니다."""

    model_config = ConfigDict(from_attributes=True, allow_inf_nan=False)
    id: UUID
    user_id: UUID
    conversation_id: UUID
    message_id: UUID
    agent_action_id: UUID
    record_index: int
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
