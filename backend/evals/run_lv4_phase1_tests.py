"""Lv4 Phase 1 결정론적 unit tests입니다. DB/OpenAI를 호출하지 않습니다."""

import unittest
from concurrent.futures import ThreadPoolExecutor

from pydantic import ValidationError

from agent.lv4.registry import DuplicateSpecialistError, SpecialistRegistry, UnknownSpecialistError
from agent.lv4.schemas import AgentOpinion, OpinionEvidence, OpinionRisk, SpecialistInput, SuggestedAction
from agent.lv4.specialist import SpecialistAgent


def opinion(**updates):
    """각 검사에서 독립적인 짧은 의견을 만듭니다."""
    return AgentOpinion(**{"agent_name": "fake", "conclusion": "최소 결론", "confidence": 0.5, **updates})


class FakeSpecialist(SpecialistAgent):
    """제품 Agent가 아닌 계약 검증용 구현입니다."""

    def __init__(self, name="fake"):
        super().__init__(name, "테스트 역할")

    def _run(self, request):
        """외부 호출 없이 의견만 반환합니다."""
        return opinion(agent_name=self.name, conclusion=request.current_utterance)


class Phase1Tests(unittest.TestCase):
    """schema 경계와 등록/조회/실행 결과를 각각 검증합니다."""

    def test_normal(self):
        self.assertIsInstance(opinion(), AgentOpinion)

    def test_zero(self):
        self.assertEqual(opinion(confidence=0).confidence, 0)

    def test_one(self):
        self.assertEqual(opinion(confidence=1).confidence, 1)

    def test_negative(self):
        with self.assertRaises(ValidationError): opinion(confidence=-0.1)

    def test_above_one(self):
        with self.assertRaises(ValidationError): opinion(confidence=1.1)

    def test_nan(self):
        with self.assertRaises(ValidationError): opinion(confidence=float("nan"))

    def test_infinity(self):
        for value in (float("inf"), float("-inf")):
            with self.subTest(value=value), self.assertRaises(ValidationError): opinion(confidence=value)

    def test_no_coercion(self):
        for value in (True, "0.5"):
            with self.subTest(value=value), self.assertRaises(ValidationError): opinion(confidence=value)

    def test_unknown(self):
        self.assertIsNone(opinion(confidence=None).confidence)

    def test_extra_and_private_reasoning(self):
        for field in ("extra", "chain_of_thought", "private_reasoning"):
            with self.subTest(field=field), self.assertRaises(ValidationError): opinion(**{field: "forbidden"})

    def test_nested_evidence(self):
        evidence = OpinionEvidence(source_type="utterance", summary="필요한 근거")
        self.assertEqual(opinion(evidence=[evidence]).evidence[0], evidence)
        with self.assertRaises(ValidationError): OpinionEvidence(source_type="memory", summary="근거", row_dump={})

    def test_blank(self):
        with self.assertRaises(ValidationError): opinion(conclusion="   ")

    def test_bounds_and_timezone(self):
        with self.assertRaises(ValidationError): opinion(evidence=[OpinionEvidence(source_type="state", summary="근거")] * 17)
        with self.assertRaises(ValidationError): OpinionEvidence(source_type="state", summary="근거", observed_at="2026-10-04T12:00:00")

    def test_status(self):
        candidate = SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="suggest", summary="제안")
        with self.assertRaises(ValidationError): opinion(result_status="NO_RECOMMENDATION", suggested_actions=[candidate])
        with self.assertRaises(ValidationError): opinion(result_status="NEEDS_INPUT")
        self.assertTrue(opinion(result_status="NEEDS_INPUT", needs_user_input=True).needs_user_input)

    def test_risk_and_action(self):
        value = opinion(risks=[OpinionRisk(code="unknown", summary="확인 필요")], suggested_actions=[SuggestedAction(type="future_tool", intent="candidate", mode="suggest", summary="후속 제안")])
        self.assertEqual(len(value.suggested_actions), 1)
        with self.assertRaises(ValidationError): SuggestedAction(type="tool", intent="candidate", mode="suggest", summary="제안", arguments={})

    def test_register(self):
        registry = SpecialistRegistry(); registry.register(FakeSpecialist())
        self.assertEqual(len(registry.list()), 1)

    def test_get(self):
        registry = SpecialistRegistry(); fake = FakeSpecialist(); registry.register(fake)
        self.assertIs(registry.get("fake"), fake)

    def test_list(self):
        registry = SpecialistRegistry(); registry.register(FakeSpecialist("zeta")); registry.register(FakeSpecialist("alpha"))
        self.assertEqual([agent.name for agent in registry.list()], ["alpha", "zeta"])
        self.assertIsInstance(registry.list(), tuple)

    def test_duplicate(self):
        registry = SpecialistRegistry(); fake = FakeSpecialist(); registry.register(fake)
        with self.assertRaises(DuplicateSpecialistError): registry.register(FakeSpecialist())
        self.assertIs(registry.get("fake"), fake)

    def test_unknown_agent(self):
        with self.assertRaises(UnknownSpecialistError): SpecialistRegistry().get("unknown")

    def test_invalid_registration(self):
        for invalid in (None, object(), lambda request: opinion()):
            with self.subTest(value=type(invalid)), self.assertRaises(TypeError): SpecialistRegistry().register(invalid)
        with self.assertRaises(ValidationError): FakeSpecialist("invalid name")

    def test_invalid_signature(self):
        class Invalid(FakeSpecialist):
            def _run(self): return opinion()
        with self.assertRaises(TypeError): SpecialistRegistry().register(Invalid())

    def test_run_override(self):
        class Invalid(FakeSpecialist):
            def run(self, request): return {}
        with self.assertRaises(TypeError): SpecialistRegistry().register(Invalid())

    def test_fake_result(self):
        self.assertIsInstance(FakeSpecialist().run(SpecialistInput(current_utterance="문장")), AgentOpinion)

    def test_bad_return(self):
        class Invalid(FakeSpecialist):
            def _run(self, request): return {}
        with self.assertRaises(TypeError): Invalid().run(SpecialistInput(current_utterance="문장"))

    def test_wrong_result_name(self):
        class Invalid(FakeSpecialist):
            def _run(self, request): return opinion(agent_name="other")
        with self.assertRaises(ValueError): Invalid().run(SpecialistInput(current_utterance="문장"))

    def test_failure_isolation_and_no_registry_execution(self):
        class Broken(FakeSpecialist):
            def _run(self, request): raise RuntimeError("test failure")
        registry = SpecialistRegistry(); registry.register(Broken("broken")); registry.register(FakeSpecialist())
        with self.assertRaises(RuntimeError): registry.get("broken").run(SpecialistInput(current_utterance="문장"))
        self.assertEqual(len(registry.list()), 2)
        self.assertIsInstance(registry.get("fake").run(SpecialistInput(current_utterance="문장")), AgentOpinion)

    def test_concurrent_registration(self):
        registry = SpecialistRegistry()
        def attempt():
            try: registry.register(FakeSpecialist()); return True
            except DuplicateSpecialistError: return False
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(lambda _: attempt(), range(8))), 1)

    def test_default_lists_independent(self):
        first, second = opinion(), opinion()
        first.evidence.append(OpinionEvidence(source_type="utterance", summary="근거"))
        self.assertEqual(second.evidence, [])

    def test_async_registration_rejected(self):
        """비동기 실행 framework는 Phase 1 범위가 아니므로 등록 단계에서 거부합니다."""
        class Invalid(FakeSpecialist):
            async def _run(self, request): return opinion()
        with self.assertRaises(TypeError): SpecialistRegistry().register(Invalid())

    def test_constructed_input_revalidated(self):
        """model_construct로 필드 검증을 생략해도 run에서 다시 확인합니다."""
        with self.assertRaises(ValidationError): FakeSpecialist().run(SpecialistInput.model_construct(current_utterance=""))

    def test_constructed_result_revalidated(self):
        """AgentOpinion 객체라는 사실만으로 잘못된 confidence를 신뢰하지 않습니다."""
        class Invalid(FakeSpecialist):
            def _run(self, request): return AgentOpinion.model_construct(agent_name="fake", conclusion="결론", confidence=float("nan"))
        with self.assertRaises(ValidationError): Invalid().run(SpecialistInput(current_utterance="문장"))

    def test_registry_instances_independent(self):
        """테스트와 향후 coordinator별 registry가 전역 등록 상태를 공유하지 않습니다."""
        first, second = SpecialistRegistry(), SpecialistRegistry()
        first.register(FakeSpecialist())
        self.assertEqual(second.list(), ())


if __name__ == "__main__":
    unittest.main(verbosity=2)
