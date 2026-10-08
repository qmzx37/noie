"""State Agent v0.1: 관찰을 나란히 정리하며 원인/성격/행동을 추론하지 않습니다."""

import json

from .schemas import AgentOpinion, OpinionEvidence, OpinionRisk, SpecialistInput
from .specialist import SpecialistAgent
from .state_context import StateContext


# 독립 축을 일관된 순서로 출력합니다. 합산 점수나 다른 domain 축 변환은 없습니다.
AXES = {
    "emotion": ("F", "A", "D", "J", "C", "G", "T", "R"),
    "body": ("fatigue", "sleepiness", "energy", "hunger", "physical_tension", "discomfort"),
    "cognitive": ("focus", "mental_load", "motivation", "uncertainty", "clarity"),
}
LABELS = {
    "F": "공포", "A": "분노", "D": "우울", "J": "기쁨", "C": "호기심", "G": "욕구", "T": "긴장", "R": "안정",
    "fatigue": "피로", "sleepiness": "졸림", "energy": "신체 에너지", "hunger": "허기",
    "physical_tension": "신체 긴장", "discomfort": "불편감", "focus": "집중", "mental_load": "인지 부담",
    "motivation": "동기", "uncertainty": "불확실성", "clarity": "명료함",
}


class StateSpecialist(SpecialistAgent):
    """외부에서 선택한 typed state만 읽습니다. registry 자동 등록은 하지 않습니다."""

    def __init__(self) -> None:
        """기존 Specialist 계약에 고정된 state 이름으로 참여합니다."""
        super().__init__("state", "전달된 Emotion/Body/Cognitive 관찰을 독립적으로 종합")

    def _run(self, request: SpecialistInput) -> AgentOpinion:
        """신선도 불명/오래된/미래 관찰을 구분하고 사용 가능한 근거만 confidence에 반영합니다."""
        if not isinstance(request, StateContext):
            raise TypeError("StateSpecialist는 StateContext가 필요합니다.")
        evidence, risks, parts, confidences, times = [], [], [], [], []
        unavailable, stale, future, undated = [], [], [], []
        for domain, axes in AXES.items():
            observation = getattr(request, domain)
            values = {} if observation is None else {
                axis: getattr(observation, axis) for axis in axes if getattr(observation, axis) is not None
            }
            if not values:
                unavailable.append(domain)
                continue
            when = observation.observed_at
            age = None if when is None else (request.as_of - when).total_seconds()
            excluded = False
            if age is not None and age < 0:
                future.append(domain)
                excluded = True
            elif age is not None and request.max_age_seconds is not None and age > request.max_age_seconds:
                stale.append(domain)
                excluded = True
            elif when is None:
                undated.append(domain)
            if when is not None:
                times.append(when)
            # 숫자와 unknown은 다른 축으로 옮기지 않으며 기존 관찰의 정확한 값은 evidence에 남깁니다.
            summary = f"{domain}: " + ", ".join(f"{axis}={value}" for axis, value in values.items())
            if domain == "emotion" and observation.dominant_emotion is not None:
                summary += f"; dominant_emotion={observation.dominant_emotion}"
            if excluded:
                summary += "; 현재 상태 종합에서 제외"
            evidence.append(OpinionEvidence(source_type="state", evidence_ref=domain, summary=summary, observed_at=when, interpretation=True))
            if excluded:
                continue
            # Low/Mid/High의 기존 경계를 설명용으로만 사용합니다. 상태 간 원인/활동 능력을 확정하지 않습니다.
            parts.append(", ".join(f"{LABELS[axis]} {'높음' if value >= 0.7 else '중간' if value >= 0.4 else '낮음'}" for axis, value in values.items()))
            confidences.append(observation.confidence)

        usable_behaviors = 0
        for index, observation in enumerate(request.behaviors):
            # 원문 provenance는 내부에 보존하고 추천 모델에는 별도의 최소 의미만 전달합니다.
            source = observation.evidence
            when = source.observed_at
            age = None if when is None else (request.as_of - when).total_seconds()
            excluded = False
            if age is not None and age < 0:
                future.append(f"behavior_{index}")
                excluded = True
            elif age is not None and request.max_age_seconds is not None and age > request.max_age_seconds:
                stale.append(f"behavior_{index}")
                excluded = True
            elif when is None:
                undated.append(f"behavior_{index}")
            if when is not None:
                times.append(when)
            fields = {"action": observation.action, "status": observation.status}
            if observation.confidence is not None:
                fields["confidence"] = observation.confidence
            summary = "behavior: " + json.dumps(fields, ensure_ascii=False)
            if excluded:
                summary += "; 현재 상태 종합에서 제외"
            evidence.extend([source, OpinionEvidence(
                source_type="state", evidence_ref=f"behavior_{index}", summary=summary,
                observed_at=when, interpretation=True,
            )])
            if not excluded:
                usable_behaviors += 1
                confidences.append(observation.confidence)
        if usable_behaviors:
            parts.append(f"사용자 보고 행동 {usable_behaviors}개(현실 수행 검증 아님)")

        if unavailable:
            risks.append(OpinionRisk(code="partial_context", summary="관찰 정보 없음: " + ", ".join(unavailable)))
        if stale:
            risks.append(OpinionRisk(code="stale_observation", summary="호출자가 지정한 유효 창 초과: " + ", ".join(stale)))
        if future:
            risks.append(OpinionRisk(code="future_observation", summary="기준 시각 이후 관찰 제외: " + ", ".join(future)))
        if undated:
            risks.append(OpinionRisk(code="unknown_observation_time", summary="관찰 시각 미상: " + ", ".join(undated)))
        if len(set(times)) > 1:
            span = (max(times) - min(times)).total_seconds()
            risks.append(OpinionRisk(code="different_observation_times", summary=f"관찰 시점 차이 {span:g}초. 같은 순간의 상태로 확정하지 않음."))
        if parts and request.max_age_seconds is None:
            risks.append(OpinionRisk(code="freshness_unverified", summary="유효 시간 기준이 없어 최신성을 보장하지 않음."))
        if not parts:
            risks.append(OpinionRisk(code="insufficient_context", summary="종합에 사용할 상태 관찰이 없습니다."))
        # 사용된 confidence의 최솟값. 하나라도 unknown이면 전체 confidence도 unknown을 유지합니다.
        confidence = min(confidences) if confidences and all(value is not None for value in confidences) else None
        partial = bool(unavailable or stale or future or undated) or not parts
        return AgentOpinion(
            agent_name="state", conclusion="전달된 관찰(현재성 보장 아님): " + "; ".join(parts) if parts else "상태 정보가 부족해 종합할 수 없습니다.",
            confidence=confidence, evidence=evidence, risks=risks, suggested_actions=[],
            needs_user_input=partial, result_status="NEEDS_INPUT" if partial else "OK",
        )
