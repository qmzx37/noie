"""이미 분석된 상태의 최소 입력입니다. DB row/ID/metadata는 받지 않습니다."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from .schemas import ContractModel, OpinionEvidence, Score, SpecialistInput


class StateObservation(ContractModel):
    """미상 confidence/시각은 None이며 관찰 숫자 0과 혼동하지 않습니다."""

    confidence: Score | None = None
    observed_at: AwareDatetime | None = None


class EmotionState(StateObservation):
    """기존 EmotionRecordArguments의 8축을 유지합니다. 새 감정 추출을 하지 않습니다."""

    F: Score
    A: Score
    D: Score
    J: Score
    C: Score
    G: Score
    T: Score
    R: Score
    dominant_emotion: Literal["F", "A", "D", "J", "C", "G", "T", "R"] | None = None


class BodyState(StateObservation):
    """기존 Body 축 이름을 그대로 쓰며 누락을 0으로 채우지 않습니다."""

    fatigue: Score | None = None
    sleepiness: Score | None = None
    energy: Score | None = None
    hunger: Score | None = None
    physical_tension: Score | None = None
    discomfort: Score | None = None


class CognitiveState(StateObservation):
    """독립 Cognitive 축은 높고 낮음이 함께 존재할 수 있습니다."""

    focus: Score | None = None
    mental_load: Score | None = None
    motivation: Score | None = None
    uncertainty: Score | None = None
    clarity: Score | None = None


class StateContext(SpecialistInput):
    """호출 시각과 선택적 유효 창도 외부에서 전달해 테스트/판단을 결정론적으로 만듭니다."""

    # Phase 1 공통 입력 호환 필드입니다. 발화를 재분석하거나 다른 domain evidence를 사용하지 않습니다.
    current_utterance: Literal["state observations"] = "state observations"
    evidence: list[OpinionEvidence] = Field(default_factory=list, max_length=0)
    as_of: AwareDatetime
    max_age_seconds: Annotated[int, Field(strict=True, gt=0)] | None = None
    emotion: EmotionState | None = None
    body: BodyState | None = None
    cognitive: CognitiveState | None = None
