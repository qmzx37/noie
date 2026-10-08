"""Behavior -> 실제 네 Specialist -> /chat reply의 결정론적 연결을 검사합니다."""

from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from io import StringIO
import json
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import ValidationError

import main
import lv4_production_service as production
from agent.behavior_schemas import BehaviorAnalysis, BehaviorContext
from agent.behavior_specialist import BehaviorSpecialist
from agent.lv4.behavior_adapter import behavior_fields, project_behavior
from agent.lv4.collaboration_context import Lv4CollaborationContext
from agent.lv4.recommendation_context import RecommendationContext
from agent.lv4.recommendation_specialist import RecommendationDecision, prepare_evidence
from agent.lv4.schemas import OpinionEvidence
from agent.lv4.state_context import BodyState, StateContext
from agent.lv4.state_specialist import StateSpecialist
from agent.recommendation_schemas import RecommendationArguments
from evals import run_lv4_production_integration_tests as integration
from evals import run_lv4_production_local_canary_tests as canary


NOW = datetime(2026, 10, 7, tzinfo=timezone.utc)
QUESTION = "오늘 운동했어. 운동할까 개발할까?"


def analysis(text, message_id, when=NOW):
    """실제 Behavior Agent로 구조화합니다. 외부 모델/DB는 호출하지 않습니다."""
    return BehaviorSpecialist().analyze(BehaviorContext(
        current_utterance=text, source_message_id=message_id, observed_at=when,
    ))


def state_for(text, *, when=NOW, **kwargs):
    """원문과 현재 요청 ID를 일치시킨 뒤 실제 State를 실행합니다."""
    message_id = uuid4()
    observations = project_behavior(analysis(text, message_id, when), message_id=message_id, current_utterance=text)
    context = StateContext(as_of=NOW, max_age_seconds=7200, behaviors=observations, **kwargs)
    return StateSpecialist().run(context), observations


class BehaviorLv4Tests(unittest.TestCase):
    """상태/provenance 보존, optional fallback, 최소 전송과 최종 판단 영향을 검사합니다."""

    def assert_status(self, text, status):
        """내부 원문 evidence와 State의 최소 의미 evidence를 각각 검사합니다."""
        state, observations = state_for(text)
        fields = [value for item in state.evidence if (value := behavior_fields(item)) is not None]
        self.assertEqual(fields[0]["status"], status)
        self.assertEqual(observations[0].status, status)
        self.assertIn("사용자 보고 행동", state.conclusion)
        self.assertEqual(state.suggested_actions, [])

    def test_performed_consumed_by_state(self):
        self.assert_status("오늘 운동했어", "performed")

    def test_ongoing_consumed_by_state(self):
        self.assert_status("지금 NOIE 개발하고 있어", "ongoing")

    def test_intended_not_performed(self):
        self.assert_status("운동할 거야", "intended")

    def test_desired_not_performed(self):
        self.assert_status("운동하고 싶어", "desired")

    def test_not_performed_consumed_by_state(self):
        self.assert_status("운동 안 했어", "not_performed")

    def test_both_candidates_not_performed(self):
        state, observations = state_for("운동할까 개발할까?")
        self.assertEqual([item.status for item in observations], ["candidate", "candidate"])
        self.assertEqual([behavior_fields(item)["status"] for item in state.evidence if behavior_fields(item)], ["candidate", "candidate"])

    def test_original_provenance_and_time_preserved(self):
        state, observations = state_for("오늘 운동했어")
        self.assertIn(observations[0].evidence, state.evidence)
        self.assertEqual(observations[0].evidence.observed_at, NOW)
        self.assertIsNotNone(observations[0].evidence.evidence_ref)
        self.assertTrue(observations[0].evidence.interpretation)

    def test_unknown_confidence_never_filled(self):
        state, _ = state_for("오늘 운동했어", body=BodyState(fatigue=.2, confidence=.9, observed_at=NOW))
        self.assertIsNone(state.confidence)
        value = next(behavior_fields(item) for item in state.evidence if behavior_fields(item))
        self.assertNotIn("confidence", value)

    def test_existing_confidence_zero_preserved(self):
        mid = uuid4()
        raw = analysis("운동했어", mid).model_dump()
        raw["behaviors"][0]["confidence"] = 0.0
        values = project_behavior(BehaviorAnalysis.model_validate(raw), message_id=mid, current_utterance="운동했어")
        state = StateSpecialist().run(StateContext(as_of=NOW, behaviors=values))
        self.assertEqual(state.confidence, 0.0)
        self.assertEqual(next(behavior_fields(item) for item in state.evidence if behavior_fields(item))["confidence"], 0.0)

    def test_no_behavior_identical_state(self):
        state, values = state_for("파이썬 리스트가 뭐야?")
        self.assertEqual(values, [])
        expected = StateSpecialist().run(StateContext(as_of=NOW, max_age_seconds=7200))
        self.assertEqual(state, expected)

    def test_none_projection(self):
        self.assertEqual(project_behavior(None, message_id=uuid4(), current_utterance="운동했어"), [])

    def test_invalid_contract_rejected(self):
        mid = uuid4()
        raw = analysis("운동했어", mid).model_dump()
        raw["behaviors"][0]["status"] = "secret_internal_status"
        forged = BehaviorAnalysis.model_construct(**raw)
        with self.assertRaises(ValidationError):
            project_behavior(forged, message_id=mid, current_utterance="운동했어")

    def test_wrong_source_message_rejected(self):
        self.assertEqual(project_behavior(analysis("운동했어", uuid4()), message_id=uuid4(), current_utterance="운동했어"), [])

    def test_wrong_evidence_reference_rejected(self):
        mid = uuid4()
        raw = analysis("운동했어", mid).model_dump()
        raw["behaviors"][0]["evidence"]["evidence_ref"] = str(uuid4())
        self.assertEqual(project_behavior(BehaviorAnalysis.model_validate(raw), message_id=mid, current_utterance="운동했어"), [])

    def test_other_utterance_rejected(self):
        mid = uuid4()
        self.assertEqual(project_behavior(analysis("운동했어", mid), message_id=mid, current_utterance="개발할까?"), [])

    def test_privacy_restricted_rejected(self):
        mid = uuid4()
        self.assertEqual(project_behavior(analysis("운동했어", mid), message_id=mid, current_utterance="운동했어 password=SuperSecret987"), [])

    def test_unrelated_report_filtered_before_state(self):
        text = "운동했어. 개발할까?"
        mid = uuid4()
        values = project_behavior(analysis(text, mid), message_id=mid, current_utterance=text)
        self.assertEqual([(item.action, item.status) for item in values], [("개발", "candidate")])

    def test_max_four_current_observations(self):
        text = "운동했어. 공부했어. 독서했어. 산책했어. 요리했어. 지금 뭐부터 할까?"
        mid = uuid4()
        self.assertEqual(len(project_behavior(analysis(text, mid), message_id=mid, current_utterance=text)), 4)

    def test_uuid_action_not_transmitted(self):
        mid = uuid4()
        text = "abcdef12-1234-1234-1234-123456789abc 개발했어"
        self.assertEqual(project_behavior(analysis(text, mid), message_id=mid, current_utterance=text), [])

    def test_stale_behavior_not_recommended(self):
        text = "운동할까 개발할까?"
        state, _ = state_for(text, when=NOW-timedelta(hours=3))
        selected = prepare_evidence(RecommendationContext(current_utterance=text, reference_time=NOW, state_opinion=state))
        self.assertFalse(any(behavior_fields(item) for item in selected))
        self.assertIn("stale_observation", [risk.code for risk in state.risks])

    def test_future_behavior_not_recommended(self):
        text = "운동할까 개발할까?"
        state, _ = state_for(text, when=NOW+timedelta(seconds=1))
        selected = prepare_evidence(RecommendationContext(current_utterance=text, reference_time=NOW, state_opinion=state))
        self.assertFalse(any(behavior_fields(item) for item in selected))

    def test_unknown_observation_time_not_invented(self):
        state, _ = state_for("운동했어", when=None)
        fields = next(behavior_fields(item) for item in state.evidence if behavior_fields(item))
        self.assertNotIn("observed_at", fields)
        self.assertIn("unknown_observation_time", [risk.code for risk in state.risks])

    def test_invalid_behavior_semantic_evidence_ignored(self):
        for summary in ("behavior: {}", "behavior: []", "behavior: invalid", 'behavior: {"action":"운동","status":"performed","message_id":"internal"}'):
            item = OpinionEvidence(source_type="state", evidence_ref="behavior_0", summary=summary)
            self.assertIsNone(behavior_fields(item))

    def test_unpaired_utterance_not_allowed_as_state(self):
        from agent.lv4.schemas import AgentOpinion
        opinion = AgentOpinion(agent_name="state", conclusion="untrusted", confidence=None, evidence=[
            OpinionEvidence(source_type="utterance", evidence_ref=str(uuid4()), summary="운동했어", interpretation=True)
        ])
        with self.assertRaises(ValidationError):
            RecommendationContext(current_utterance="운동할까?", reference_time=NOW, state_opinion=opinion)

    def test_existing_numeric_state_unchanged(self):
        state, _ = state_for("운동했어", body=BodyState(fatigue=.2, observed_at=NOW))
        self.assertIn("fatigue=0.2", state.evidence[0].summary)
        self.assertNotIn("energy=", state.evidence[0].summary)

    def test_behavior_changes_actual_arbitrator_and_chat_reply(self):
        def reasoner(context, evidence):
            """현재 선택에 관련된 performed 근거가 있으면 다른 후보를 선택하는 합성 판단입니다."""
            fields = [value for item in evidence if (value := behavior_fields(item)) is not None]
            choice = "개발해볼까요?" if any(item["status"] == "performed" and item["action"] == "운동" for item in fields) else "운동해볼까요?"
            if fields:
                self.assertIsNotNone(context.state_opinion)
            return RecommendationDecision(recommendation=RecommendationArguments(
                primary_action=choice, rationale="현재 질문과 사용자 보고 행동에 기반한 선택 후보입니다.",
                confidence=.7, recommendation_kind="direct",
            ), used_evidence_refs=[item.evidence_ref for item in evidence])

        replies = []
        for include in (False, True):
            with integration.production_fixture() as (context, mocks, _, _, _, factory):
                values = project_behavior(analysis(QUESTION, context.user_message_id, None), message_id=context.user_message_id, current_utterance=QUESTION) if include else []
                factory.return_value = reasoner
                with patch.object(production, "read_behavior", return_value=values), TestClient(main.app) as client, redirect_stdout(StringIO()):
                    response = client.post("/chat", json={"text": QUESTION, "request_id": str(context.request_id)})
                self.assertEqual(response.status_code, 200)
                replies.append(response.json()["reply"])
                self.assertEqual(mocks["complete_chat_request"].call_args.args[1], replies[-1])
        self.assertIn("운동해볼까요?", replies[0])
        self.assertIn("개발해볼까요?", replies[1])
        self.assertNotEqual(replies[0], replies[1])

    def test_sdk_payload_minimal_and_reply_no_internal_metadata(self):
        text = "운동할까 개발할까?"
        with canary.canary_fixture() as fixture, TestClient(main.app) as client, redirect_stdout(StringIO()) as logs:
            values = project_behavior(analysis(text, fixture.context.user_message_id, None), message_id=fixture.context.user_message_id, current_utterance=text)
            with patch.object(production, "read_behavior", return_value=values):
                response = canary.send(client, fixture, text)
        self.assertEqual(response.status_code, 200)
        submitted = json.loads(fixture.create.call_args.kwargs["input"][1]["content"])
        self.assertEqual([item["status"] for item in submitted["behavior_observations"]], ["candidate", "candidate"])
        for item in submitted["behavior_observations"]:
            self.assertEqual(set(item), {"ref", "action", "status"})
        outgoing = json.dumps(submitted)
        for identity in (fixture.context.user_id, fixture.context.user_message_id, fixture.context.conversation_id, fixture.context.request_id):
            self.assertNotIn(str(identity), outgoing + response.json()["reply"] + logs.getvalue())
        self.assertTrue(all(item["source_type"] == "utterance" for item in submitted["recommendation_evidence"]))
        for private in ("behavior_observations", "evidence_ref", "state_opinion", "observed_at", "confidence"):
            self.assertNotIn(private, response.json()["reply"])
        self.assertEqual(fixture.saved[0]["content"], response.json()["reply"])

    def test_sdk_preserves_known_confidence_and_observed_time(self):
        text = "운동할까 개발할까?"
        with canary.canary_fixture() as fixture, TestClient(main.app) as client, redirect_stdout(StringIO()):
            now = datetime.now(timezone.utc)
            raw = analysis(text, fixture.context.user_message_id, now).model_dump()
            raw["behaviors"][0]["confidence"] = .6
            values = project_behavior(BehaviorAnalysis.model_validate(raw), message_id=fixture.context.user_message_id, current_utterance=text)
            with patch.object(production, "read_behavior", return_value=values):
                self.assertEqual(canary.send(client, fixture, text).status_code, 200)
        fields = json.loads(fixture.create.call_args.kwargs["input"][1]["content"])["behavior_observations"][0]
        self.assertEqual(fields["confidence"], .6)
        self.assertEqual(fields["observed_at"], now.isoformat())

    def test_legacy_prompt_fingerprint_detects_instruction_changes(self):
        """payload 변경만 제외하며 기존 지시문 변경을 놓치지 않는지 검사합니다."""
        # 과거 평가/결과 JSON을 import하지 않고 동일한 purpose AST 지문을 검증합니다.
        import ast
        import hashlib
        from pathlib import Path
        baseline = "f5b046561edf9b1778dadb02dcd9e98fe04a1f1c2a67e533a2850689b1344ca9"

        def prompt_fingerprint(source):
            """기존 네 purpose 지시의 AST만 계산하며 기대 지문은 변경하지 않습니다."""
            nodes = [ast.dump(node, include_attributes=False) for node in ast.walk(ast.parse(source))
                if (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "purpose"
                    for target in node.targets)) or
                (isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name) and node.target.id == "purpose")]
            return hashlib.sha256("\n".join(nodes).encode()).hexdigest()

        source = (Path(__file__).resolve().parents[1] / "agent/lv4/recommendation_adapter.py").read_text(encoding="utf-8-sig")
        self.assertEqual(prompt_fingerprint(source), baseline)
        self.assertNotEqual(prompt_fingerprint(source.replace("이번 호출은 추천 Suggest만 생성한다.", "changed instruction")), baseline)

    def test_behavior_instruction_only_when_context_is_present(self):
        """Behavior 없음의 기존 prompt와 payload를 유지하고 있는 경우에만 최소 계약을 추가합니다."""
        from agent.lv4.recommendation_adapter import BASE_ORCHESTRATOR_SYSTEM_PROMPT, CHOICE_CONTRACT
        inputs = []
        text = "운동할까 개발할까?"
        for include in (False, True):
            with canary.canary_fixture() as fixture, TestClient(main.app) as client, redirect_stdout(StringIO()):
                values = project_behavior(analysis(text, fixture.context.user_message_id, None),
                    message_id=fixture.context.user_message_id, current_utterance=text) if include else []
                with patch.object(production, "read_behavior", return_value=values):
                    self.assertEqual(canary.send(client, fixture, text).status_code, 200)
                inputs.append(fixture.create.call_args.kwargs["input"])
        self.assertTrue(inputs[0][0]["content"].startswith(BASE_ORCHESTRATOR_SYSTEM_PROMPT + CHOICE_CONTRACT))
        self.assertNotIn("behavior_observations", inputs[0][0]["content"])
        self.assertNotIn("behavior_observations", json.loads(inputs[0][1]["content"]))
        self.assertTrue(inputs[1][0]["content"].startswith(inputs[0][0]["content"]))
        self.assertIn("behavior_observations", inputs[1][0]["content"])

    def test_general_chat_never_reads_behavior(self):
        with integration.production_fixture() as (context, *_), patch.object(production, "read_behavior") as read:
            response = TestClient(main.app).post("/chat", json={"text": "파이썬 리스트가 뭐야?", "request_id": str(context.request_id)})
        self.assertEqual(response.status_code, 200)
        read.assert_not_called()

    def test_flag_off_never_reads_behavior(self):
        with integration.production_fixture(flag="false") as (context, *_), patch.object(production, "read_behavior") as read:
            response = TestClient(main.app).post("/chat", json={"text": QUESTION, "request_id": str(context.request_id)})
        self.assertEqual(response.json()["reply"], integration.LEGACY)
        read.assert_not_called()

    def test_adapter_exception_keeps_existing_lv4_reply(self):
        with integration.production_fixture() as (context, *_), patch.object(production, "read_behavior", side_effect=RuntimeError("PRIVATE_BEHAVIOR_ERROR")), redirect_stdout(StringIO()) as logs:
            response = TestClient(main.app).post("/chat", json={"text": QUESTION, "request_id": str(context.request_id)})
        self.assertEqual(response.status_code, 200)
        self.assertIn(integration.CHOICE, response.json()["reply"])
        self.assertNotIn("PRIVATE_BEHAVIOR_ERROR", response.text + logs.getvalue())

    def test_none_empty_invalid_adapter_result_keeps_existing_pipeline(self):
        for value in (None, [], {"invalid": "PRIVATE"}, ["invalid"], [None]):
            with self.subTest(value_type=type(value).__name__), integration.production_fixture() as (context, *_), patch.object(production, "read_behavior", return_value=value), redirect_stdout(StringIO()):
                response = TestClient(main.app).post("/chat", json={"text": QUESTION, "request_id": str(context.request_id)})
            self.assertEqual(response.status_code, 200)
            self.assertIn(integration.CHOICE, response.json()["reply"])

    def test_cached_duplicate_no_behavior_read_or_pipeline(self):
        from chat_persistence_service import ChatPersistenceStart
        with integration.production_fixture() as (context, mocks, *_), patch.object(production, "read_behavior", return_value=[]) as read, redirect_stdout(StringIO()):
            with TestClient(main.app) as client:
                body = {"text": QUESTION, "request_id": str(context.request_id)}
                first = client.post("/chat", json=body)
                self.assertEqual(first.status_code, 200)
                mocks["begin_chat_request"].return_value = ChatPersistenceStart(context=context, cached_response=first.json())
                read.reset_mock()
                mocks["complete_chat_request"].reset_mock()
                response = client.post("/chat", json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), first.json())
        read.assert_not_called()
        mocks["complete_chat_request"].assert_not_called()


if __name__ == "__main__":
    unittest.main()
