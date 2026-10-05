"""read 결과 -> Bridge -> 네 Specialist 연결을 DB/OpenAI 없이 검증합니다."""

import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from pydantic import ValidationError

from agent.lv4.context_bridge import ContextProviders, Lv4ContextBridge
from agent.lv4.place_context import PlaceContext
from agent.lv4.read_providers import make_read_providers
from agent.lv4.recommendation_context import RecommendationContext
from agent.lv4.recommendation_specialist import RecommendationDecision, prepare_evidence
from agent.lv4.critic_context import CriticContext
from agent.lv4.critic_specialist import CriticSpecialist
from agent.lv4.arbitrator_context import ArbitratorContext
from agent.lv4.arbitrator_specialist import ArbitratorSpecialist
from agent.lv4.registry import SpecialistRegistry
from agent.lv4.schemas import AgentOpinion, OpinionEvidence, SuggestedAction
from agent.recommendation_schemas import RecommendationArguments
from evals.run_collaboration_pipeline_tests import pipeline

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
USER_ID = uuid4()
QUESTION = "민수랑 피곤한데 카페 갈까 개발할까?"


def place(**updates):
    """실제 Place 필드 이름을 사용하며 visit에 선호를 붙이지 않습니다."""
    return {"place_name": "광안리 카페", "kind": "visit", "preference": None, "occurred_at": NOW-timedelta(hours=1), "created_at": NOW, **updates}


def data():
    """source별 실제 read 응답에서 사용하는 필드만 기본 fixture로 만듭니다."""
    return dict(memory=[{"content": "카페에서 개발한 경험", "relevance": 0.9}], emotion=[{**dict.fromkeys("FADJCGTR", 0.2), "confidence": 0.8, "created_at": NOW}],
        body=[{"energy": 0.0, "fatigue": None, "confidence": 0.8, "created_at": NOW}], cognitive=[{"focus": 0.8, "motivation": None, "confidence": 0.8, "created_at": NOW}],
        schedule=[{"title": "수업", "start_at": NOW+timedelta(hours=1), "end_at": None}],
        relationship=[{"person_label": "민수", "relationship_statement": "민수는 내 친구", "record_kind": "social_relation", "temporal_scope": "current", "confidence": 0.8, "created_at": NOW}], place=[place()])


def bridge(rows=None):
    """테스트용 provider를 명시적으로 주입하며 생성만으로 조회하지 않습니다."""
    rows = data() if rows is None else rows
    calls = []
    def callback(name):
        def read(user_id, question, now):
            calls.append((name, user_id, question, now))
            return rows.get(name, [])
        return read
    return Lv4ContextBridge(ContextProviders(**{name: callback(name) for name in ContextProviders.__dataclass_fields__})), calls


def build(rows=None, question=QUESTION):
    """같은 기준 시각/원문으로 context를 생성합니다."""
    return bridge(rows)[0].build(user_id=USER_ID, current_utterance=question, reference_time=NOW)


class PlaceReasoner:
    """장소 evidence가 실제 reasoner까지 도달하는지 확인하는 deterministic stub입니다."""
    def __init__(self):
        self.evidence = []
    def __call__(self, context, evidence):
        self.evidence = evidence
        return RecommendationDecision(recommendation=RecommendationArguments(primary_action="광안리 카페를 후보로 살펴볼까요?", rationale="현재 선택 질문의 근거만 참고합니다.", confidence=0.6, recommendation_kind="direct"), used_evidence_refs=[item.evidence_ref for item in evidence][:12])


class BridgeTests(unittest.TestCase):
    """privacy, unknown, 관련성, 장애, 기존 pipeline 연결의 양성/음성 경계를 검사합니다."""

    def test_all_sources(self):
        result = build()
        self.assertEqual(result.bridge_status, "COMPLETE")
        self.assertTrue(all(item.status == "loaded" for item in result.diagnostics))

    def test_empty_memory(self):
        rows = data(); rows["memory"] = []
        self.assertEqual(build(rows).context.relevant_constraints.memories, [])

    def test_empty_schedule(self):
        rows = data(); rows["schedule"] = []
        self.assertEqual(build(rows).context.relevant_constraints.schedules, [])

    def test_empty_relationship(self):
        rows = data(); rows["relationship"] = []
        self.assertEqual(build(rows).context.relevant_constraints.relationships, [])

    def test_empty_place(self):
        rows = data(); rows["place"] = []
        self.assertEqual(build(rows).context.places, [])

    def test_partial_state(self):
        rows = data(); rows["emotion"] = []; rows["cognitive"] = []
        result = build(rows)
        self.assertIsNone(result.context.state_context.emotion)
        self.assertIsNone(result.context.state_context.cognitive)
        self.assertIsNotNone(result.context.state_context.body)

    def test_all_empty(self):
        result = build({})
        self.assertEqual(result.bridge_status, "COMPLETE")
        self.assertTrue(all(item.status == "empty" for item in result.diagnostics))

    def test_unknown_zero(self):
        state = build().context.state_context
        self.assertEqual(state.body.energy, 0)
        self.assertIsNone(state.body.fatigue)
        self.assertIsNone(state.cognitive.motivation)

    def test_memory_limit(self):
        rows = data(); rows["memory"] = [{"content": f"개발 기억 {i}", "relevance": 0.9} for i in range(10)]
        self.assertEqual(len(build(rows).context.relevant_constraints.memories), 4)

    def test_low_relevance_memory(self):
        rows = data(); rows["memory"] = [{"content": "개발 기억", "relevance": 0.1}]*4 + [{"content": "카페 개발 실제 관련", "relevance": 0.9}]
        self.assertEqual(len(build(rows).context.relevant_constraints.memories), 1)

    def test_schedule_limit(self):
        rows = data(); rows["schedule"] = [{"title": f"수업 {i}", "start_at": NOW+timedelta(minutes=30+i)} for i in range(10)]
        self.assertEqual(len(build(rows).context.relevant_constraints.schedules), 3)

    def test_relationship_limit(self):
        rows = data(); rows["relationship"] *= 10
        self.assertEqual(len(build(rows).context.relevant_constraints.relationships), 3)

    def test_place_limit(self):
        rows = data(); rows["place"] = [place(place_name=f"카페 {i}") for i in range(10)]
        self.assertEqual(len(build(rows).context.places), 3)

    def test_destination_question(self):
        self.assertEqual(len(build(question="오늘 어디 갈까?").context.places), 1)

    def test_non_place_question_skips_provider(self):
        instance, calls = bridge()
        result = instance.build(user_id=USER_ID, current_utterance="오늘 개발 더 할까?", reference_time=NOW)
        self.assertEqual(result.context.places, [])
        self.assertNotIn("place", [call[0] for call in calls])

    def test_visit_not_preference(self):
        item = build().context.places[0]
        self.assertEqual(item.kind, "visit"); self.assertIsNone(item.preference); self.assertIsNone(item.confidence)

    def test_explicit_preference(self):
        rows = data(); rows["place"] = [place(kind="preference", preference="dislike")]
        self.assertEqual(build(rows).context.places[0].preference, "dislike")

    def test_old_irrelevant_place(self):
        rows = data(); rows["place"] = [place(occurred_at=NOW-timedelta(days=3)), place(place_name="서면 라멘집"), place(kind="context", occurred_at=NOW-timedelta(hours=3))]
        self.assertEqual(build(rows).context.places, [])

    def test_explicit_named_place(self):
        rows = data(); rows["place"] = [place(place_name="광안리")]
        self.assertEqual(len(build(rows, question="광안리 또 갈까?").context.places), 1)

    def test_no_ids_metadata(self):
        rows = data()
        for items in rows.values():
            for item in items: item.update(id="private-id", metadata={"secret": "private-value"}, user_id=USER_ID)
        encoded = build(rows).model_dump_json()
        for forbidden in ("private-id", "private-value", str(USER_ID), "metadata", "conversation_id", "agent_action_id"):
            self.assertNotIn(forbidden, encoded)

    def test_current_message(self):
        text = QUESTION + "  \n"
        self.assertEqual(build(question=text).context.current_utterance, text)

    def test_di_no_auto_call(self):
        instance, calls = bridge(); self.assertEqual(calls, [])
        instance.build(user_id=USER_ID, current_utterance=QUESTION, reference_time=NOW)
        self.assertEqual(len(calls), 7)
        self.assertTrue(all(call[1] == USER_ID and call[2] == QUESTION for call in calls))

    def test_failure_vs_empty(self):
        def failing(*args): raise RuntimeError("SECRET internal failure")
        result = Lv4ContextBridge(ContextProviders(place=failing)).build(user_id=USER_ID, current_utterance="카페 갈까?", reference_time=NOW)
        self.assertEqual(result.bridge_status, "PARTIAL")
        self.assertEqual(next(item.status for item in result.diagnostics if item.source == "place"), "failed")
        self.assertNotIn("SECRET", result.model_dump_json())

    def test_same_input_deterministic(self):
        instance, _ = bridge()
        self.assertEqual(instance.build(user_id=USER_ID, current_utterance=QUESTION, reference_time=NOW), instance.build(user_id=USER_ID, current_utterance=QUESTION, reference_time=NOW))

    def test_no_cross_domain_inference(self):
        rows = data(); rows["body"] = []; rows["cognitive"] = []
        state = build(rows).context.state_context
        self.assertIsNone(state.body); self.assertIsNone(state.cognitive)

    def test_pipeline_place_integration(self):
        fake = PlaceReasoner(); instance, agents, _, _ = pipeline(fake)
        result = instance.run(build(question="카페 갈까?").context)
        self.assertEqual(result.pipeline_status, "COMPLETED")
        self.assertTrue(any(item.source_type == "place" for item in fake.evidence))
        self.assertTrue(agents[1].contexts[0].places)
        self.assertNotIn("places", agents[3].contexts[0].model_dump())
        self.assertTrue(any(item.source_type == "place" for item in result.arbitrator_opinion.evidence))

    def test_pipeline_without_place(self):
        rows = data(); rows["place"] = []
        self.assertEqual(pipeline()[0].run(build(rows).context).pipeline_status, "COMPLETED")

    def test_place_question_receives_fresh_state_evidence(self):
        """어디 갈지 선택할 때 상태는 직접 관측 근거로만 전달합니다."""
        fake = PlaceReasoner()
        pipeline(fake)[0].run(build(question="오늘 어디 갈까?").context)
        self.assertTrue(any(item.source_type == "state" and item.summary.startswith("body:") for item in fake.evidence))

    def test_no_global_registration(self):
        registry = SpecialistRegistry(); build()
        self.assertEqual(registry.list(), ())

    def test_no_bridge_recommendation(self):
        self.assertFalse(hasattr(build(), "recommendation_opinion"))

    def test_future_and_stale_state(self):
        rows = data(); rows["body"][0]["created_at"] = NOW+timedelta(seconds=1); rows["emotion"][0]["created_at"] = NOW-timedelta(hours=3)
        state = build(rows).context.state_context
        self.assertIsNone(state.body); self.assertIsNone(state.emotion)

    def test_foreign_owner_failed(self):
        rows = data(); rows["place"][0]["user_id"] = uuid4()
        result = build(rows)
        self.assertEqual(result.context.places, [])
        self.assertEqual(next(item.status for item in result.diagnostics if item.source == "place"), "failed")

    def test_invalid_score_failed(self):
        rows = data(); rows["body"][0]["energy"] = float("nan")
        self.assertEqual(next(item.status for item in build(rows).diagnostics if item.source == "body"), "failed")

    def test_current_decision_no_provider_calls(self):
        instance, calls = bridge()
        result = instance.build(user_id=USER_ID, current_utterance="오늘은 집에서 쉬기로 했어", reference_time=NOW)
        self.assertEqual(calls, [])
        self.assertEqual(pipeline()[0].run(result.context).arbitrator_opinion.result_status, "NO_RECOMMENDATION")

    def test_unknown_occurrence(self):
        rows = data(); rows["place"] = [place(occurred_at=None)]
        self.assertIsNone(build(rows).context.places[0].occurred_at)

    def test_place_schema_invalid(self):
        with self.assertRaises(ValidationError): PlaceContext(**{**place(), "preference": "like"}, relevance=1)

    def test_old_place_critic(self):
        item = PlaceContext(**place(occurred_at=NOW-timedelta(days=3)), relevance=1)
        source = OpinionEvidence(source_type="place", summary=json.dumps(item.model_dump(mode="json", exclude={"relevance", "confidence"}), ensure_ascii=False), relevance=1)
        rec = AgentOpinion(agent_name="recommendation", conclusion="광안리 카페를 후보로 검토", confidence=0.5, evidence=[source])
        result = CriticSpecialist().run(CriticContext(current_utterance="카페 갈까?", reference_time=NOW, recommendation_opinion=rec))
        self.assertIn("stale_place_overapplication", {item.code for item in result.risks})

    def test_explicit_preference_critic_pass(self):
        item = PlaceContext(**place(kind="preference", preference="like"), relevance=1)
        source = OpinionEvidence(source_type="place", summary=json.dumps(item.model_dump(mode="json", exclude={"relevance", "confidence"}), ensure_ascii=False), relevance=1)
        rec = AgentOpinion(agent_name="recommendation", conclusion="광안리 카페를 좋아하는 근거를 참고", confidence=0.5, evidence=[source])
        result = CriticSpecialist().run(CriticContext(current_utterance="카페 갈까?", reference_time=NOW, recommendation_opinion=rec))
        self.assertNotIn("place_preference_inference", {item.code for item in result.risks})

    def test_read_provider_reuses_service_and_closes(self):
        db = MagicMock(); factory = MagicMock(); factory.return_value.__enter__.return_value = db
        row = SimpleNamespace(user_id=USER_ID, conversation_id=None, created_at=NOW, place_name="카페", kind="visit", preference=None, occurred_at=None, metadata_={"secret": "no"})
        with patch("agent.lv4.read_providers.list_place_events", return_value=[row]) as service:
            providers = make_read_providers(session_factory=factory)
            self.assertFalse(factory.called)
            result = providers.place(USER_ID, "카페 갈까?", NOW)
            service.assert_called_once_with(db, USER_ID, 25)
            self.assertEqual(set(result[0]), {"created_at", "place_name", "kind", "preference", "occurred_at"})
            self.assertIn("READ ONLY", str(db.execute.call_args.args[0]))
            db.commit.assert_not_called(); db.flush.assert_not_called()
            factory.return_value.__exit__.assert_called_once()

    def test_deleted_or_foreign_conversation_excluded(self):
        db = MagicMock(); factory = MagicMock(); factory.return_value.__enter__.return_value = db
        row = SimpleNamespace(user_id=USER_ID, conversation_id=uuid4(), created_at=NOW, place_name="카페", kind="visit", preference=None, occurred_at=None)
        with patch("agent.lv4.read_providers.list_place_events", return_value=[row]), patch("agent.lv4.read_providers._get_active_conversation", return_value=SimpleNamespace(user_id=uuid4())):
            self.assertEqual(make_read_providers(session_factory=factory).place(USER_ID, "카페 갈까?", NOW), [])

    def test_schedule_time_filter_precedes_limit(self):
        """기존 활성 일정 조회에 시간 조건을 추가하고 25개 제한은 그 뒤에 적용합니다."""
        db = MagicMock(); factory = MagicMock(); factory.return_value.__enter__.return_value = db
        db.scalars.return_value.all.return_value = []
        make_read_providers(session_factory=factory).schedule(USER_ID, "오늘 어디 갈까?", NOW)
        statement = db.scalars.call_args.args[0]
        compiled = statement.compile()
        self.assertIn("users.deleted_at IS NULL", str(compiled))
        self.assertIn("schedules.end_at >=", str(compiled))
        self.assertIn(NOW+timedelta(hours=24), compiled.params.values())
        self.assertIn(NOW, compiled.params.values())
        self.assertIn(25, compiled.params.values())
        db.commit.assert_not_called()

    def test_critic_place_boundaries(self):
        item = PlaceContext(**place(), relevance=1)
        source = OpinionEvidence(source_type="place", summary=json.dumps(item.model_dump(mode="json", exclude={"relevance", "confidence"}), ensure_ascii=False), relevance=1, observed_at=NOW)
        for text, question, expected in (("광안리 카페를 방문했으니 좋아하는 장소야", "카페 갈까?", "place_preference_inference"), ("광안리 카페를 방문했으니 민수와 친밀해", "카페 갈까?", "place_cross_domain_inference"), ("광안리 카페", "개발 더 할까?", "unrelated_place")):
            with self.subTest(expected=expected):
                rec = AgentOpinion(agent_name="recommendation", conclusion=text, confidence=0.8, evidence=[source, OpinionEvidence(source_type="utterance", summary=question)], suggested_actions=[SuggestedAction(type="recommendation", intent="suggest_recommendation", mode="suggest", summary=text)])
                review = CriticSpecialist().run(CriticContext(current_utterance=question, reference_time=NOW, recommendation_opinion=rec))
                self.assertIn(expected, {risk.code for risk in review.risks})
                result = ArbitratorSpecialist().run(ArbitratorContext(current_utterance=question, reference_time=NOW, recommendation_opinion=rec, critic_opinion=review))
                self.assertEqual(result.suggested_actions, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
