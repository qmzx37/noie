"""미연결 협업의 최소 입출력 계약입니다. 기존 상태/제약 schema를 재사용합니다."""

from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from .critic_context import CriticConstraints
from .schemas import AgentOpinion, ContractModel, ShortText
from .state_context import StateContext

STAGES = ("state", "recommendation", "critic", "arbitrator")
Stage = Literal["state", "recommendation", "critic", "arbitrator"]


class Lv4CollaborationContext(ContractModel):
    """상태는 기존 StateContext, 개인 제약은 기존 bounded CriticConstraints로 받습니다."""

    current_utterance: ShortText
    reference_time: AwareDatetime
    state_context: StateContext
    relevant_constraints: CriticConstraints = Field(default_factory=CriticConstraints)

    @model_validator(mode="after")
    def validate_reference_time(self) -> "Lv4CollaborationContext":
        """단계별 기준 시각이 달라지지 않게 하며 관찰 시각 자체는 수정하지 않습니다."""
        if self.state_context.as_of != self.reference_time:
            raise ValueError("state_context.as_of와 reference_time은 같은 시각이어야 합니다.")
        return self


class Lv4CollaborationResult(ContractModel):
    """이전 실제 opinion만 보존합니다. 실패 단계/이유에 예외 문자열이나 내부 객체는 없습니다."""

    state_opinion: AgentOpinion | None = None
    recommendation_opinion: AgentOpinion | None = None
    critic_opinion: AgentOpinion | None = None
    arbitrator_opinion: AgentOpinion | None = None
    pipeline_status: Literal["COMPLETED", "FAILED"]
    failed_stage: Stage | None = None
    failure_kind: Literal["exception", "reported_failure"] | None = None

    @model_validator(mode="after")
    def validate_sequence(self) -> "Lv4CollaborationResult":
        """실패 뒤 의견이나 가짜 완료를 허용하지 않고 단계 이름도 다시 확인합니다."""
        opinions = [getattr(self, name + "_opinion") for name in STAGES]
        for name, opinion in zip(STAGES, opinions):
            if opinion is not None and opinion.agent_name != name:
                raise ValueError("opinion 역할이 단계 이름과 일치해야 합니다.")
        if self.pipeline_status == "COMPLETED":
            if self.failed_stage is not None or self.failure_kind is not None or any(item is None or item.result_status in {"ERROR", "NOT_RUN"} for item in opinions):
                raise ValueError("완료 결과는 실패 정보 없이 네 실제 opinion이 필요합니다.")
        else:
            if self.failed_stage is None or self.failure_kind is None:
                raise ValueError("실패 결과는 단계와 안전한 failure_kind가 필요합니다.")
            index = STAGES.index(self.failed_stage)
            if any(item is None or item.result_status in {"ERROR", "NOT_RUN"} for item in opinions[:index]) or any(item is not None for item in opinions[index+1:]):
                raise ValueError("이전 성공 의견만 보존하고 실패 이후 단계는 비워야 합니다.")
            failed = opinions[index]
            if self.failure_kind == "exception" and failed is not None:
                raise ValueError("예외 단계의 opinion을 만들어내지 않습니다.")
            if self.failure_kind == "reported_failure" and (failed is None or failed.result_status not in {"ERROR", "NOT_RUN"}):
                raise ValueError("reported_failure는 실제 오류/미실행 opinion이 필요합니다.")
        return self
