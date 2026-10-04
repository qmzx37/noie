"""State Agent의 독립 축/unknown/시간/등록 계약을 DB와 OpenAI 없이 검증합니다."""

import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from agent.lv4.registry import SpecialistRegistry
from agent.lv4.schemas import SpecialistInput
from agent.lv4.state_context import BodyState, CognitiveState, EmotionState, StateContext
from agent.lv4.state_specialist import StateSpecialist

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def emotion(**updates):
    """완전한 기존 감정 8축 fixture입니다. 실제 감정 분류를 수행하지 않습니다."""
    return EmotionState(**{**dict.fromkeys("FADJCGTR", 0.2), "confidence": 0.8, "observed_at": NOW, **updates})


def context(**updates):
    """호출자가 명시한 유효 창을 사용하며 Agent 내부 시간 기준을 만들지 않습니다."""
    return StateContext(as_of=NOW, max_age_seconds=3600, **updates)


def run(**updates):
    """테스트에서만 직접 호출하고 제품 경로에는 연결하지 않습니다."""
    return StateSpecialist().run(context(**updates))


class StateTests(unittest.TestCase):
    """중요한 독립 축 조합과 누락/오류를 재현 가능한 입력으로 검사합니다."""

    def test_active_observations_without_action(self):
        result = run(body=BodyState(energy=0.9), cognitive=CognitiveState(focus=0.9, motivation=0.9))
        self.assertIn("신체 에너지 높음", result.conclusion)
        self.assertIn("집중 높음", result.conclusion)
        self.assertIn("동기 높음", result.conclusion)
        self.assertEqual(result.suggested_actions, [])

    def test_low_energy_high_motivation(self):
        result = run(body=BodyState(energy=0), cognitive=CognitiveState(motivation=1))
        self.assertIn("신체 에너지 낮음", result.conclusion)
        self.assertIn("동기 높음", result.conclusion)
        self.assertIn("energy=0.0", result.evidence[0].summary)

    def test_focus_and_load(self):
        result = run(cognitive=CognitiveState(focus=0.9, mental_load=0.9))
        self.assertIn("집중 높음", result.conclusion)
        self.assertIn("인지 부담 높음", result.conclusion)

    def test_clarity_and_uncertainty(self):
        result = run(cognitive=CognitiveState(clarity=0.9, uncertainty=0.9))
        self.assertIn("명료함 높음", result.conclusion)
        self.assertIn("불확실성 높음", result.conclusion)

    def test_good_emotion_does_not_create_energy(self):
        result = run(emotion=emotion(J=0.9), body=BodyState())
        self.assertNotIn("신체 에너지", result.conclusion)
        self.assertTrue(all("energy=" not in item.summary for item in result.evidence))

    def test_emotion_tension_does_not_create_body_tension(self):
        result = run(emotion=emotion(F=0.9, T=0.9), body=BodyState())
        self.assertNotIn("신체 긴장", result.conclusion)

    def test_body_only(self):
        result = run(body=BodyState(fatigue=1))
        self.assertIn("피로 높음", result.conclusion)
        self.assertNotIn("우울", result.conclusion)
        self.assertEqual(result.result_status, "NEEDS_INPUT")

    def test_cognitive_only(self):
        result = run(cognitive=CognitiveState(focus=0))
        self.assertNotIn("동기", result.conclusion)
        self.assertTrue(result.needs_user_input)

    def test_emotion_only(self):
        self.assertEqual(len(run(emotion=emotion()).evidence), 1)

    def test_empty_context(self):
        result = run()
        self.assertIsNone(result.confidence)
        self.assertIn("insufficient_context", [risk.code for risk in result.risks])

    def test_unknown_confidence(self):
        self.assertIsNone(run(body=BodyState(energy=1), cognitive=CognitiveState(motivation=1, confidence=0.9)).confidence)

    def test_minimum_confidence(self):
        result = run(emotion=emotion(), body=BodyState(energy=1, confidence=0.4), cognitive=CognitiveState(focus=1, confidence=0.9))
        self.assertEqual(result.confidence, 0.4)

    def test_non_finite_and_invalid_scores(self):
        for value in (float("nan"), float("inf"), -0.1, 1.1, True, "0.5"):
            for model, field in ((BodyState, "energy"), (CognitiveState, "focus"), (BodyState, "confidence")):
                with self.subTest(value=value, field=field), self.assertRaises(ValidationError): model(**{field: value})
            with self.assertRaises(ValidationError): emotion(J=value)

    def test_name_and_registry(self):
        registry = SpecialistRegistry(); specialist = StateSpecialist(); registry.register(specialist)
        self.assertIs(registry.get("state"), specialist)
        self.assertEqual(registry.get("state").run(context()).agent_name, "state")

    def test_failure_does_not_damage_registry(self):
        registry = SpecialistRegistry(); registry.register(StateSpecialist())
        with self.assertRaises(TypeError): registry.get("state").run(SpecialistInput(current_utterance="wrong context"))
        self.assertEqual(registry.get("state").run(context()).agent_name, "state")

    def test_stale_and_future_not_current(self):
        result = run(body=BodyState(energy=1, observed_at=NOW-timedelta(days=1)), cognitive=CognitiveState(motivation=1, observed_at=NOW+timedelta(seconds=1)))
        self.assertNotIn("높음", result.conclusion)
        self.assertEqual(len(result.evidence), 2)
        self.assertIn("insufficient_context", [risk.code for risk in result.risks])

    def test_different_observation_times(self):
        result = run(body=BodyState(energy=1, observed_at=NOW), cognitive=CognitiveState(focus=1, observed_at=NOW-timedelta(minutes=45)))
        self.assertIn("different_observation_times", [risk.code for risk in result.risks])

    def test_no_arbitrary_freshness_window(self):
        result = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(energy=1, observed_at=NOW-timedelta(days=2))))
        self.assertIn("freshness_unverified", [risk.code for risk in result.risks])
        self.assertIn("현재성 보장 아님", result.conclusion)

    def test_timezone_and_extras(self):
        with self.assertRaises(ValidationError): StateContext(as_of=datetime(2026, 10, 4))
        with self.assertRaises(ValidationError): BodyState(energy=1, metadata={})
        with self.assertRaises(ValidationError): context(memory={})

    def test_all_unknown_is_insufficient(self):
        self.assertIn("insufficient_context", [risk.code for risk in run(body=BodyState(), cognitive=CognitiveState()).risks])

    def test_zero_is_observation_not_unknown(self):
        """축과 confidence가 0이어도 관찰이 없는 상황으로 바꾸지 않습니다."""
        result = run(body=BodyState(energy=0, confidence=0, observed_at=NOW))
        self.assertEqual(result.confidence, 0)
        self.assertIn("energy=0.0", result.evidence[0].summary)
        self.assertNotIn("insufficient_context", [risk.code for risk in result.risks])

    def test_freshness_boundary_and_excluded_confidence(self):
        """경계 시각은 포함하고 오래된 관찰의 높은 confidence는 합성에 사용하지 않습니다."""
        result = run(body=BodyState(energy=1, confidence=0.4, observed_at=NOW-timedelta(seconds=3600)), cognitive=CognitiveState(motivation=1, confidence=1, observed_at=NOW-timedelta(seconds=3601)))
        self.assertEqual(result.confidence, 0.4)
        self.assertNotIn("동기 높음", result.conclusion)

    def test_full_context_preserves_axes(self):
        """모든 축이 동시에 높아도 모순으로 삭제하거나 평균하지 않습니다."""
        result = run(emotion=emotion(**dict.fromkeys("FADJCGTR", 1)), body=BodyState(**dict.fromkeys(("fatigue", "sleepiness", "energy", "hunger", "physical_tension", "discomfort"), 1), observed_at=NOW, confidence=0.7), cognitive=CognitiveState(**dict.fromkeys(("focus", "mental_load", "motivation", "uncertainty", "clarity"), 1), observed_at=NOW, confidence=0.9))
        self.assertEqual(len(result.evidence), 3)
        self.assertEqual(result.result_status, "OK")
        self.assertEqual(result.confidence, 0.7)
        self.assertEqual(result.suggested_actions, [])

    def test_constructed_context_revalidation(self):
        """공통 run이 StateContext 확장 필드까지 재검증하는지 확인합니다."""
        bad = StateContext.model_construct(as_of=NOW, body=BodyState.model_construct(energy=float("nan")))
        with self.assertRaises(ValidationError): StateSpecialist().run(bad)

    def test_no_automatic_registration(self):
        """Agent를 만들거나 실행해도 별도 registry에는 아무것도 등록하지 않습니다."""
        registry = SpecialistRegistry()
        run(body=BodyState(energy=0.8))
        self.assertEqual(registry.list(), ())

    def test_repeat_is_deterministic_and_input_unchanged(self):
        """시스템 시각이나 내부 상태에 의존하지 않고 입력을 변경하지 않습니다."""
        item = context(body=BodyState(energy=0.8, confidence=0.6, observed_at=NOW))
        snapshot = item.model_dump()
        specialist = StateSpecialist()
        self.assertEqual(specialist.run(item), specialist.run(item))
        self.assertEqual(item.model_dump(), snapshot)


if __name__ == "__main__":
    unittest.main(verbosity=2)
