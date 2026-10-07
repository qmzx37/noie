"""Behavior는 저장된 활동 기록이 아니라 사용자 발화의 행동 의미를 표현합니다."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, StringConstraints

from resource_budget import MAX_TEXT_CHARS
from agent.lv4.schemas import ContractModel, OpinionEvidence, Score, ShortText, SpecialistInput


BehaviorStatus = Literal[
    "performed", "ongoing", "intended", "desired", "not_performed", "candidate"
]


class BehaviorContext(SpecialistInput):
    """소유권을 확인한 호출자가 원문과 Message 관찰 시점을 전달합니다."""

    current_utterance: Annotated[
        str, StringConstraints(strict=True, min_length=1, max_length=MAX_TEXT_CHARS, pattern=r"\S")
    ]
    source_message_id: UUID | None = None
    observed_at: AwareDatetime | None = None


class BehaviorObservation(ContractModel):
    """performed도 사용자 보고의 해석이지 실제 수행을 독립 검증한 사실은 아닙니다."""

    action: ShortText
    status: BehaviorStatus
    evidence: OpinionEvidence
    # 근거 없는 정밀 신뢰도나 실제 활동 시간을 만들어 넣지 않습니다.
    confidence: Score | None = None


class BehaviorAnalysis(ContractModel):
    """원문과 분리된 읽기 전용 결과입니다. 활동 시간/장소/감정 필드는 없습니다."""

    source_message_id: UUID | None = None
    behaviors: list[BehaviorObservation] = Field(default_factory=list, max_length=16)
    reason: Literal["recognized", "no_explicit_behavior", "privacy_restricted"]
