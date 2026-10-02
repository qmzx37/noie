"""record_dream_goal Tool의 장기 꿈/목표 입력 계약입니다."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DreamGoalArguments(BaseModel):
    """사용자가 현재 직접 선언한 꿈 또는 목표만 받습니다."""

    model_config = ConfigDict(extra="forbid")

    statement: str = Field(min_length=1, max_length=300)
    kind: Literal["dream", "goal"]
