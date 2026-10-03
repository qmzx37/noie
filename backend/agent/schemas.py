"""Orchestrator 입력과 Structured Output 계약을 정의합니다."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from agent.emotion_schemas import EmotionRecordArguments
from agent.daily_life_schemas import DailyTraceArguments
from agent.dream_goal_schemas import DreamGoalArguments
from agent.schedule_schemas import CreateScheduleArguments
from agent.place_schemas import RecordPlaceEventArguments
from agent.body_state_schemas import RecordBodyStateArguments
# Cognitive 인자는 기존 도메인과 합치지 않고 별도 검증합니다.
from agent.cognitive_state_schemas import COGNITIVE_AXES, RecordCognitiveStateArguments
from agent.recommendation_schemas import RecommendationArguments


AgentType = Literal[
    "memory",
    "emotion",
    "body_state",
    "cognitive_state",
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
    # Place 인자는 기존 도메인 계약을 변경하지 않고 선택지에만 추가합니다.
    arguments: EmotionRecordArguments | DailyTraceArguments | DreamGoalArguments | CreateScheduleArguments | RecordPlaceEventArguments | RecordBodyStateArguments | RecordCognitiveStateArguments | RecommendationArguments | None = None

    @model_validator(mode="after")
    def validate_confirmation_policy(self) -> "OrchestratorAction":
        # 추천은 Suggest만 허용하고 routing/내용 중 낮은 신뢰도로 판단합니다.
        if self.intent == "suggest_recommendation":
            if self.type != "recommendation" or self.mode != "suggest" or not isinstance(self.arguments, RecommendationArguments):
                raise ValueError("suggest_recommendation에는 Suggest 추천 인자가 필요합니다.")
            self.confidence = min(self.confidence, self.arguments.confidence)
        elif isinstance(self.arguments, RecommendationArguments):
            raise ValueError("추천 인자는 suggest_recommendation에서만 사용합니다.")
        # v0.1은 실제 상태 변경을 보수적으로 다루어 모든 execute를 확인 대상으로 둡니다.
        if self.mode == "execute" and not self.requires_confirmation:
            raise ValueError("execute action은 사용자 확인이 필요합니다.")
        if self.mode != "execute" and self.requires_confirmation:
            raise ValueError("record/suggest action은 확인을 요구하지 않습니다.")
        is_emotion_record = self.type == "emotion" and self.mode == "record"
        is_daily_record = self.type == "daily_life" and self.mode == "record"
        is_dream_record = self.type == "dream_goal" and self.mode == "record" and self.intent == "record_dream_goal"
        is_schedule_create = self.type == "schedule" and self.mode == "execute" and self.intent == "create_schedule"
        is_place_record = self.type == "place" and self.mode == "record" and self.intent == "record_place_event"
        is_body_record = self.type == "body_state" and self.mode == "record" and self.intent == "record_body_state"
        # routing과 축 해석 중 낮은 신뢰도로 과신을 방지합니다.
        is_cognitive_record = self.type == "cognitive_state" and self.mode == "record" and self.intent == "record_cognitive_state"
        if is_cognitive_record:
            if not isinstance(self.arguments, RecordCognitiveStateArguments):
                raise ValueError("record_cognitive_state에는 근거 있는 5축 arguments가 필요합니다.")
            self.confidence = min(self.confidence, self.arguments.confidence)
        if is_body_record:
            if not isinstance(self.arguments, RecordBodyStateArguments):
                raise ValueError("record_body_state에는 근거 있는 6축 arguments가 필요합니다.")
            # routing과 축 해석 중 낮은 신뢰도를 사용해 과신을 방지합니다.
            self.confidence = min(self.confidence, self.arguments.confidence)
        if is_place_record and not isinstance(self.arguments, RecordPlaceEventArguments):
            raise ValueError("record_place_event에는 명시적 장소 arguments가 필요합니다.")
        # 시각 불명확 후보는 null로 보류하지만 다른 Tool의 인자는 허용하지 않습니다.
        if is_schedule_create and self.arguments is not None and not isinstance(self.arguments, CreateScheduleArguments):
            raise ValueError("create_schedule arguments 형식이 올바르지 않습니다.")
        if is_emotion_record and self.arguments is None:
            raise ValueError("emotion record action에는 8축 arguments가 필요합니다.")
        if is_daily_record and not isinstance(self.arguments, DailyTraceArguments):
            raise ValueError("daily_life record action에는 사실 중심 arguments가 필요합니다.")
        if is_dream_record and not isinstance(self.arguments, DreamGoalArguments):
            raise ValueError("record_dream_goal action에는 statement와 kind가 필요합니다.")
        if is_emotion_record and not isinstance(self.arguments, EmotionRecordArguments):
            raise ValueError("emotion arguments 형식이 올바르지 않습니다.")
        if not (is_emotion_record or is_daily_record or is_dream_record or is_schedule_create or is_place_record or is_body_record or is_cognitive_record or self.intent == "suggest_recommendation") and self.arguments is not None:
            raise ValueError("arguments는 구현된 record action에서만 사용할 수 있습니다.")
        return self


class OrchestratorResult(BaseModel):
    """도구 실행 없이 routing 판단만 반환하는 최종 결과입니다."""

    needs_action: bool
    actions: list[OrchestratorAction] = Field(max_length=12)

    @model_validator(mode="after")
    def validate_action_sequence(self) -> "OrchestratorResult":
        # 한 요청은 한 주 추천/한 대안만 가집니다. 여러 추천을 임의로 병합하지 않습니다.
        if sum(action.intent == "suggest_recommendation" for action in self.actions) > 1:
            raise ValueError("한 발화에는 추천 action이 최대 하나입니다.")
        if self.needs_action != bool(self.actions):
            raise ValueError("needs_action과 actions 존재 여부가 일치해야 합니다.")
        orders = [action.execution_order for action in self.actions]
        if orders != list(range(1, len(self.actions) + 1)):
            raise ValueError("execution_order는 1부터 연속된 순서여야 합니다.")
        # 한 발화의 현재 인지 벡터를 축별 action으로 중복 저장하지 않습니다.
        # Message/Memory를 비교하거나 병합하는 것이 아니라 이번 출력 계약만 정규화합니다.
        cognitive = [action for action in self.actions if action.type == "cognitive_state"
                     and action.intent == "record_cognitive_state" and action.mode == "record"]
        if len(cognitive) > 1:
            known = {axis: None for axis in COGNITIVE_AXES}
            for action in cognitive:
                for axis in COGNITIVE_AXES:
                    value = getattr(action.arguments, axis)
                    # 충돌한 점수를 선택/평균내면 해석을 조작하므로 명시적으로 거부합니다.
                    if value is not None and known[axis] is not None and value != known[axis]:
                        raise ValueError(f"동일 발화의 Cognitive {axis} 점수가 서로 충돌합니다.")
                    if value is not None:
                        known[axis] = value
            arguments = RecordCognitiveStateArguments(
                **known, confidence=min(action.arguments.confidence for action in cognitive),
            )
            combined = cognitive[0].model_copy(update={
                "arguments": arguments,
                "confidence": min(action.confidence for action in cognitive),
                "reason": "; ".join(action.reason for action in cognitive),
            })
            # 다른 도메인 필드는 그대로 보존하고 제거된 중복 뒤의 순서만 연속 정리합니다.
            remaining = [combined if action is cognitive[0] else action
                         for action in self.actions if not any(action is extra for extra in cognitive[1:])]
            self.actions = [action.model_copy(update={"execution_order": index})
                            for index, action in enumerate(remaining, 1)]
        return self
