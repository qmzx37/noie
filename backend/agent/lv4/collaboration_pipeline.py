"""State -> Recommendation -> Critic -> Arbitrator의 명시적 순차 연결만 담당합니다."""

from .arbitrator_context import ArbitratorContext
from .collaboration_context import Lv4CollaborationContext, Lv4CollaborationResult, STAGES
from .critic_context import CriticConstraints, CriticContext
from .recommendation_context import MemoryContext, RecommendationContext
from .recommendation_specialist import prepare_evidence
from .registry import SpecialistRegistry
from .schemas import AgentOpinion, SpecialistInput
from .specialist import SpecialistAgent


def _review_constraints(context: RecommendationContext, recommendation: AgentOpinion) -> CriticConstraints:
    """새 관련성 판단 없이 Phase 3가 선택한 최소 근거를 기존 typed 제약으로 투영합니다."""
    if recommendation.result_status == "NO_RECOMMENDATION":
        return CriticConstraints()
    selected = prepare_evidence(context)
    refs = {item.evidence_ref for item in selected}
    return CriticConstraints(
        memories=[MemoryContext(content=item.summary, relevance=item.relevance, observed_at=item.observed_at) for item in selected if item.source_type == "memory"],
        schedules=[item for index, item in enumerate(context.schedules) if f"schedule_{index}" in refs],
        relationships=[item for index, item in enumerate(context.relationships) if f"relationship_{index}" in refs],
    )


class Lv4CollaborationPipeline:
    """네 Specialist를 외부에서 받습니다. 제품 전역 registry/Agent/실행 경로는 만들지 않습니다."""

    def __init__(self, *, state_agent: SpecialistAgent, recommendation_agent: SpecialistAgent,
                 critic_agent: SpecialistAgent, arbitrator_agent: SpecialistAgent) -> None:
        """Phase 1 registry 검증을 로컬에서 재사용하고 실행하거나 자동 Agent를 생성하지 않습니다."""
        registry = SpecialistRegistry()
        agents = (state_agent, recommendation_agent, critic_agent, arbitrator_agent)
        for expected, agent in zip(STAGES, agents):
            registry.register(agent)
            if agent.name != expected:
                raise ValueError(f"{expected} 역할의 Specialist가 필요합니다.")
        self._agents = tuple(registry.get(name) for name in STAGES)

    def run(self, request: Lv4CollaborationContext) -> Lv4CollaborationResult:
        """네 단계를 한 번씩 실행합니다. 실패는 partial result로 명시하고 후속 실행은 중단합니다."""
        if not isinstance(request, Lv4CollaborationContext):
            raise TypeError("Lv4CollaborationContext가 필요합니다.")
        # frozen 모델의 중첩 list나 model_construct 우회도 단계 실행 전에 다시 검사합니다.
        root = Lv4CollaborationContext.model_validate(request.model_dump())
        opinions = {}
        recommendation_context = None
        for stage, agent in zip(STAGES, self._agents):
            try:
                context: SpecialistInput
                if stage == "state":
                    # 기존 State는 발화를 재분석하지 않으므로 고정 관찰 입력 계약을 유지합니다.
                    context = root.state_context
                elif stage == "recommendation":
                    constraints = root.relevant_constraints
                    recommendation_context = RecommendationContext(current_utterance=root.current_utterance,
                        reference_time=root.reference_time, state_opinion=opinions["state_opinion"],
                        memories=constraints.memories, schedules=constraints.schedules, relationships=constraints.relationships)
                    context = recommendation_context
                elif stage == "critic":
                    context = CriticContext(current_utterance=root.current_utterance, reference_time=root.reference_time,
                        state_opinion=opinions["state_opinion"], recommendation_opinion=opinions["recommendation_opinion"],
                        relevant_constraints=_review_constraints(recommendation_context, opinions["recommendation_opinion"]))
                else:
                    context = ArbitratorContext(current_utterance=root.current_utterance, reference_time=root.reference_time,
                        state_opinion=opinions["state_opinion"], recommendation_opinion=opinions["recommendation_opinion"], critic_opinion=opinions["critic_opinion"])
                opinion = agent.run(context)
            except Exception:
                # 예외 메시지/traceback은 API 키나 내부 객체를 포함할 수 있어 결과/로그에 넣지 않습니다.
                # 실패를 정상 opinion으로 위장하지 않으며 이전 실제 결과만 반환합니다.
                return Lv4CollaborationResult(**opinions, pipeline_status="FAILED", failed_stage=stage, failure_kind="exception")
            opinions[stage + "_opinion"] = opinion
            if opinion.result_status in {"ERROR", "NOT_RUN"}:
                return Lv4CollaborationResult(**opinions, pipeline_status="FAILED", failed_stage=stage, failure_kind="reported_failure")
        return Lv4CollaborationResult(**opinions, pipeline_status="COMPLETED")
