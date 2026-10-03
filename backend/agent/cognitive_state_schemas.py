"""현재 인지 상태 5축과 읽기 응답을 정의합니다. 진단이나 센서 측정값이 아닙니다."""

import math
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# null은 미언급/알 수 없음이며, 명시적으로 낮은 상태인 0과 다릅니다.
COGNITIVE_AXES = ("focus", "mental_load", "motivation", "uncertainty", "clarity")
CognitiveScore = Annotated[float, Field(ge=0.0, le=1.0, strict=True)]


class RecordCognitiveStateArguments(BaseModel):
    """현재 발화에서 직접 지지되는 축만 숫자로 받고 나머지는 None으로 보존합니다."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    focus: CognitiveScore | None = None
    mental_load: CognitiveScore | None = None
    motivation: CognitiveScore | None = None
    uncertainty: CognitiveScore | None = None
    clarity: CognitiveScore | None = None
    confidence: CognitiveScore

    @model_validator(mode="after")
    def validate_supported_axes(self) -> "RecordCognitiveStateArguments":
        """적어도 한 축이 알려져야 하며 0도 유효한 관측값입니다."""
        values = [getattr(self, axis) for axis in COGNITIVE_AXES]
        if all(value is None for value in values):
            raise ValueError("최소 하나의 인지 상태 축에 근거가 필요합니다.")
        if not all(math.isfinite(value) for value in [*values, self.confidence] if value is not None):
            raise ValueError("인지 점수와 confidence는 유한한 숫자여야 합니다.")
        return self


class CognitiveStateEventResponse(BaseModel):
    """unknown 축을 null로 그대로 반환하고 원문은 Message FK로 추적합니다."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    conversation_id: UUID | None
    message_id: UUID | None
    agent_action_id: UUID
    focus: float | None
    mental_load: float | None
    motivation: float | None
    uncertainty: float | None
    clarity: float | None
    confidence: float
    source: str
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
