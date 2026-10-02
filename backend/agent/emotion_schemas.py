"""record_emotion Tool 전용 입력 계약입니다."""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EmotionRecordArguments(BaseModel):
    """한 시점의 감정 관측값만 표현하며 장기 성향을 의미하지 않습니다."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    F: float = Field(ge=0.0, le=1.0)
    A: float = Field(ge=0.0, le=1.0)
    D: float = Field(ge=0.0, le=1.0)
    J: float = Field(ge=0.0, le=1.0)
    C: float = Field(ge=0.0, le=1.0)
    G: float = Field(ge=0.0, le=1.0)
    T: float = Field(ge=0.0, le=1.0)
    R: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def reject_non_finite_values(self) -> "EmotionRecordArguments":
        if not all(math.isfinite(value) for value in self.model_dump().values()):
            raise ValueError("감정 점수와 confidence는 유한한 숫자여야 합니다.")
        return self
