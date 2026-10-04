"""Phase 3의 context/정책/adapter 계약을 fake client로 검사합니다. 실제 DB/OpenAI 호출 없음."""

import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from pydantic import ValidationError

from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
from agent.lv4.recommendation_context import MemoryContext, RecommendationContext, RelationshipContext, ScheduleContext
from agent.lv4.recommendation_specialist import RecommendationDecision, RecommendationSpecialist
from agent.lv4.registry import SpecialistRegistry
from agent.lv4.schemas import AgentOpinion, SpecialistInput
from agent.lv4.state_context import BodyState, StateContext
from agent.lv4.state_specialist import StateSpecialist
from agent.recommendation_schemas import RecommendationArguments
from agent.orchestrator import recommendation_output_schema

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def context(text="지금 개발할까 쉴까?", **updates):
    """호출자가 이미 선택한 최소 자료만 제공합니다."""
    return RecommendationContext(**{"current_utterance": text, "reference_time": NOW, **updates})


def arguments(**updates):
    """원래 추천 계약으로 검증된 fixture입니다. 신규 추천 판단 규칙이 아닙니다."""
    return RecommendationArguments(**{"primary_action": "20분만 작은 작업을 하고 상태를 확인해볼까요?", "rationale": "현재 선택 질문을 참고한 작은 제안입니다.", "confidence": 0.6, "recommendation_kind": "direct", **updates})


class FakeReasoner:
    """의미 판단이 아닌 전달/변환 경계를 검사하는 deterministic stub입니다."""

    def __init__(self, recommendation=None):
        self.recommendation = recommendation or arguments()
        self.calls = []

    def __call__(self, request, evidence):
        """실제 전달된 근거만 참조합니다. 테스트는 어떤 subset을 썼는지도 확인합니다."""
        self.calls.append((request, evidence))
        return RecommendationDecision(recommendation=self.recommendation, used_evidence_refs=[item.evidence_ref for item in evidence])


class RecommendationTests(unittest.TestCase):
    """추천 의미의 실제 LLM 정확도와 fake 계약 성공을 혼동하지 않습니다."""

    def test_sufficient_context(self):
        fake = FakeReasoner()
        state = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(energy=0.8, confidence=0.8, observed_at=NOW)))
        result = RecommendationSpecialist(fake).run(context(state_opinion=state, memories=[MemoryContext(content="개발 후 피로를 느꼈던 경험", relevance=0.9)]))
        self.assertEqual(result.agent_name, "recommendation")
        self.assertEqual(len(result.suggested_actions), 1)
        self.assertEqual(result.result_status, "OK")

    def test_decision_respected_before_reasoning(self):
        fake = FakeReasoner()
        result = RecommendationSpecialist(fake).run(context("오늘은 완전히 쉬기로 했어.", memories=[MemoryContext(content="개발 목표가 있다", relevance=1)]))
        self.assertEqual(result.result_status, "NO_RECOMMENDATION")
        self.assertEqual(result.suggested_actions, [])
        self.assertEqual(fake.calls, [])

    def test_current_intent_over_memory(self):
        fake = FakeReasoner()
        result = RecommendationSpecialist(fake).run(context("오늘 쉬고 내일 개발할래", memories=[MemoryContext(content="오늘은 개발해야 한다", relevance=1)]))
        self.assertEqual(result.result_status, "NO_RECOMMENDATION")
        self.assertEqual(fake.calls, [])

    def test_schedule_is_constraint(self):
        fake = FakeReasoner()
        schedule = ScheduleContext(title="친구 약속", start_at=NOW+timedelta(hours=1), relevance=1)
        result = RecommendationSpecialist(fake).run(context(schedules=[schedule]))
        self.assertTrue(any(item.source_type == "schedule" for item in result.evidence))
        with self.assertRaises(ValueError): RecommendationSpecialist(FakeReasoner(arguments(primary_action="2시간 개발해볼까요?"))).run(context(schedules=[schedule]))

    def test_partial_state(self):
        state = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(energy=0.2, observed_at=NOW)))
        result = RecommendationSpecialist(FakeReasoner()).run(context(state_opinion=state))
        self.assertIn("partial_state", [risk.code for risk in result.risks])

    def test_no_memory(self):
        result = RecommendationSpecialist(FakeReasoner()).run(context())
        self.assertFalse(any(item.source_type == "memory" for item in result.evidence))

    def test_no_relationship(self):
        result = RecommendationSpecialist(FakeReasoner()).run(context())
        self.assertFalse(any(item.source_type == "relationship" for item in result.evidence))

    def test_no_schedule(self):
        result = RecommendationSpecialist(FakeReasoner()).run(context())
        self.assertFalse(any(item.source_type == "schedule" for item in result.evidence))

    def test_no_optional_context(self):
        result = RecommendationSpecialist(FakeReasoner()).run(context("뭘 해야 할지 모르겠어."))
        self.assertEqual([item.source_type for item in result.evidence], ["utterance"])
        self.assertIn("limited_context", [risk.code for risk in result.risks])

    def test_filtered_context_not_shared_with_reasoner(self):
        fake = FakeReasoner()
        RecommendationSpecialist(fake).run(context(memories=[MemoryContext(content="개발 관련", relevance=0.2), MemoryContext(content="무관한 요리", relevance=1)]))
        request, evidence = fake.calls[0]
        self.assertEqual(request.memories, [])
        self.assertEqual(len(evidence), 1)

    def test_only_used_evidence_returned(self):
        def subset(request, evidence):
            return RecommendationDecision(recommendation=arguments(), used_evidence_refs=["current"])
        result = RecommendationSpecialist(subset).run(context(memories=[MemoryContext(content="개발 경험", relevance=1)]))
        self.assertEqual(len(result.evidence), 1)

    def test_two_candidates(self):
        result = RecommendationSpecialist(FakeReasoner(arguments(recommendation_kind="tradeoff", alternative_action="잠깐 쉬고 다시 선택해볼까요?"))).run(context())
        self.assertEqual(len(result.suggested_actions), 2)
        self.assertTrue(all(action.mode == "suggest" for action in result.suggested_actions))

    def test_coercion_rejected(self):
        for text in ("무조건 해야 한다", "이번 주 못 했으니 지금 해야 한다", "너는 항상 개발해야 한다"):
            with self.subTest(text=text), self.assertRaises(ValueError): RecommendationSpecialist(FakeReasoner(arguments(primary_action=text))).run(context())

    def test_registry(self):
        registry = SpecialistRegistry(); specialist = RecommendationSpecialist(FakeReasoner()); registry.register(specialist)
        self.assertIs(registry.get("recommendation"), specialist)
        self.assertIsInstance(registry.get("recommendation").run(context()), AgentOpinion)

    def test_invalid_context(self):
        with self.assertRaises(ValidationError): context(metadata={})
        with self.assertRaises(ValidationError): MemoryContext(content="개발", relevance=float("nan"))
        with self.assertRaises(ValidationError): context(state_opinion=AgentOpinion(agent_name="other", conclusion="결론", confidence=1))
        with self.assertRaises(ValidationError): context(reference_time=datetime(2026, 10, 4))

    def test_failure_isolation(self):
        def fail(request, evidence): raise RuntimeError("fake failure")
        registry = SpecialistRegistry(); registry.register(RecommendationSpecialist(fail))
        with self.assertRaises(RuntimeError): registry.get("recommendation").run(context())
        self.assertEqual(len(registry.list()), 1)

    def test_unknown_evidence_rejected(self):
        def invalid(request, evidence): return RecommendationDecision(recommendation=arguments(), used_evidence_refs=["current", "invented"])
        with self.assertRaises(ValueError): RecommendationSpecialist(invalid).run(context())

    def test_no_recommendation_from_reasoner(self):
        result = RecommendationSpecialist(lambda request, evidence: RecommendationDecision(recommendation=None)).run(context())
        self.assertEqual(result.result_status, "NO_RECOMMENDATION")

    def test_relationship_and_temporal_context(self):
        relationship = RelationshipContext(person_label="민수", summary="민수에게 서운했다고 말한 근거", record_kind="relationship_state", temporal_scope="past", relevance=0.9, observed_at=NOW-timedelta(days=5))
        result = RecommendationSpecialist(FakeReasoner()).run(context("민수 만나러 갈까?", relationships=[relationship]))
        self.assertTrue(any(item.source_type == "relationship" for item in result.evidence))
        self.assertIn("historical_evidence", [risk.code for risk in result.risks])
        other = RecommendationSpecialist(FakeReasoner()).run(context("개발할까?", relationships=[relationship]))
        self.assertFalse(any(item.source_type == "relationship" for item in other.evidence))

    def test_no_stale_or_future_state(self):
        state = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(energy=1, observed_at=NOW-timedelta(days=1))))
        result = RecommendationSpecialist(FakeReasoner()).run(context(state_opinion=state))
        self.assertFalse(any(item.source_type == "state" for item in result.evidence))

    def test_home_topic_does_not_match_focus(self):
        fake = FakeReasoner()
        RecommendationSpecialist(fake).run(context("집에서 할까 카페 갈까?", memories=[MemoryContext(content="집중을 잘했던 개발", relevance=1)]))
        self.assertEqual(len(fake.calls[0][1]), 1)

    def test_plain_report_has_no_reasoning(self):
        fake = FakeReasoner()
        result = RecommendationSpecialist(fake).run(context("오늘 기분 좋아."))
        self.assertEqual(result.result_status, "NO_RECOMMENDATION")
        self.assertEqual(fake.calls, [])

    def test_missing_schedule_reference_rejected(self):
        """전달한 확정 일정 제약을 출력에서 무시하면 반환을 보류합니다."""
        def missing(request, evidence): return RecommendationDecision(recommendation=arguments(), used_evidence_refs=["current"])
        with self.assertRaises(ValueError): RecommendationSpecialist(missing).run(context(schedules=[ScheduleContext(title="약속", start_at=NOW+timedelta(minutes=30), relevance=1)]))

    def test_mutating_reasoner_cannot_expand_evidence(self):
        """허용 근거 snapshot은 reasoner에게 전달한 목록과 분리합니다."""
        from agent.lv4.schemas import OpinionEvidence
        def mutate(request, evidence):
            evidence.append(OpinionEvidence(source_type="memory", evidence_ref="invented", summary="허가되지 않은 근거"))
            return RecommendationDecision(recommendation=arguments(), used_evidence_refs=["current", "invented"])
        with self.assertRaises(ValueError): RecommendationSpecialist(mutate).run(context())

    def test_state_projection_filters_old_conclusion(self):
        """일부 상태가 제외되면 전체 원래 결론을 함께 넘기지 않습니다."""
        from agent.lv4.schemas import OpinionEvidence
        state = AgentOpinion(agent_name="state", conclusion="오래된 내용 포함", confidence=0.5, evidence=[OpinionEvidence(source_type="state", summary="신선한 관찰", observed_at=NOW), OpinionEvidence(source_type="state", summary="오래된 관찰", observed_at=NOW-timedelta(days=1))])
        fake = FakeReasoner(); RecommendationSpecialist(fake).run(context(state_opinion=state))
        self.assertNotIn("오래된 내용 포함", fake.calls[0][0].state_opinion.conclusion)
        self.assertEqual(len(fake.calls[0][0].state_opinion.evidence), 1)

    def test_future_and_distant_context_excluded(self):
        fake = FakeReasoner()
        RecommendationSpecialist(fake).run(context(memories=[MemoryContext(content="개발 근거", relevance=1, observed_at=NOW+timedelta(days=1))], schedules=[ScheduleContext(title="먼 일정", start_at=NOW+timedelta(days=2), relevance=1)]))
        self.assertEqual(len(fake.calls[0][1]), 1)

    def test_schedule_schema_time(self):
        with self.assertRaises(ValidationError): ScheduleContext(title="약속", start_at=NOW, end_at=NOW, relevance=1)

    def test_requires_current_evidence(self):
        with self.assertRaises(ValueError): RecommendationSpecialist(lambda request, evidence: RecommendationDecision(recommendation=arguments())).run(context())


class AdapterTests(unittest.TestCase):
    """실제 Responses call 형식은 검사하되 외부 서비스는 fake로 대체합니다."""

    def payload(self, actions=True):
        """기존 routing 출력 구조에 사용 근거 참조만 추가합니다."""
        return {"needs_action": actions, "actions": [{"type": "recommendation", "intent": "suggest_recommendation", "mode": "suggest", "reason": "현재 선택 질문", "confidence": 0.6, "requires_confirmation": False, "execution_order": 1, "arguments": arguments().model_dump()}] if actions else [], "used_evidence_refs": ["current"] if actions else [], "needs_user_input": False, "input_question": None}

    def test_fake_client_schema_and_prompt_reuse(self):
        calls = []
        def create(**kwargs): calls.append(kwargs); return SimpleNamespace(output_text=json.dumps(self.payload()), status="completed")
        adapter = OpenAIRecommendationAdapter(SimpleNamespace(responses=SimpleNamespace(create=create)))
        result = RecommendationSpecialist(adapter).run(context())
        self.assertEqual(result.agent_name, "recommendation")
        self.assertTrue(calls[0]["text"]["format"]["strict"])
        self.assertEqual(calls[0]["text"]["format"]["schema"]["properties"]["actions"], recommendation_output_schema()["properties"]["actions"])
        self.assertNotIn("used_evidence_refs", recommendation_output_schema()["properties"])
        payload = json.loads(calls[0]["input"][1]["content"])
        self.assertEqual(set(payload), {"current_user_utterance", "reference_time", "state_opinion", "recommendation_evidence"})

    def test_empty_output(self):
        client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(output_text=json.dumps(self.payload(False)), status="completed")))
        self.assertEqual(RecommendationSpecialist(OpenAIRecommendationAdapter(client)).run(context()).result_status, "NO_RECOMMENDATION")

    def test_parse_failure(self):
        client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(output_text="not json", status="completed")))
        with self.assertRaises(ValueError): RecommendationSpecialist(OpenAIRecommendationAdapter(client)).run(context())

    def test_incomplete_failure(self):
        client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(status="incomplete")))
        with self.assertRaises(ValueError): RecommendationSpecialist(OpenAIRecommendationAdapter(client)).run(context())

    def test_needs_input(self):
        """필수 질문은 행동 제안과 무추천에서 구분합니다."""
        payload = {**self.payload(False), "used_evidence_refs": ["current"], "needs_user_input": True, "input_question": "지금 선택해야 하는 작업 후보를 알려줄 수 있나요?"}
        client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(output_text=json.dumps(payload), status="completed")))
        result = RecommendationSpecialist(OpenAIRecommendationAdapter(client)).run(context("뭘 해야 할지 모르겠어."))
        self.assertEqual(result.result_status, "NEEDS_INPUT")
        self.assertTrue(result.needs_user_input)
        self.assertEqual(result.suggested_actions, [])

    def test_needs_input_contract(self):
        with self.assertRaises(ValidationError): RecommendationDecision(recommendation=arguments(), needs_user_input=True, input_question="질문")
        with self.assertRaises(ValidationError): RecommendationDecision(recommendation=None, needs_user_input=True)

    def test_unexpected_action(self):
        """같은 schema 형식을 흉내 낸 다른 업무 action은 adapter 경계에서 거부합니다."""
        payload = self.payload()
        payload["actions"][0].update({"type": "reflection", "intent": "suggest_reflection", "arguments": None})
        client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(output_text=json.dumps(payload), status="completed")))
        with self.assertRaises(ValueError): RecommendationSpecialist(OpenAIRecommendationAdapter(client)).run(context())


if __name__ == "__main__":
    unittest.main(verbosity=2)
