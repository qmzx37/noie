"""Arbitrator의 결정론적 계약 테스트입니다. DB/OpenAI/실행은 사용하지 않습니다."""

import itertools
import unittest
from datetime import datetime, timezone
from pydantic import ValidationError
from agent.lv4.arbitrator_context import ArbitratorContext
from agent.lv4.arbitrator_specialist import ArbitratorSpecialist
from agent.lv4.critic_context import CriticConstraints, CriticContext
from agent.lv4.critic_specialist import CriticSpecialist
from agent.lv4.recommendation_context import MemoryContext
from agent.lv4.registry import SpecialistRegistry
from agent.lv4.schemas import AgentOpinion, OpinionEvidence, OpinionRisk, SpecialistInput, SuggestedAction
from agent.lv4.state_context import BodyState, CognitiveState, StateContext
from agent.lv4.state_specialist import StateSpecialist

NOW = datetime(2026, 10, 4, tzinfo=timezone.utc)
USER = "지금 개발할까?"


def rec(text="20분 개발", **updates):
    """검증 대상 의견을 만듭니다. 외부 추론 호출은 없습니다."""
    values = dict(agent_name="recommendation", conclusion=text, confidence=0.8, evidence=[OpinionEvidence(source_type="utterance", summary=USER)], suggested_actions=[SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="suggest", summary=text)])
    return AgentOpinion(**{**values, **updates})


def critic(code=None, **updates):
    """현재 발화를 근거로 한 검토 의견입니다."""
    values = dict(agent_name="critic", conclusion="검토", confidence=0.7, evidence=[OpinionEvidence(source_type="utterance", summary=USER)], risks=[] if code is None else [OpinionRisk(code=code, summary="검토할 우려")])
    if code == "historical_risk":
        values["evidence"].append(OpinionEvidence(source_type="memory", summary="과거 장시간 개발 후 피로", interpretation=True, relevance=0.9))
    return AgentOpinion(**{**values, **updates})


def run(**updates):
    """공통 run으로 입력과 출력을 재검증합니다."""
    return ArbitratorSpecialist().run(ArbitratorContext(**{"current_utterance": USER, "reference_time": NOW, **updates}))


class ArbitratorTests(unittest.TestCase):
    """선택권과 근거·불확실성 및 registry 계약을 확인합니다."""

    def test_normal(self):
        result = run(recommendation_opinion=rec(), critic_opinion=critic())
        self.assertEqual(result.agent_name, "arbitrator")
        self.assertEqual(result.result_status, "OK")
        self.assertEqual(len(result.suggested_actions), 1)

    def test_historical_compromise(self):
        result = run(recommendation_opinion=rec("2시간 더 개발"), critic_opinion=critic("historical_risk"))
        self.assertIn("개발", result.suggested_actions[0].summary)
        self.assertIn("다시 선택", result.suggested_actions[0].summary)
        self.assertTrue(any(item.source_type == "memory" for item in result.evidence))
        self.assertNotIn("2시간", result.suggested_actions[0].summary)

    def test_current_decision(self):
        result = run(current_utterance="오늘은 쉬기로 했어", recommendation_opinion=rec("15분 개발"), critic_opinion=critic("current_intent_violation"))
        self.assertEqual(result.result_status, "NO_RECOMMENDATION")
        self.assertEqual(result.suggested_actions, [])
        self.assertEqual(len(result.evidence), 1)

    def test_decision_without_critic(self):
        self.assertEqual(run(current_utterance="오늘은 쉰다", recommendation_opinion=rec()).result_status, "NO_RECOMMENDATION")

    def test_reopened_question(self):
        text = "쉬기로 했는데 개발할까?"
        self.assertEqual(run(current_utterance=text, recommendation_opinion=rec(evidence=[OpinionEvidence(source_type="utterance", summary=text)])).result_status, "OK")

    def test_weak_concern_not_veto(self):
        result = run(recommendation_opinion=rec(), critic_opinion=critic("weak_past_risk"))
        self.assertEqual(len(result.suggested_actions), 1)
        self.assertEqual(result.confidence, 0.7)

    def test_unsupported_cause_removed(self):
        result = run(recommendation_opinion=rec("몸이 피곤하니 쉬어"), critic_opinion=critic("unsupported_inference"))
        self.assertNotIn("피곤", result.conclusion + result.suggested_actions[0].summary)
        self.assertIn("쉬어", result.suggested_actions[0].summary)

    def test_unsplittable_unsupported(self):
        result = run(recommendation_opinion=rec("몸이 피곤한 상태"), critic_opinion=critic("unsupported_inference"))
        self.assertTrue(result.needs_user_input)

    def test_schedule_adjustment(self):
        text = run(recommendation_opinion=rec("2시간 새 작업"), critic_opinion=critic("schedule_conflict")).suggested_actions[0].summary
        self.assertIn("일정 전 가능한 범위", text)
        self.assertNotIn("2시간", text)

    def test_no_recommendation(self):
        result = run(recommendation_opinion=rec(result_status="NO_RECOMMENDATION", suggested_actions=[]), critic_opinion=critic())
        self.assertEqual(result.result_status, "NO_RECOMMENDATION")
        self.assertEqual(result.suggested_actions, [])

    def test_unknown_confidence(self):
        self.assertIsNone(run(recommendation_opinion=rec(confidence=None)).confidence)

    def test_min_confidence(self):
        self.assertEqual(run(recommendation_opinion=rec(confidence=0.3), critic_opinion=critic(confidence=0.9)).confidence, 0.3)

    def test_partial_state_unknown(self):
        observation = OpinionEvidence(source_type="state", summary="body: energy=0.8", observed_at=NOW)
        state = AgentOpinion(agent_name="state", conclusion="일부 관찰", confidence=None, evidence=[observation], needs_user_input=True, result_status="NEEDS_INPUT")
        result = run(state_opinion=state, recommendation_opinion=rec(evidence=[OpinionEvidence(source_type="utterance", summary=USER), observation]))
        self.assertIsNone(result.confidence)
        self.assertFalse(result.needs_user_input)

    def test_required_conflict(self):
        result = run(recommendation_opinion=rec(), critic_opinion=critic("opinion_conflict"))
        self.assertTrue(result.needs_user_input)
        self.assertEqual(result.confidence, 0.35)

    def test_no_evidence_no_claim(self):
        result = run(recommendation_opinion=rec(evidence=[], confidence=1))
        self.assertTrue(result.needs_user_input)
        self.assertEqual(result.suggested_actions, [])

    def test_unrelated_utterance(self):
        self.assertTrue(run(recommendation_opinion=rec(evidence=[OpinionEvidence(source_type="utterance", summary="다른 질문")])).needs_user_input)

    def test_unsubstantiated_critic(self):
        result = run(recommendation_opinion=rec(), critic_opinion=critic("historical_risk", evidence=[]))
        self.assertEqual(len(result.suggested_actions), 1)
        self.assertNotIn("다시 선택", result.suggested_actions[0].summary)

    def test_candidate_limit(self):
        actions = [SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="suggest", summary=f"개발 후보 {i}") for i in range(4)]
        self.assertEqual(len(run(recommendation_opinion=rec(suggested_actions=actions)).suggested_actions), 2)

    def test_no_new_action(self):
        result = run(recommendation_opinion=rec("개발"), critic_opinion=critic("historical_risk"))
        self.assertNotIn("산책", result.suggested_actions[0].summary)
        self.assertEqual(result.suggested_actions[0].type, "recommendation")

    def test_execute_excluded(self):
        action = SuggestedAction(type="schedule", intent="create_schedule", mode="execute", summary="일정 생성")
        self.assertEqual(run(recommendation_opinion=rec(suggested_actions=[action])).suggested_actions, [])

    def test_empty_candidates(self):
        self.assertEqual(run(recommendation_opinion=rec(suggested_actions=[])).suggested_actions, [])

    def test_essential_input(self):
        self.assertTrue(run(recommendation_opinion=rec(result_status="NEEDS_INPUT", needs_user_input=True, suggested_actions=[])).needs_user_input)

    def test_failure_isolation(self):
        self.assertEqual(run(recommendation_opinion=rec(), critic_opinion=critic(result_status="ERROR", evidence=[])).result_status, "OK")

    def test_none_combinations(self):
        state = AgentOpinion(agent_name="state", conclusion="관찰 없음", confidence=None)
        for a, b, c in itertools.product((False, True), repeat=3):
            with self.subTest(a=a, b=b, c=c):
                result = run(state_opinion=state if a else None, recommendation_opinion=rec() if b else None, critic_opinion=critic() if c else None)
                self.assertEqual(result.agent_name, "arbitrator")

    def test_registry(self):
        registry = SpecialistRegistry(); agent = ArbitratorSpecialist(); registry.register(agent)
        self.assertIs(registry.get("arbitrator"), agent)
        self.assertEqual(registry.get("arbitrator").run(ArbitratorContext(current_utterance=USER)).agent_name, "arbitrator")

    def test_invalid_context(self):
        with self.assertRaises(ValidationError): ArbitratorContext(current_utterance=USER, state_opinion=rec())
        with self.assertRaises(ValidationError): ArbitratorContext(current_utterance=USER, metadata={})
        with self.assertRaises(ValidationError): ArbitratorContext(current_utterance=USER, reference_time=datetime(2026, 10, 4))

    def test_registry_after_failure(self):
        registry = SpecialistRegistry(); registry.register(ArbitratorSpecialist())
        with self.assertRaises(TypeError): registry.get("arbitrator").run(SpecialistInput(current_utterance=USER))
        self.assertEqual(registry.get("arbitrator").run(ArbitratorContext(current_utterance=USER)).agent_name, "arbitrator")

    def test_immutable(self):
        context = ArbitratorContext(current_utterance=USER, recommendation_opinion=rec(), critic_opinion=critic())
        before = context.model_dump(); agent = ArbitratorSpecialist()
        self.assertEqual(agent.run(context), agent.run(context))
        self.assertEqual(context.model_dump(), before)

    def test_coercion_not_repeated(self):
        result = run(recommendation_opinion=rec("무조건 개발해야 한다"), critic_opinion=critic("coercion"))
        self.assertNotIn("무조건", result.conclusion)
        self.assertEqual(result.suggested_actions, [])

    def test_actual_specialist_compromise(self):
        """현재 좋은 관찰과 과거 피로를 함께 넣어도 현재 개발 의사를 취소하지 않습니다."""
        text = "2시간 더 개발하고 싶어"
        state = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(energy=0.9, observed_at=NOW, confidence=0.9), cognitive=CognitiveState(focus=0.9, motivation=0.9, observed_at=NOW, confidence=0.8)))
        recommendation = rec("2시간 더 개발", evidence=[OpinionEvidence(source_type="utterance", summary=text), *state.evidence])
        review = CriticSpecialist().run(CriticContext(current_utterance=text, state_opinion=state, recommendation_opinion=recommendation, relevant_constraints=CriticConstraints(memories=[MemoryContext(content="과거 장시간 개발 피로", relevance=1)])))
        result = run(current_utterance=text, state_opinion=state, recommendation_opinion=recommendation, critic_opinion=review)
        self.assertEqual(result.result_status, "OK")
        self.assertIn("다시 선택", result.suggested_actions[0].summary)
        self.assertTrue(any(item.source_type == "memory" for item in result.evidence))

    def test_actual_critic_unsupported(self):
        recommendation = rec("몸이 피곤하니 쉬어")
        review = CriticSpecialist().run(CriticContext(current_utterance=USER, recommendation_opinion=recommendation))
        result = run(recommendation_opinion=recommendation, critic_opinion=review)
        self.assertNotIn("피곤", result.suggested_actions[0].summary)

    def test_unrelated_critic_evidence(self):
        review = critic("coercion", evidence=[OpinionEvidence(source_type="opinion", evidence_ref="recommendation", summary="다른 추천")])
        self.assertEqual(run(recommendation_opinion=rec(), critic_opinion=review).result_status, "OK")

    def test_confidence_words_weakened(self):
        result = run(recommendation_opinion=rec("확실히 개발이 정답", confidence=0.2), critic_opinion=critic("confidence_overstatement"))
        self.assertNotIn("확실히", result.suggested_actions[0].summary)
        self.assertNotIn("정답", result.suggested_actions[0].summary)
        self.assertLessEqual(result.confidence, 0.2)

    def test_rejection(self):
        self.assertEqual(run(current_utterance="추천하지 마", recommendation_opinion=rec()).result_status, "NO_RECOMMENDATION")

    def test_evidence_limit_and_future_exclusion(self):
        from datetime import timedelta
        memories = [OpinionEvidence(source_type="memory", summary=f"관련 기억 {i}", relevance=0.9) for i in range(14)]
        future = OpinionEvidence(source_type="memory", summary="미래 기억", observed_at=NOW+timedelta(days=1))
        result = run(recommendation_opinion=rec(evidence=[OpinionEvidence(source_type="utterance", summary=USER), *memories, future]))
        self.assertLessEqual(len(result.evidence), 16)
        self.assertNotIn(future, result.evidence)

    def test_needs_input_has_no_choices(self):
        result = run(recommendation_opinion=rec(), critic_opinion=critic("opinion_conflict"))
        self.assertEqual(result.suggested_actions, [])

    def test_partial_without_reference_not_fabricated(self):
        state = AgentOpinion(agent_name="state", conclusion="에너지 unknown", confidence=None, result_status="NEEDS_INPUT", needs_user_input=True)
        result = run(state_opinion=state, recommendation_opinion=rec())
        self.assertNotIn("에너지", result.conclusion)
        self.assertFalse(result.needs_user_input)

    def test_evidence_deduplicated(self):
        result = run(recommendation_opinion=rec(), critic_opinion=critic())
        self.assertEqual(sum(item.source_type == "utterance" for item in result.evidence), 1)

    def test_suggest_only_no_final_command(self):
        result = run(recommendation_opinion=rec(), critic_opinion=critic("weak_past_risk"))
        self.assertTrue(all(item.mode == "suggest" for item in result.suggested_actions))
        for marker in ("STOP", "해야 한다", "하지 마라", "무조건"):
            self.assertNotIn(marker, result.conclusion)


if __name__ == "__main__":
    unittest.main(verbosity=2)
