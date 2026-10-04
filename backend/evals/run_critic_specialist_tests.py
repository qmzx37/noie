"""Critic의 제한된 검토 계약을 결정론적으로 검사합니다. DB/OpenAI 호출은 없습니다."""

import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from agent.lv4.critic_context import CriticConstraints, CriticContext
from agent.lv4.critic_specialist import CriticSpecialist
from agent.lv4.recommendation_context import MemoryContext, RelationshipContext, ScheduleContext
from agent.lv4.registry import SpecialistRegistry
from agent.lv4.schemas import AgentOpinion, OpinionEvidence, SpecialistInput, SuggestedAction
from agent.lv4.state_context import BodyState, CognitiveState, StateContext
from agent.lv4.state_specialist import StateSpecialist

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def recommendation(text="20분 개발하고 다시 선택해볼까요?", **updates):
    """잘못된 후보도 검토할 수 있도록 Phase 1 opinion 계약으로 직접 만듭니다."""
    values = {"agent_name": "recommendation", "conclusion": text, "confidence": 0.8, "evidence": [OpinionEvidence(source_type="utterance", summary="지금 개발할까?", evidence_ref="current")], "suggested_actions": [SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="suggest", summary=text)]}
    return AgentOpinion(**{**values, **updates})


def context(**updates):
    """모든 검사에 고정 기준 시각을 사용합니다."""
    return CriticContext(**{"current_utterance": "지금 개발할까?", "reference_time": NOW, **updates})


def review(**updates):
    """제품 자동 실행이 아닌 명시적 테스트 호출입니다."""
    return CriticSpecialist().run(context(**updates))


def codes(result):
    """risk가 순서와 무관하게 정확한 유형으로 분류됐는지 확인합니다."""
    return {item.code for item in result.risks}


class CriticTests(unittest.TestCase):
    """검토의 양성/음성 경계와 최종 명령을 하지 않는 계약을 검사합니다."""

    def test_consistent_pass(self):
        state = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(energy=0.9, observed_at=NOW, confidence=0.9), cognitive=CognitiveState(focus=0.9, motivation=0.9, observed_at=NOW, confidence=0.8)))
        result = review(state_opinion=state, recommendation_opinion=recommendation())
        self.assertEqual(result.risks, [])
        self.assertIn("PASS", result.conclusion)

    def test_past_risk_is_not_stop(self):
        result = review(current_utterance="2시간 더 개발하고 싶어", recommendation_opinion=recommendation("2시간 더 개발해볼까요?"), relevant_constraints=CriticConstraints(memories=[MemoryContext(content="과거 장시간 개발 뒤 피로 경험", relevance=0.9)]))
        self.assertIn("historical_risk", codes(result))
        self.assertNotIn("STOP", result.conclusion)
        self.assertNotIn("중단", " ".join(item.summary for item in result.suggested_actions))

    def test_rest_decision_violation(self):
        result = review(current_utterance="오늘은 완전히 쉬기로 했어", recommendation_opinion=recommendation("15분만 개발해"))
        self.assertIn("current_intent_violation", codes(result))

    def test_unknown_energy_cannot_infer_fatigue(self):
        state = StateSpecialist().run(StateContext(as_of=NOW, cognitive=CognitiveState(motivation=0.1, confidence=0.7, observed_at=NOW)))
        result = review(state_opinion=state, recommendation_opinion=recommendation("몸이 피곤하니 쉬어"))
        self.assertIn("unsupported_inference", codes(result))

    def test_close_schedule_conflict(self):
        constraints = CriticConstraints(schedules=[ScheduleContext(title="약속", start_at=NOW+timedelta(hours=1), relevance=1)])
        self.assertIn("schedule_conflict", codes(review(recommendation_opinion=recommendation("2시간 새 작업 시작"), relevant_constraints=constraints)))

    def test_no_recommendation_pass(self):
        result = review(recommendation_opinion=recommendation("추가 추천 없음", result_status="NO_RECOMMENDATION", suggested_actions=[], evidence=[]))
        self.assertEqual(result.risks, [])
        self.assertEqual(result.suggested_actions, [])

    def test_memory_overapplication(self):
        memory = OpinionEvidence(source_type="memory", summary="과거 개발 실패", interpretation=True)
        result = review(recommendation_opinion=recommendation("과거 실패 때문에 개발하면 안 돼", evidence=[memory]))
        self.assertIn("memory_overapplication", codes(result))

    def test_low_confidence_strong_conclusion(self):
        self.assertIn("confidence_overstatement", codes(review(recommendation_opinion=recommendation("확실히 지금 개발이 정답", confidence=0.1))))

    def test_uncertainty_is_not_certainty(self):
        """불확실성 축과 확신의 부정을 과도한 단정으로 오인하지 않습니다."""
        for text in ("불확실성 높음", "확실하지 않음", "확실하지 않아", "확실한 것은 아님"):
            with self.subTest(text=text):
                state = AgentOpinion(agent_name="state", conclusion=text, confidence=None)
                self.assertEqual(review(state_opinion=state).risks, [])
                self.assertEqual(review(recommendation_opinion=recommendation(text, confidence=0.1, evidence=[])).risks, [])

    def test_insufficient_evidence(self):
        result = review(recommendation_opinion=recommendation("몸이 피곤하니 확실히 쉬어", evidence=[]))
        self.assertIn("insufficient_evidence", codes(result))
        self.assertEqual(result.result_status, "NEEDS_INPUT")

    def test_coercion_and_guilt(self):
        result = review(recommendation_opinion=recommendation("이번 주 못 했으니 무조건 해야 한다"))
        self.assertIn("coercion", codes(result))
        self.assertIn("guilt_pressure", codes(result))

    def test_too_many_candidates(self):
        candidates = [SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="suggest", summary=f"후보 {index}") for index in range(4)]
        result = review(recommendation_opinion=recommendation(suggested_actions=candidates))
        self.assertIn("too_many_candidates", codes(result))
        self.assertLessEqual(len(result.suggested_actions), 2)

    def test_relationship_overinterpretation(self):
        relationship = RelationshipContext(person_label="민수", summary="민수는 내 친구", relevance=1, record_kind="social_relation", temporal_scope="current")
        result = review(current_utterance="민수 만나러 갈까?", recommendation_opinion=recommendation("민수는 널 싫어하니 만나지 마"), relevant_constraints=CriticConstraints(relationships=[relationship]))
        self.assertIn("relationship_overinterpretation", codes(result))

    def test_state_recommendation_conflict(self):
        state = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(fatigue=0, observed_at=NOW)))
        self.assertIn("opinion_conflict", codes(review(state_opinion=state, recommendation_opinion=recommendation("몸이 피곤하니 쉬어"))))

    def test_independent_axes_are_not_conflicts(self):
        state = StateSpecialist().run(StateContext(as_of=NOW, body=BodyState(energy=0.1), cognitive=CognitiveState(motivation=1, focus=1, mental_load=1, clarity=1, uncertainty=1)))
        self.assertEqual(review(state_opinion=state, recommendation_opinion=recommendation()).risks, [])

    def test_explicit_user_fatigue_supports_statement(self):
        self.assertNotIn("unsupported_inference", codes(review(current_utterance="몸이 피곤한데 쉴까?", recommendation_opinion=recommendation("몸이 피곤하니 잠깐 쉬어볼까요?"))))

    def test_future_work_does_not_override_today_rest(self):
        self.assertNotIn("current_intent_violation", codes(review(current_utterance="오늘 쉬기로 했어", recommendation_opinion=recommendation("내일 개발을 다시 선택해볼까요?"))))

    def test_no_final_commands(self):
        result = review(recommendation_opinion=recommendation("무조건 개발해야 한다"))
        text = result.conclusion + " ".join(item.summary for item in result.suggested_actions)
        for marker in ("STOP", "무조건", "해야 한다", "하지 마라"):
            self.assertNotIn(marker, text)
        self.assertTrue(all(item.intent == "review_opinion" and item.mode == "suggest" for item in result.suggested_actions))

    def test_registry_and_name(self):
        registry = SpecialistRegistry(); critic = CriticSpecialist(); registry.register(critic)
        self.assertIs(registry.get("critic"), critic)
        self.assertEqual(registry.get("critic").run(context(recommendation_opinion=recommendation())).agent_name, "critic")

    def test_invalid_context(self):
        with self.assertRaises(ValidationError): context(metadata={})
        with self.assertRaises(ValidationError): context(state_opinion=recommendation())
        with self.assertRaises(ValidationError): context(reference_time=datetime(2026, 10, 4))

    def test_failure_does_not_damage_registry(self):
        registry = SpecialistRegistry(); registry.register(CriticSpecialist())
        with self.assertRaises(TypeError): registry.get("critic").run(SpecialistInput(current_utterance="wrong context"))
        self.assertEqual(registry.get("critic").run(context()).agent_name, "critic")

    def test_input_unchanged(self):
        item = context(recommendation_opinion=recommendation("작은 선택 후보를 검토해볼까요?"))
        before = item.model_dump()
        critic = CriticSpecialist(); self.assertEqual(critic.run(item), critic.run(item))
        self.assertEqual(item.model_dump(), before)

    def test_missing_opinions(self):
        self.assertEqual(review().result_status, "NEEDS_INPUT")

    def test_missing_clock_for_schedule(self):
        result = review(reference_time=None, recommendation_opinion=recommendation(), relevant_constraints=CriticConstraints(schedules=[ScheduleContext(title="약속", start_at=NOW+timedelta(hours=1), relevance=1)]))
        self.assertIn("missing_reference_time", codes(result))

    def test_upstream_failure_and_needs_input(self):
        for status in ("ERROR", "NOT_RUN", "NEEDS_INPUT"):
            with self.subTest(status=status):
                item = recommendation("정보 필요", result_status=status, suggested_actions=[], needs_user_input=status == "NEEDS_INPUT")
                self.assertTrue(review(recommendation_opinion=item).needs_user_input)

    def test_short_choice_not_blocked_by_memory(self):
        result = review(recommendation_opinion=recommendation(), relevant_constraints=CriticConstraints(memories=[MemoryContext(content="과거 개발 피로", relevance=1)]))
        self.assertNotIn("historical_risk", codes(result))

    def test_low_relevance_constraint_excluded(self):
        result = review(recommendation_opinion=recommendation("2시간 새 작업"), relevant_constraints=CriticConstraints(schedules=[ScheduleContext(title="무관한 일정", start_at=NOW+timedelta(minutes=1), relevance=0.1)]))
        self.assertNotIn("schedule_conflict", codes(result))

    def test_state_unsupported_statement(self):
        """Recommendation이 없어도 State 자체의 과도한 단정을 검토합니다."""
        state = AgentOpinion(agent_name="state", conclusion="몸이 피곤하니 상태가 확실히 나쁩니다.", confidence=0.1)
        result = review(state_opinion=state)
        self.assertIn("unsupported_state_inference", codes(result))
        self.assertIn("state_confidence_overstatement", codes(result))

    def test_state_trait_inference(self):
        state = AgentOpinion(agent_name="state", conclusion="원래 게으른 성격입니다.", confidence=0.8)
        self.assertIn("trait_inference", codes(review(state_opinion=state)))

    def test_state_role_violation(self):
        state = AgentOpinion(agent_name="state", conclusion="상태", confidence=0.5, suggested_actions=recommendation().suggested_actions)
        self.assertIn("state_role_violation", codes(review(state_opinion=state)))

    def test_risk_budget_preserves_overflow_codes(self):
        state = AgentOpinion(agent_name="state", conclusion="몸이 피곤하니 확실히 원래 게으른 성격입니다.", confidence=0.1, suggested_actions=recommendation().suggested_actions)
        candidates = [SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="execute", summary="무조건 2시간 개발해야 한다") for _ in range(4)]
        rec = recommendation("이번 주 못 했으니 과거 실패 때문에 확실히 2시간 개발해야 한다", confidence=0.1, suggested_actions=candidates, evidence=[OpinionEvidence(source_type="memory", summary="과거 개발 피로")])
        result = review(current_utterance="오늘 쉬기로 했어", state_opinion=state, recommendation_opinion=rec)
        self.assertLessEqual(len(result.risks), 8)
        self.assertIn("additional_concerns", codes(result))
        self.assertLessEqual(len(result.suggested_actions), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
