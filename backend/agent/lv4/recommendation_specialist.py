"""현재 의사를 우선하는 미연결 Recommendation Specialist입니다. 저장/실행은 하지 않습니다."""

from collections.abc import Callable
from datetime import timedelta
import re

from pydantic import Field, StrictBool, model_validator

from agent.recommendation_context import recommendation_needed, related_memories
from agent.recommendation_schemas import RecommendationArguments

from .recommendation_context import RecommendationContext
from .schemas import AgentOpinion, ContractModel, OpinionEvidence, OpinionRisk, ShortText, SpecialistInput, SuggestedAction
from .specialist import SpecialistAgent


class RecommendationDecision(ContractModel):
    """기존 추천 계약과 실제 사용한 opaque 근거 참조만 반환하는 reasoning boundary입니다."""

    recommendation: RecommendationArguments | None
    used_evidence_refs: list[ShortText] = Field(default_factory=list, max_length=12)
    needs_user_input: StrictBool = False
    input_question: ShortText | None = None

    @model_validator(mode="after")
    def validate_refs(self) -> "RecommendationDecision":
        """같은 근거를 부풀려 중복 출력하지 않습니다."""
        if len(set(self.used_evidence_refs)) != len(self.used_evidence_refs):
            raise ValueError("근거 참조는 중복될 수 없습니다.")
        if self.needs_user_input and (self.recommendation is not None or self.input_question is None):
            raise ValueError("필수 정보 질문은 추천 없이 명확한 질문으로 반환해야 합니다.")
        if not self.needs_user_input and self.input_question is not None:
            raise ValueError("질문은 needs_user_input과 함께 반환해야 합니다.")
        return self


def prepare_evidence(context: RecommendationContext) -> list[OpinionEvidence]:
    """현재 질문과 관련된 소량 입력만 사용하며 전체 자료로 fallback하지 않습니다."""
    result = [OpinionEvidence(source_type="utterance", evidence_ref="current", summary=context.current_utterance)]
    now, question = context.reference_time, context.current_utterance
    activity = any(word in question for word in ("개발", "공부", "운동", "쉬", "피곤", "잠", "집중", "뭐부터", "뭘 해야", "할 일"))
    if activity and context.state_opinion is not None and context.state_opinion.result_status not in {"ERROR", "NOT_RUN"}:
        for index, item in enumerate(context.state_opinion.evidence[:3]):
            if item.observed_at is not None and now-timedelta(minutes=120) <= item.observed_at <= now and "현재 상태 종합에서 제외" not in item.summary:
                result.append(item.model_copy(update={"evidence_ref": f"state_{index}"}))
    for index, item in enumerate(related_memories(context.memories, question)):
        # 기존 retrieval의 .55 / Top-K 4는 변경하지 않습니다. 질문 주제가 없으면 개인 Memory는 제외합니다.
        if item.relevance >= 0.55 and (item.observed_at is None or item.observed_at <= now):
            result.append(OpinionEvidence(source_type="memory", evidence_ref=f"memory_{index}", summary=item.content, observed_at=item.observed_at, interpretation=True, relevance=item.relevance))
    horizon = timedelta(hours=24 if "지금" not in question and any(word in question for word in ("오늘", "내일", "하루")) else 2)
    for index, item in enumerate(context.schedules):
        if item.relevance >= 0.55 and (activity or "약속" in question or "일정" in question) and item.start_at <= now+horizon and (item.start_at >= now or (item.end_at is not None and item.end_at >= now)):
            summary = f"{item.title[:120]}; start_at={item.start_at.isoformat()}; end_at={item.end_at.isoformat() if item.end_at else 'unknown'}"
            result.append(OpinionEvidence(source_type="schedule", evidence_ref=f"schedule_{index}", summary=summary, relevance=item.relevance))
    for index, item in enumerate(context.relationships):
        if item.relevance >= 0.55 and item.person_label in question and (item.observed_at is None or item.observed_at <= now):
            result.append(OpinionEvidence(source_type="relationship", evidence_ref=f"relationship_{index}", summary=f"{item.temporal_scope}/{item.record_kind}: {item.summary[:350]}", observed_at=item.observed_at, interpretation=True, relevance=item.relevance))
    return result


class RecommendationSpecialist(SpecialistAgent):
    """판단 함수를 주입받습니다. 생성/import/등록만으로 OpenAI를 호출하지 않습니다."""

    def __init__(self, reasoner: Callable[[RecommendationContext, list[OpinionEvidence]], RecommendationDecision]) -> None:
        """테스트 fake 또는 명시적인 OpenAI adapter를 사용하며 새 prompt 판단 규칙을 복제하지 않습니다."""
        super().__init__("recommendation", "최소 관련 근거를 참고해 사용자 선택 후보를 제안")
        if not callable(reasoner):
            raise TypeError("명시적인 recommendation reasoner가 필요합니다.")
        self._reasoner = reasoner

    def _run(self, request: SpecialistInput) -> AgentOpinion:
        """불필요한 추천은 reasoning 전에 중단하고 실제 참조 근거만 opinion에 남깁니다."""
        if not isinstance(request, RecommendationContext):
            raise TypeError("RecommendationContext가 필요합니다.")
        if not recommendation_needed(request.current_utterance):
            return AgentOpinion(agent_name="recommendation", conclusion="현재 결정과 발화를 존중하며 추가 추천하지 않습니다.", confidence=None, result_status="NO_RECOMMENDATION")
        evidence = prepare_evidence(request)
        # reasoner에게도 필터링에서 제외한 원래 개인 context를 넘기지 않습니다.
        state_evidence = [item for item in evidence if item.source_type == "state"]
        state = request.state_opinion
        projected_state = None
        if state is not None and state_evidence:
            # 결론에 제외된 과거 상태가 섞였다면 원래 결론도 전송하지 않습니다.
            conclusion = state.conclusion if len(state_evidence) == len(state.evidence) else "선택된 상태 관찰만 참고하며 제외된 관찰로 현재 상태를 단정하지 않습니다."
            projected_state = AgentOpinion(agent_name="state", conclusion=conclusion, confidence=state.confidence, evidence=state_evidence, needs_user_input=state.needs_user_input, result_status=state.result_status)
        minimized = RecommendationContext(current_utterance=request.current_utterance, reference_time=request.reference_time, state_opinion=projected_state)
        available = {item.evidence_ref: item for item in evidence}
        decision = self._reasoner(minimized, list(evidence))
        if not isinstance(decision, RecommendationDecision):
            raise TypeError("RecommendationDecision이 필요합니다.")
        decision = RecommendationDecision.model_validate(decision.model_dump())
        if any(ref not in available for ref in decision.used_evidence_refs):
            raise ValueError("전달하지 않은 근거를 사용할 수 없습니다.")
        if decision.needs_user_input:
            if "current" not in decision.used_evidence_refs:
                raise ValueError("필수 정보 질문도 현재 발화에 근거해야 합니다.")
            if any(marker in decision.input_question for marker in ("무조건", "너는 항상", "반드시 해야", "이번 주 못 했으니", "그래도 개발해")):
                raise ValueError("강제 질문은 반환하지 않습니다.")
            return AgentOpinion(agent_name="recommendation", conclusion=decision.input_question, confidence=None, evidence=[available[ref] for ref in decision.used_evidence_refs], risks=[OpinionRisk(code="insufficient_context", summary="선택 제안 전에 필수 정보가 필요합니다.")], needs_user_input=True, result_status="NEEDS_INPUT")
        if decision.recommendation is None:
            return AgentOpinion(agent_name="recommendation", conclusion="현재 입력에는 추가 추천을 제시하지 않습니다.", confidence=None, result_status="NO_RECOMMENDATION")
        recommendation = decision.recommendation
        if "current" not in decision.used_evidence_refs:
            raise ValueError("추천은 현재 발화를 근거로 삼아야 합니다.")
        if any(item.source_type == "schedule" for item in evidence) and not any(available[ref].source_type == "schedule" for ref in decision.used_evidence_refs):
            raise ValueError("명확한 관련 일정 제약을 누락한 추천입니다.")
        text = " ".join(value for value in (recommendation.primary_action, recommendation.alternative_action, recommendation.rationale) if value)
        # 명백한 강제 표현의 보수적 방어선일 뿐 모든 자연어 의미를 검증하는 Critic은 아닙니다.
        if any(marker in text for marker in ("무조건", "너는 항상", "반드시 해야", "이번 주 못 했으니", "그래도 개발해")):
            raise ValueError("강제/죄책감 기반 추천은 반환하지 않습니다.")
        choices = [recommendation.primary_action] + ([recommendation.alternative_action] if recommendation.alternative_action else [])
        # 명시적 숫자 시간만 보수적으로 검증합니다. 이동시간이나 언급되지 않은 작업 소요는 추론하지 않습니다.
        upcoming = [item for item in request.schedules if item.start_at > request.reference_time and any(e.summary.startswith(item.title[:120] + ";") for e in evidence if e.source_type == "schedule")]
        if upcoming:
            available_seconds = min((item.start_at-request.reference_time).total_seconds() for item in upcoming)
            for choice in choices:
                stated_seconds = sum(int(number)*(3600 if unit == "시간" else 60) for number, unit in re.findall(r"(\d+)\s*(시간|분)", choice))
                if stated_seconds > available_seconds:
                    raise ValueError("명시된 제안 시간이 가까운 일정 시작을 초과합니다.")
        used = [available[ref] for ref in decision.used_evidence_refs]
        risks = []
        if any(item.source_type in {"memory", "relationship"} for item in used):
            risks.append(OpinionRisk(code="historical_evidence", summary="과거 해석/사용자 진술은 참고 근거이며 현재 사실이나 상대 의도의 확정이 아닙니다."))
        if request.state_opinion is not None and request.state_opinion.result_status == "NEEDS_INPUT":
            risks.append(OpinionRisk(code="partial_state", summary="상태 관찰이 일부 부족합니다. 누락된 상태를 추론하지 않습니다."))
        if len(used) == 1:
            risks.append(OpinionRisk(code="limited_context", summary="개인 근거 없이 현재 발화만 참고한 제안입니다."))
        return AgentOpinion(
            agent_name="recommendation", conclusion=recommendation.primary_action, confidence=recommendation.confidence,
            evidence=used, risks=risks, suggested_actions=[SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="suggest", summary=choice) for choice in choices],
        )
