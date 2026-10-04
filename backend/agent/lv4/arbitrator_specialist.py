"""미연결 결정론적 조정자입니다. 새 위험 탐지/추천 생성/Tool 실행은 하지 않습니다."""

import re

from .arbitrator_context import ArbitratorContext
from .schemas import AgentOpinion, OpinionEvidence, OpinionRisk, SpecialistInput, SuggestedAction
from .specialist import SpecialistAgent


def _settled_intent(text: str) -> bool:
    """명시적 확정/추천 거부를 우선합니다. 뒤의 재고 질문이 있으면 확정으로 보지 않습니다."""
    compact = re.sub(r"\s+", "", text)
    if any(word in compact for word in ("추천하지마", "추천필요없", "추천은필요없")):
        return True
    decisions = list(re.finditer(r"할래|갈래|쉴래|할게|갈게|쉴게|쉬겠|잘거야|기로했|결정했|오늘은쉰다", compact))
    questions = list(re.finditer(r"할까|갈까|쉴까|추천해|뭐부터|골라줘|결정하지않|기로하지않", compact))
    return bool(decisions and (not questions or decisions[-1].start() > questions[-1].start()))


class ArbitratorSpecialist(SpecialistAgent):
    """기존 후보와 검토 결과를 조정합니다. 등록은 호출자가 명시적으로 수행합니다."""

    def __init__(self) -> None:
        """Phase 1의 입출력/registry 계약을 그대로 사용합니다."""
        super().__init__("arbitrator", "현재 사용자 의사를 우선해 Specialist 의견을 조정")

    def _run(self, request: SpecialistInput) -> AgentOpinion:
        """선택 후보만 반환합니다. confidence는 사용한 의견의 최솟값에만 기반합니다."""
        if not isinstance(request, ArbitratorContext):
            raise TypeError("ArbitratorContext가 필요합니다.")
        state, rec, critic = request.state_opinion, request.recommendation_opinion, request.critic_opinion
        evidence = [OpinionEvidence(source_type="utterance", evidence_ref="current", summary=request.current_utterance)]
        risks, used, choices = [], [], []

        def use(opinion: AgentOpinion, sources: list[OpinionEvidence]) -> None:
            """실제로 참고한 근거만 중복 없이 한도 내 남기며 결론을 사실 근거로 바꾸지 않습니다."""
            if opinion not in used:
                used.append(opinion)
            for item in sources:
                key = (item.source_type, item.summary, item.observed_at)
                if not any((existing.source_type, existing.summary, existing.observed_at) == key for existing in evidence) and len(evidence) < 16:
                    evidence.append(item)

        def risk(code: str, summary: str) -> None:
            """미해결 충돌만 구조화하며 많은 risk도 공통 한도에서 명시적으로 요약합니다."""
            if not any(item.code == code for item in risks):
                risks.append(OpinionRisk(code=code, summary=summary))

        def finish(conclusion: str, status: str = "OK", material_conflict: bool = False) -> AgentOpinion:
            """unknown은 None, 알려진 값은 min, 중요한 미해결 충돌은 min의 절반입니다."""
            scores = [opinion.confidence for opinion in used]
            confidence = min(scores) if scores and all(value is not None for value in scores) else None
            if confidence is not None and material_conflict:
                confidence *= 0.5
            bounded_risks = risks if len(risks) <= 8 else risks[:7] + [OpinionRisk(code="additional_concerns", summary=", ".join(item.code for item in risks[7:]))]
            return AgentOpinion(agent_name="arbitrator", conclusion=conclusion, confidence=confidence, evidence=evidence, risks=bounded_risks, suggested_actions=choices, needs_user_input=status == "NEEDS_INPUT", result_status=status)

        # 다수결/과거 목표/critic confidence로 현재 확정 의사를 뒤집지 않습니다.
        if _settled_intent(request.current_utterance):
            return finish("현재 말씀하신 결정을 존중하며 추가 행동을 제안하지 않습니다.", "NO_RECOMMENDATION")
        if rec is None or rec.result_status in {"ERROR", "NOT_RUN"}:
            risk("recommendation_unavailable", "조정할 추천 의견이 없습니다. 상태나 검토만으로 새 행동을 만들지 않습니다.")
            return finish("어떤 선택을 조정할지 필요한 의견을 확인해볼까요?", "NEEDS_INPUT")
        if rec.result_status == "NO_RECOMMENDATION":
            use(rec, [])
            return finish("추가 추천 없이 현재 선택권을 유지합니다.", "NO_RECOMMENDATION")
        if rec.result_status == "NEEDS_INPUT" or rec.needs_user_input:
            use(rec, rec.evidence)
            risk("required_input", "추천 의견이 선택에 꼭 필요한 추가 정보를 요청했습니다.")
            return finish("추천을 조정하기 전에 필요한 정보를 확인해볼까요?", "NEEDS_INPUT")

        # Agent 이름/높은 confidence만으로 후보를 승인하지 않습니다.
        if not any(item.source_type == "utterance" and item.summary == request.current_utterance for item in rec.evidence):
            risk("current_evidence_missing", "현재 발화와 일치하는 추천 근거가 없습니다.")
            return finish("현재 질문에 연결된 추천 근거를 확인해볼까요?", "NEEDS_INPUT")
        use(rec, [item for item in rec.evidence if item.source_type == "utterance"])
        if state is not None and state.result_status not in {"ERROR", "NOT_RUN"} and any(item.source_type == "state" for item in rec.evidence):
            # 추천이 실제 참조한 현재 관찰만 사용합니다. State 결론을 새 원인으로 쓰지 않습니다.
            sources = [item for item in rec.evidence if item.source_type == "state" and any(item.summary == source.summary and item.observed_at == source.observed_at for source in state.evidence) and "현재 상태 종합에서 제외" not in item.summary and (request.reference_time is None or item.observed_at is None or item.observed_at <= request.reference_time)]
            if sources:
                use(state, sources)
                if state.confidence is None or state.result_status == "NEEDS_INPUT":
                    risk("partial_state", "참고한 상태가 부분적이거나 confidence가 unknown입니다. 누락을 채우지 않습니다.")

        # Critic의 주장도 검토 근거가 있어야 사용합니다. ERROR/NOT_RUN은 veto가 아닙니다.
        review_codes = set()
        reviewed_text = " ".join([rec.conclusion, *(item.summary for item in rec.suggested_actions)])
        review_sources = [] if critic is None else [item for item in critic.evidence if
            (item.source_type == "utterance" and item.summary == request.current_utterance)
            or (item.source_type == "opinion" and item.evidence_ref == "recommendation" and item.summary in reviewed_text)]
        if critic is not None and critic.result_status not in {"ERROR", "NOT_RUN"} and review_sources:
            # 다른 요청의 지적을 이름만 보고 적용하지 않습니다. 비교할 대상 근거가 필요합니다.
            supporting = [item for item in critic.evidence if item.source_type in {"state", "memory", "schedule", "relationship"} and (item.relevance is None or item.relevance >= 0.55) and (request.reference_time is None or item.observed_at is None or item.observed_at <= request.reference_time) and "현재 상태 종합에서 제외" not in item.summary]
            # 인용한 오류 문장은 사실 근거가 아니라 검토 대상 해석으로 명시합니다.
            use(critic, [item.model_copy(update={"interpretation": True}) if item.source_type == "opinion" else item for item in review_sources] + supporting)
            review_codes = {item.code for item in critic.risks}
            for item in critic.risks:
                risk(item.code, item.summary)
        elif critic is not None and (critic.risks or critic.result_status in {"ERROR", "NOT_RUN"}):
            risk("review_unverified", "검토 의견의 근거/처리 결과를 확인하지 못했습니다. 자동 취소 근거로 쓰지 않습니다.")

        # 부족한 상태 자체는 질문 강제 사유가 아닙니다. 선택 판단에 필요한 미해결 충돌만 보류합니다.
        if review_codes & {"opinion_conflict", "insufficient_evidence", "additional_concerns"}:
            return finish("충돌한 근거를 확인한 뒤 기존 후보를 다시 비교해볼까요?", "NEEDS_INPUT", True)
        if "current_intent_violation" in review_codes:
            return finish("현재 원하시는 선택과 기존 후보의 충돌을 먼저 확인해볼까요?", "NEEDS_INPUT", True)
        if review_codes & {"coercion", "guilt_pressure", "memory_overapplication", "relationship_overinterpretation"}:
            return finish("현재 의사에 맞는 비강제 후보로 원래 제안을 다시 검토해볼까요?", "NEEDS_INPUT", True)

        adjust_time = bool(review_codes & {"historical_risk", "schedule_conflict"})
        unsupported = "unsupported_inference" in review_codes
        for candidate in rec.suggested_actions:
            if candidate.mode != "suggest":
                risk("non_suggest_candidate", "실행/기록 후보는 사용자 선택 제안으로 사용하지 않습니다.")
                continue
            summary = candidate.summary
            if unsupported:
                # 지적된 인과절만 제거합니다. 분리할 수 없으면 의미를 새로 추측해 쓰지 않습니다.
                separated = re.split(r"(?:하니|이니|해서|때문에)[,\s]+", summary, maxsplit=1)
                if len(separated) != 2 or not separated[1].strip():
                    continue
                summary = separated[1].strip()
            if adjust_time:
                # 고정 분/시간이나 새 행동을 발명하지 않고 기존 행동의 시간 범위만 완화합니다.
                summary = re.sub(r"\d+\s*(?:시간|분)(?:\s*더)?", "", summary).strip()
                summary = "일정 전 가능한 범위에서 " + summary if "schedule_conflict" in review_codes else summary
                summary += "; 짧은 시간 경계 후 다시 선택"
            if "confidence_overstatement" in review_codes:
                # Critic이 지적한 단정의 강도만 낮추며 다른 행동을 새로 만들지 않습니다.
                summary = re.sub(r"확실히|분명히|틀림없이|100%", "", summary).replace("정답", "후보").strip()
            # 확정 명령으로 복제하지 않고 모든 후보를 선택 가능한 인용으로 표시합니다.
            summary = "선택 후보: " + summary
            if len(summary) > 500:
                risk("candidate_length", "조정한 후보가 계약 길이를 초과해 포함하지 않았습니다.")
                continue
            action = SuggestedAction(type=candidate.type, intent=candidate.intent, mode="suggest", summary=summary)
            if action not in choices and len(choices) < 2:
                choices.append(action)
        if not choices:
            risk("no_supported_candidate", "근거 범위에서 유지할 수 있는 Suggest 후보가 없습니다.")
            return finish("기존 행동 후보를 지지할 근거를 확인해볼까요?", "NEEDS_INPUT", True)

        # 배제한 unsupported/과거 단정 근거는 최종 evidence로 가져오지 않습니다.
        sources = [item for item in rec.evidence if item.source_type in {"schedule", "memory", "relationship"} and (item.relevance is None or item.relevance >= 0.55) and (request.reference_time is None or item.observed_at is None or item.observed_at <= request.reference_time)]
        use(rec, sources)
        return finish("기존 제안을 선택 후보로 정리했습니다. " + ("시간 범위를 조정해 다시 살펴볼 수 있습니다. " if adjust_time else "") + "최종 선택은 사용자에게 있습니다.", material_conflict=bool(review_codes & {"unsupported_inference", "schedule_conflict", "confidence_overstatement"}))
