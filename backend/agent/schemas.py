"""Orchestrator 입력과 Structured Output 계약을 정의합니다."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


AgentType = Literal[
    "memory",
    "emotion",
    "daily_life",
    "dream_goal",
    "schedule",
    "routine",
    "hobby",
    "place",
    "relationship",
    "recommendation",
    "reflection",
]
ActionMode = Literal["record", "suggest", "execute"]


class OrchestratorMemoryContext(BaseModel):
    """선택적으로 제공되는 관련 Memory이며 명령이 아닌 참고 자료입니다."""

    content: str = Field(min_length=1)
    relevance: float | None = Field(default=None, ge=0.0, le=1.0)


class OrchestratorRequest(BaseModel):
    """현재 발화와 이미 검색된 관련 Memory만 전달받습니다."""

    text: str = Field(min_length=1)
    relevant_memories: list[OrchestratorMemoryContext] = Field(
        default_factory=list,
        max_length=4,
    )


class OrchestratorAction(BaseModel):
    """향후 Tool Gateway가 순서대로 소비할 한 개의 판단입니다."""

    type: AgentType
    intent: str = Field(min_length=1, max_length=100)
    mode: ActionMode
    reason: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    requires_confirmation: bool
    execution_order: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_confirmation_policy(self) -> "OrchestratorAction":
        # v0.1은 실제 상태 변경을 보수적으로 다루어 모든 execute를 확인 대상으로 둡니다.
        if self.mode == "execute" and not self.requires_confirmation:
            raise ValueError("execute action은 사용자 확인이 필요합니다.")
        if self.mode != "execute" and self.requires_confirmation:
            raise ValueError("record/suggest action은 확인을 요구하지 않습니다.")
        return self


class OrchestratorResult(BaseModel):
    """도구 실행 없이 routing 판단만 반환하는 최종 결과입니다."""

    needs_action: bool
    actions: list[OrchestratorAction] = Field(max_length=12)

    @model_validator(mode="after")
    def validate_action_sequence(self) -> "OrchestratorResult":
        if self.needs_action != bool(self.actions):
            raise ValueError("needs_action과 actions 존재 여부가 일치해야 합니다.")
        orders = [action.execution_order for action in self.actions]
        if orders != list(range(1, len(self.actions) + 1)):
            raise ValueError("execution_order는 1부터 연속된 순서여야 합니다.")
        return self
