"""Arbitrator에 전달할 최소 의견 계약입니다. DB/전체 context를 받지 않습니다."""

from pydantic import AwareDatetime, Field, model_validator

from .schemas import AgentOpinion, OpinionEvidence, SpecialistInput


class ArbitratorContext(SpecialistInput):
    """현재 발화와 역할별 의견만 읽으며 입력을 저장하거나 조회하지 않습니다."""

    evidence: list[OpinionEvidence] = Field(default_factory=list, max_length=0)
    state_opinion: AgentOpinion | None = None
    recommendation_opinion: AgentOpinion | None = None
    critic_opinion: AgentOpinion | None = None
    reference_time: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_role_names(self) -> "ArbitratorContext":
        """이름 검사는 연결 계약일 뿐 의견 내용이 옳다는 보증은 아닙니다."""
        for name in ("state", "recommendation", "critic"):
            opinion = getattr(self, name + "_opinion")
            if opinion is not None and opinion.agent_name != name:
                raise ValueError(f"{name} opinion 이름이 일치해야 합니다.")
        return self
