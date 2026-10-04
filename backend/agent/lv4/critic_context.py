"""검토자가 외부에서 받은 최소 opinion/제약입니다. DB/context loader는 없습니다."""

from pydantic import AwareDatetime, Field, model_validator

from .recommendation_context import MemoryContext, RelationshipContext, ScheduleContext
from .schemas import AgentOpinion, ContractModel, OpinionEvidence, SpecialistInput


class CriticConstraints(ContractModel):
    """Phase 3의 최소 typed 제약만 재사용합니다. 전체 DB row/metadata를 받지 않습니다."""

    memories: list[MemoryContext] = Field(default_factory=list, max_length=4)
    schedules: list[ScheduleContext] = Field(default_factory=list, max_length=3)
    relationships: list[RelationshipContext] = Field(default_factory=list, max_length=3)


class CriticContext(SpecialistInput):
    """current_utterance가 현재 사용자 문장입니다. opinion은 복사 검증 후 읽기만 합니다."""

    evidence: list[OpinionEvidence] = Field(default_factory=list, max_length=0)
    state_opinion: AgentOpinion | None = None
    recommendation_opinion: AgentOpinion | None = None
    relevant_constraints: CriticConstraints = Field(default_factory=CriticConstraints)
    reference_time: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_role_names(self) -> "CriticContext":
        """다른 역할의 opinion을 State/Recommendation으로 잘못 연결하지 않습니다."""
        for expected, opinion in (("state", self.state_opinion), ("recommendation", self.recommendation_opinion)):
            if opinion is not None and opinion.agent_name != expected:
                raise ValueError(f"{expected} opinion 이름이 일치해야 합니다.")
        return self
