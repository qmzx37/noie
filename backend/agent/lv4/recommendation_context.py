"""Lv4 추천용 외부 typed 입력입니다. DB row/ID/metadata와 Goal은 받지 않습니다."""

import re
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from .schemas import AgentOpinion, ContractModel, OpinionEvidence, Score, ShortText, SpecialistInput
from .place_context import PlaceContext
from .behavior_adapter import behavior_provenance_allowed


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


def related_relationship(item: RelationshipContext, question: str) -> bool:
    """이름 등장만으로 전달하지 않습니다. 현재 선택과 연결된 진술만 제한적으로 참고합니다."""
    # 이름의 부분 문자열(민수/민수진, 김민수)을 같은 사람으로 취급하지 않습니다.
    label = rf"(?<![\w]){re.escape(item.person_label)}(?=\s|랑|와|과|하고|만나|처럼|같이|를|을|는|은|의|에게|[.!?;,]|$)"
    clauses = re.split(r"[.!?;\n]", question)
    # 함께 할 행동/관계 선택과 의미적 참조를 구분합니다. 단순 이름 언급은 근거가 아닙니다.
    companion = rf"{label}\s*(?:랑|와|과|하고|만나)"
    topic = rf"{label}.{{0,30}}(?:관계|친구|연락|대화|이야기|화해|만날|만나)"
    meaning = rf"{label}\s*(?:처럼|같이|를\s*본받|을\s*본받)"
    relevant = any(
        re.search(r"할까|갈까|쉴까|만날까|추천|어떻게|뭐부터|어느", clause)
        and (re.search(companion, clause) or re.search(topic, clause)
             or (item.record_kind == "meaning_relation" and re.search(meaning, clause)))
        for clause in clauses
    )
    if not relevant:
        return False
    # 과거 상태를 덮는 명백한 현재 진술만 제외합니다. 추측/질문/다른 사람의 상태는 제외 사유가 아닙니다.
    if item.temporal_scope == "past":
        # 명시적 현재 긍정 사건을 과거 싸움 하나로 부정하지 않습니다. 새 관계 상태는 생성하지 않습니다.
        if item.record_kind == "observation" and re.search(r"싸웠|다퉜|갈등", item.summary):
            positive = any(re.search(label, clause) and re.search(r"오늘|지금|현재", clause)
                           and re.search(r"재미있게|즐겁게", clause) and re.search(r"보고\s*왔|만나고\s*왔", clause)
                           and not re.search(r"않|안\s|아니|모르|[?？]", clause)
                           for clause in re.split(r"[.!;\n]", question))
            if positive:
                return False
        update = r"(?:지금|현재|이제)(?:은|는)?\s*(?:잘\s*지내(?:고\s*있어|요)?|화해했어|친구가\s*아니야)"
        named_update = re.search(rf"{label}\s*(?:랑|와|과|하고|는|은)?\s*{update}\s*[.!;]|{label}\s*(?:랑|와|과|하고|는|은)?\s*{update}\s*$", question)
        # 직전 같은 대상 질문 뒤의 독립적인 '지금은 잘 지내'만 지시 대상이 명확한 보완으로 받습니다.
        followup = re.search(rf"{label}[^.!?;]*\?\s*{update}\s*(?:[.!;]|$)", question)
        if named_update or followup:
            return False
    return True


def explicit_choice_labels(question: str) -> list[str]:
    """현재 발화의 '-할까' 명시 활동 쌍만 읽습니다. 숨은 후보/승자/개인 선호를 추론하지 않습니다."""
    labels = list(dict.fromkeys(re.findall(r"([가-힣A-Za-z0-9]+)할까", question)))
    return labels if len(labels) == 2 else []


def relationship_choice(question: str) -> bool:
    """관계 선택의 이유를 검토자로 전달할 목적 표지만 검사합니다. 인물 동일성을 해결하지 않습니다."""
    return bool(re.search(r"대화|이야기|연락|만날까", question) and re.search(r"랑|와|과|사람|형|선배|친구", question))


class RecommendationContext(SpecialistInput):
    """current_utterance가 현재 user message입니다. 호출자가 필요한 자료만 골라 제공합니다."""

    evidence: list[OpinionEvidence] = Field(default_factory=list, max_length=0)
    reference_time: AwareDatetime
    state_opinion: AgentOpinion | None = None
    memories: list[MemoryContext] = Field(default_factory=list, max_length=4)
    schedules: list[ScheduleContext] = Field(default_factory=list, max_length=3)
    relationships: list[RelationshipContext] = Field(default_factory=list, max_length=3)
    places: list[PlaceContext] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_state(self) -> "RecommendationContext":
        """다른 Specialist의 의견이나 행동/다른 domain 근거를 State로 위장하지 못하게 합니다."""
        state = self.state_opinion
        # Behavior 원문은 바로 뒤의 유효한 최소 의미 관찰과 연결된 provenance만 허용합니다.
        if state is not None and (state.agent_name != "state" or state.suggested_actions or any(
            item.source_type != "state" and not behavior_provenance_allowed(item, state.evidence)
            for item in state.evidence
        )):
            raise ValueError("state_opinion에는 State의 관찰 opinion만 허용합니다.")
        return self
