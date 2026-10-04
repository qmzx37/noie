"""실제 네 Specialist를 fake reasoner와 연결해 검사합니다. DB/OpenAI 호출은 없습니다."""

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from pydantic import ValidationError

from agent.lv4.arbitrator_specialist import ArbitratorSpecialist
from agent.lv4.collaboration_context import Lv4CollaborationContext, Lv4CollaborationResult, STAGES
from agent.lv4.collaboration_pipeline import Lv4CollaborationPipeline
from agent.lv4.critic_context import CriticConstraints
from agent.lv4.critic_specialist import CriticSpecialist
from agent.lv4.recommendation_context import MemoryContext, RelationshipContext, ScheduleContext
from agent.lv4.recommendation_specialist import RecommendationDecision, RecommendationSpecialist
from agent.lv4.registry import SpecialistRegistry
from agent.lv4.schemas import AgentOpinion
from agent.lv4.specialist import SpecialistAgent
from agent.lv4.state_context import BodyState, CognitiveState, EmotionState, StateContext
from agent.lv4.state_specialist import StateSpecialist
from agent.recommendation_schemas import RecommendationArguments

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
USER = "지금 개발할까 쉴까?"


def root(**updates):
    """필요한 소량 관찰만 만들고 현재 기준 시각을 고정합니다."""
    state = StateContext(as_of=NOW, max_age_seconds=3600,
        emotion=EmotionState(**dict.fromkeys("FADJCGTR", 0.2), confidence=0.8, observed_at=NOW),
        body=BodyState(energy=0.8, confidence=0.8, observed_at=NOW),
        cognitive=CognitiveState(focus=0.8, motivation=0.8, confidence=0.8, observed_at=NOW))
    return Lv4CollaborationContext(**{"current_utterance": USER, "reference_time": NOW, "state_context": state, **updates})


class FakeReasoner:
    """동일 입력에 같은 결정만 반환하는 명시적 stub입니다. 의미 품질 평가는 아닙니다."""

    def __init__(self, needs_input=False, no_recommendation=False, two_choices=False):
        self.calls = []
        self.needs_input, self.no_recommendation, self.two_choices = needs_input, no_recommendation, two_choices

    def __call__(self, context, evidence):
        """실제로 전달된 최소 근거만 참조하며 외부 서비스를 호출하지 않습니다."""
        self.calls.append((context, evidence))
        refs = [item.evidence_ref for item in evidence][:12]
        if self.needs_input:
            return RecommendationDecision(recommendation=None, used_evidence_refs=["current"], needs_user_input=True, input_question="지금 가능한 시간을 알려주실 수 있나요?")
        if self.no_recommendation:
            return RecommendationDecision(recommendation=None, used_evidence_refs=refs)
        arguments = RecommendationArguments(primary_action="20분 개발해볼까요?", alternative_action="잠깐 쉬어볼까요?" if self.two_choices else None,
            rationale="현재 선택 질문에 기반한 후보입니다.", confidence=0.7, recommendation_kind="tradeoff" if self.two_choices else "direct")
        return RecommendationDecision(recommendation=arguments, used_evidence_refs=refs)


class Spy(SpecialistAgent):
    """공통 run 계약을 유지하며 기존 Specialist의 호출 순서/입력만 관찰합니다."""

    def __init__(self, inner, events):
        super().__init__(inner.name, "테스트 단계 추적")
        self.inner, self.events, self.contexts = inner, events, []
        self.fail = False
        self.reported_status = None
        self.invalid = False

    def _run(self, request):
        """장애는 테스트에서만 주입하며 기존 Specialist 코드는 변경하지 않습니다."""
        self.events.append(self.name)
        self.contexts.append(request)
        if self.fail:
            raise RuntimeError("secret-test-token: internal exception must not escape")
        if self.invalid:
            return {"secret": "internal-object"}
        if self.reported_status is not None:
            return AgentOpinion(agent_name=self.name, conclusion="명시적 미실행/실패", confidence=None, result_status=self.reported_status)
        return self.inner.run(request)


def pipeline(fake=None):
    """외부에서 생성한 네 Agent를 명시적으로 주입합니다. 전역 등록은 없습니다."""
    fake = fake or FakeReasoner()
    events = []
    agents = [Spy(agent, events) for agent in (StateSpecialist(), RecommendationSpecialist(fake), CriticSpecialist(), ArbitratorSpecialist())]
    instance = Lv4CollaborationPipeline(**{name + "_agent": agent for name, agent in zip(STAGES, agents)})
    return instance, agents, events, fake


class CollaborationTests(unittest.TestCase):
    """순차 연결, 정보 최소화, partial result 및 재사용 계약을 검증합니다."""

    def test_order(self):
        instance, agents, events, fake = pipeline()
        self.assertEqual(events, [])
        result = instance.run(root())
        self.assertEqual(events, list(STAGES))
        self.assertEqual(result.pipeline_status, "COMPLETED")
        self.assertEqual([len(agent.contexts) for agent in agents], [1, 1, 1, 1])

    def test_state_to_recommendation(self):
        instance, agents, _, _ = pipeline(); result = instance.run(root())
        self.assertEqual(agents[1].contexts[0].state_opinion, result.state_opinion)

    def test_recommendation_to_critic(self):
        instance, agents, _, _ = pipeline(); result = instance.run(root())
        context = agents[2].contexts[0]
        self.assertEqual(context.recommendation_opinion, result.recommendation_opinion)
        self.assertEqual(context.state_opinion, result.state_opinion)

    def test_all_opinions_to_arbitrator(self):
        instance, agents, _, _ = pipeline(); result = instance.run(root())
        for name in STAGES[:3]:
            self.assertEqual(getattr(agents[3].contexts[0], name + "_opinion"), getattr(result, name + "_opinion"))

    def test_final_is_arbitrator(self):
        result = pipeline()[0].run(root())
        self.assertEqual(result.arbitrator_opinion.agent_name, "arbitrator")
        self.assertEqual(result.arbitrator_opinion.result_status, "OK")

    def test_utterance_unchanged(self):
        text = USER + "  \n"
        instance, agents, _, fake = pipeline(); instance.run(root(current_utterance=text))
        self.assertEqual(agents[0].contexts[0].current_utterance, "state observations")
        self.assertTrue(all(agent.contexts[0].current_utterance == text for agent in agents[1:]))
        self.assertEqual(fake.calls[0][0].current_utterance, text)

    def test_no_recommendation_flow(self):
        instance, agents, events, fake = pipeline()
        result = instance.run(root(current_utterance="오늘은 완전히 쉬기로 했어"))
        self.assertEqual(events, list(STAGES)); self.assertEqual(fake.calls, [])
        self.assertEqual(result.recommendation_opinion.result_status, "NO_RECOMMENDATION")
        self.assertEqual(result.arbitrator_opinion.result_status, "NO_RECOMMENDATION")
        self.assertEqual(result.arbitrator_opinion.suggested_actions, [])
        self.assertEqual(agents[2].contexts[0].relevant_constraints, CriticConstraints())

    def test_reasoner_no_recommendation_flow(self):
        instance, _, events, _ = pipeline(FakeReasoner(no_recommendation=True))
        self.assertEqual(instance.run(root()).arbitrator_opinion.result_status, "NO_RECOMMENDATION")
        self.assertEqual(events, list(STAGES))

    def test_needs_input_flow(self):
        instance, _, events, _ = pipeline(FakeReasoner(needs_input=True)); result = instance.run(root())
        self.assertEqual(events, list(STAGES))
        self.assertEqual(result.pipeline_status, "COMPLETED")
        self.assertTrue(result.arbitrator_opinion.needs_user_input)
        self.assertEqual(result.arbitrator_opinion.suggested_actions, [])

    def test_no_memory(self):
        instance, agents, _, _ = pipeline(); instance.run(root())
        self.assertEqual(agents[1].contexts[0].memories, [])
        self.assertEqual(agents[2].contexts[0].relevant_constraints.memories, [])

    def test_no_schedule(self):
        instance, agents, _, _ = pipeline(); instance.run(root())
        self.assertEqual(agents[1].contexts[0].schedules, [])

    def test_no_relationship(self):
        instance, agents, _, _ = pipeline(); instance.run(root())
        self.assertEqual(agents[1].contexts[0].relationships, [])

    def test_partial_state(self):
        instance, agents, _, _ = pipeline()
        result = instance.run(root(state_context=StateContext(as_of=NOW, body=BodyState(energy=0.8, observed_at=NOW))))
        self.assertEqual(result.pipeline_status, "COMPLETED")
        self.assertEqual(result.state_opinion.result_status, "NEEDS_INPUT")
        self.assertEqual(agents[1].contexts[0].state_opinion.result_status, "NEEDS_INPUT")

    def test_unknown_confidence(self):
        instance, agents, _, _ = pipeline()
        result = instance.run(root(state_context=StateContext(as_of=NOW, body=BodyState(energy=0.8, observed_at=NOW))))
        self.assertIsNone(result.state_opinion.confidence)
        self.assertIsNone(agents[2].contexts[0].state_opinion.confidence)
        self.assertIsNone(result.arbitrator_opinion.confidence)

    def test_action_limits(self):
        result = pipeline(FakeReasoner(two_choices=True))[0].run(root())
        self.assertEqual(len(result.recommendation_opinion.suggested_actions), 2)
        self.assertLessEqual(len(result.arbitrator_opinion.suggested_actions), 2)
        self.assertTrue(all(item.mode == "suggest" for item in result.arbitrator_opinion.suggested_actions))

    def test_no_new_action(self):
        result = pipeline()[0].run(root())
        self.assertIn(result.recommendation_opinion.suggested_actions[0].summary, result.arbitrator_opinion.suggested_actions[0].summary)

    def test_exception_each_stage(self):
        for index, name in enumerate(STAGES):
            with self.subTest(name=name):
                instance, agents, events, _ = pipeline(); agents[index].fail = True
                result = instance.run(root())
                self.assertEqual(result.pipeline_status, "FAILED")
                self.assertEqual(result.failed_stage, name)
                self.assertEqual(result.failure_kind, "exception")
                self.assertEqual(events, list(STAGES[:index+1]))
                for previous in STAGES[:index]: self.assertIsNotNone(getattr(result, previous + "_opinion"))
                for future in STAGES[index:]: self.assertIsNone(getattr(result, future + "_opinion"))
                self.assertNotIn("secret-test-token", result.model_dump_json())

    def test_reported_failure_each_stage(self):
        for index, name in enumerate(STAGES):
            for status in ("ERROR", "NOT_RUN"):
                with self.subTest(name=name, status=status):
                    instance, agents, events, _ = pipeline(); agents[index].reported_status = status
                    result = instance.run(root())
                    self.assertEqual(result.failure_kind, "reported_failure")
                    self.assertEqual(getattr(result, name + "_opinion").result_status, status)
                    self.assertEqual(events, list(STAGES[:index+1]))

    def test_invalid_return_failure(self):
        instance, agents, events, _ = pipeline(); agents[1].invalid = True
        result = instance.run(root())
        self.assertEqual(result.failed_stage, "recommendation")
        self.assertIsNotNone(result.state_opinion)
        self.assertIsNone(result.recommendation_opinion)
        self.assertNotIn("internal-object", result.model_dump_json())

    def test_invalid_root(self):
        for updates in ({"metadata": {}}, {"current_utterance": " "}, {"reference_time": NOW+timedelta(seconds=1)}, {"reference_time": datetime(2026, 10, 4)}):
            with self.subTest(updates=updates), self.assertRaises(ValidationError): root(**updates)

    def test_nested_extras_and_count_limits(self):
        values = root().model_dump(); values["state_context"]["body"]["metadata"] = {}
        with self.assertRaises(ValidationError): Lv4CollaborationContext.model_validate(values)
        with self.assertRaises(ValidationError): CriticConstraints(memories=[MemoryContext(content="개발 기억", relevance=1)]*5)

    def test_constructed_root_revalidated(self):
        instance, _, events, _ = pipeline()
        original = root()
        invalid = Lv4CollaborationContext.model_construct(current_utterance="", reference_time=NOW, state_context=original.state_context)
        with self.assertRaises(ValidationError): instance.run(invalid)
        self.assertEqual(events, [])

    def test_wrong_input_type(self):
        with self.assertRaises(TypeError): pipeline()[0].run({})

    def test_wrong_injection(self):
        with self.assertRaises(TypeError): Lv4CollaborationPipeline(state_agent=None, recommendation_agent=None, critic_agent=None, arbitrator_agent=None)
        with self.assertRaises(ValueError): Lv4CollaborationPipeline(state_agent=CriticSpecialist(), recommendation_agent=RecommendationSpecialist(FakeReasoner()), critic_agent=CriticSpecialist(), arbitrator_agent=ArbitratorSpecialist())

    def test_reuse_and_determinism(self):
        instance, _, events, _ = pipeline(); request = root(); before = request.model_dump()
        self.assertEqual(instance.run(request), instance.run(request))
        self.assertEqual(request.model_dump(), before)
        self.assertEqual(events, list(STAGES)*2)

    def test_reuse_after_failure(self):
        instance, agents, _, _ = pipeline(); agents[2].fail = True
        self.assertEqual(instance.run(root()).pipeline_status, "FAILED")
        agents[2].fail = False
        self.assertEqual(instance.run(root()).pipeline_status, "COMPLETED")

    def test_registry_not_polluted(self):
        registry = SpecialistRegistry(); pipeline()[0].run(root())
        self.assertEqual(registry.list(), ())

    def test_no_db_or_network(self):
        with patch("database.SessionLocal", side_effect=AssertionError("DB access forbidden")), patch("socket.socket.connect", side_effect=AssertionError("network forbidden")):
            self.assertEqual(pipeline()[0].run(root()).pipeline_status, "COMPLETED")

    def test_arbitrator_minimal_context(self):
        instance, agents, _, _ = pipeline(); instance.run(root())
        self.assertEqual(set(agents[3].contexts[0].model_dump()), {"current_utterance", "reference_time", "evidence", "state_opinion", "recommendation_opinion", "critic_opinion"})

    def test_constraints_reuse_existing_filter(self):
        constraints = CriticConstraints(memories=[MemoryContext(content="개발 피로 경험", relevance=0.9), MemoryContext(content="라멘 취향", relevance=1)],
            schedules=[ScheduleContext(title="수업", start_at=NOW+timedelta(hours=1), relevance=0.9), ScheduleContext(title="먼 일정", start_at=NOW+timedelta(days=3), relevance=1)],
            relationships=[RelationshipContext(person_label="민수", summary="민수는 친구", relevance=1, record_kind="social_relation", temporal_scope="current")])
        instance, agents, _, _ = pipeline(); result = instance.run(root(relevant_constraints=constraints))
        self.assertEqual(result.pipeline_status, "COMPLETED")
        filtered = agents[2].contexts[0].relevant_constraints
        self.assertEqual([item.content for item in filtered.memories], ["개발 피로 경험"])
        self.assertEqual([item.title for item in filtered.schedules], ["수업"])
        self.assertEqual(filtered.relationships, [])

    def test_failed_result_invariants(self):
        with self.assertRaises(ValidationError): Lv4CollaborationResult(pipeline_status="COMPLETED")
        with self.assertRaises(ValidationError): Lv4CollaborationResult(pipeline_status="FAILED")
        with self.assertRaises(ValidationError): Lv4CollaborationResult(pipeline_status="FAILED", failed_stage="critic", failure_kind="exception")

    def test_empty_state_flow(self):
        instance, _, events, _ = pipeline()
        result = instance.run(root(state_context=StateContext(as_of=NOW)))
        self.assertEqual(result.pipeline_status, "COMPLETED")
        self.assertEqual(result.state_opinion.result_status, "NEEDS_INPUT")
        self.assertEqual(events, list(STAGES))

    def test_named_relationship_projection(self):
        relationship = RelationshipContext(person_label="민수", summary="민수는 내 친구", relevance=0.9, record_kind="social_relation", temporal_scope="current", observed_at=NOW)
        instance, agents, _, _ = pipeline()
        result = instance.run(root(current_utterance="민수와 개발할까?", relevant_constraints=CriticConstraints(relationships=[relationship])))
        self.assertEqual(result.pipeline_status, "COMPLETED")
        self.assertEqual(agents[2].contexts[0].relevant_constraints.relationships, [relationship])
        self.assertNotIn("relationships", agents[3].contexts[0].model_dump())

    def test_future_and_low_relevance_constraints_excluded(self):
        constraints = CriticConstraints(memories=[MemoryContext(content="개발 미래 해석", relevance=1, observed_at=NOW+timedelta(seconds=1)), MemoryContext(content="개발 무관 근거", relevance=0.1)])
        instance, agents, _, fake = pipeline(); result = instance.run(root(relevant_constraints=constraints))
        self.assertEqual(result.pipeline_status, "COMPLETED")
        self.assertEqual(agents[2].contexts[0].relevant_constraints.memories, [])
        self.assertFalse(any(item.source_type == "memory" for item in fake.calls[0][1]))

    def test_mutated_root_rejected_before_execution(self):
        instance, _, events, _ = pipeline(); request = root()
        request.relevant_constraints.memories.extend([MemoryContext(content="개발 기억", relevance=1)]*5)
        with self.assertRaises(ValidationError): instance.run(request)
        self.assertEqual(events, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
