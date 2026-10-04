"""Lv4 추천용 외부 typed 입력입니다. DB row/ID/metadata와 Goal은 받지 않습니다."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from .schemas import AgentOpinion, ContractModel, OpinionEvidence, Score, ShortText, SpecialistInput


class MemoryContext(ContractModel):
    """기존 SelectedMemory의 content/relevance만 최소화하고 식별자는 공유하지 않습니다."""

    content: ShortText
    relevance: Score
    confidence: Score | None = None
    observed_at: AwareDatetime | None = None


class ScheduleContext(ContractModel):
    """호출자가 선택한 명확한 일정 제약입니다. 이동시간을 추측하지 않습니다."""

    title: ShortText
    start_at: AwareDatetime
    end_at: AwareDatetime | None = None
    relevance: Score

    @model_validator(mode="after")
    def validate_time(self) -> "ScheduleContext":
        """기존 일정의 시작/종료 관계를 유지합니다."""
        if self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at은 start_at 이후여야 합니다.")
        return self


class RelationshipContext(ContractModel):
    """현재 관계 정답이 아니라 관련된 사용자 진술 근거입니다."""

    person_label: Annotated[str, Field(strict=True, min_length=1, max_length=120, pattern=r"\S")]
    summary: ShortText
    record_kind: Literal["social_relation", "relationship_state", "meaning_relation", "observation"]
    temporal_scope: Literal["past", "current"]
    confidence: Score | None = None
    relevance: Score
    observed_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_label(self) -> "RelationshipContext":
        """적어도 명시된 대상 근거만 받으며 identity resolution은 하지 않습니다."""
        if self.person_label not in self.summary or self.person_label.strip() in {"걔", "그 사람", "누군가"}:
            raise ValueError("식별 가능한 person_label이 근거에 있어야 합니다.")
        return self


class RecommendationContext(SpecialistInput):
    """current_utterance가 현재 user message입니다. 호출자가 필요한 자료만 골라 제공합니다."""

    evidence: list[OpinionEvidence] = Field(default_factory=list, max_length=0)
    reference_time: AwareDatetime
    state_opinion: AgentOpinion | None = None
    memories: list[MemoryContext] = Field(default_factory=list, max_length=4)
    schedules: list[ScheduleContext] = Field(default_factory=list, max_length=3)
    relationships: list[RelationshipContext] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_state(self) -> "RecommendationContext":
        """다른 Specialist의 의견이나 행동/다른 domain 근거를 State로 위장하지 못하게 합니다."""
        state = self.state_opinion
        if state is not None and (state.agent_name != "state" or state.suggested_actions or any(item.source_type != "state" for item in state.evidence)):
            raise ValueError("state_opinion에는 State의 관찰 opinion만 허용합니다.")
        return self
