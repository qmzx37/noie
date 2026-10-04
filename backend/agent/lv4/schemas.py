"""개인 context dump 없이 짧은 결론과 근거를 전달하는 Lv4 계약입니다."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator

Name = Annotated[str, StringConstraints(strict=True, pattern=r"^[a-z][a-z0-9_]{0,63}$")]
ShortText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=500, pattern=r"\S")]
Score = Annotated[float, Field(strict=True, ge=0.0, le=1.0, allow_inf_nan=False)]


class ContractModel(BaseModel):
    """모든 중첩 객체에도 미정의 필드와 비유한 숫자를 허용하지 않습니다."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)


class OpinionEvidence(ContractModel):
    """DB row 대신 출처와 최소 근거를 전달합니다. 소유권 확인은 후속 adapter 책임입니다."""

    source_type: Literal["utterance", "state", "memory", "schedule", "relationship", "place", "opinion"]
    summary: ShortText
    evidence_ref: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=100, pattern=r"\S")] | None = None
    observed_at: AwareDatetime | None = None
    interpretation: StrictBool = False
    relevance: Score | None = None


class OpinionRisk(ContractModel):
    """검토할 위험을 표현하며 위험의 존재 자체를 사실로 확정하지 않습니다."""

    code: Name
    summary: ShortText


class SuggestedAction(ContractModel):
    """실행 가능한 Tool payload가 아닌 후보입니다. 실행 권한/ID/임의 인자는 없습니다."""

    type: Name
    intent: Name
    mode: Literal["record", "suggest", "execute"]
    summary: ShortText


class SpecialistInput(ContractModel):
    """호출자가 선택한 최소 발화/근거만 받으며 context를 직접 조회하지 않습니다."""

    current_utterance: ShortText
    evidence: list[OpinionEvidence] = Field(default_factory=list, max_length=16)


class AgentOpinion(ContractModel):
    """의견은 원문 사실이나 실행 결과가 아니며 confidence=None은 unknown입니다."""

    agent_name: Name
    conclusion: ShortText
    confidence: Score | None
    evidence: list[OpinionEvidence] = Field(default_factory=list, max_length=16)
    risks: list[OpinionRisk] = Field(default_factory=list, max_length=8)
    suggested_actions: list[SuggestedAction] = Field(default_factory=list, max_length=4)
    needs_user_input: StrictBool = False
    result_status: Literal["OK", "NO_RECOMMENDATION", "NEEDS_INPUT", "NOT_RUN", "ERROR"] = "OK"

    @model_validator(mode="after")
    def validate_status(self) -> "AgentOpinion":
        """미실행/실패/무추천 결과에 행동 후보를 섞어 성공처럼 보이지 않게 합니다."""
        if self.result_status in {"NO_RECOMMENDATION", "NOT_RUN", "ERROR"} and self.suggested_actions:
            raise ValueError("이 결과 상태에서는 행동 후보를 반환할 수 없습니다.")
        if self.result_status == "NEEDS_INPUT" and not self.needs_user_input:
            raise ValueError("NEEDS_INPUT은 needs_user_input=True가 필요합니다.")
        return self
