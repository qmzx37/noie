"""Behavior 의미 경계와 기존 Specialist 계약을 외부 호출 없이 검증합니다."""

import ast
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
import unittest
from uuid import uuid4

from pydantic import ValidationError

from agent.behavior_schemas import BehaviorContext, BehaviorObservation
from agent.behavior_specialist import BehaviorSpecialist
from agent.lv4.registry import SpecialistRegistry
from agent.lv4.schemas import OpinionEvidence, SpecialistInput


class BehaviorTests(unittest.TestCase):
    """보고의 의미만 확인합니다. performed를 독립적으로 확인한 현실 사실로 보지 않습니다."""

    def analyze(self, text, **kwargs):
        """각 case는 현재 발화 하나와 명시적으로 제공한 근거만 사용합니다."""
        return BehaviorSpecialist().analyze(BehaviorContext(current_utterance=text, **kwargs))

    def pairs(self, text):
        """출력 순서와 상태를 함께 검사합니다."""
        return [(item.action, item.status) for item in self.analyze(text).behaviors]

    def test_performed(self):
        self.assertEqual(self.pairs("오늘 운동했어"), [("운동", "performed")])

    def test_ongoing(self):
        self.assertEqual(self.pairs("지금 NOIE 개발하고 있어"), [("NOIE 개발", "ongoing")])

    def test_intended(self):
        self.assertEqual(self.pairs("오늘 저녁에 운동할 거야"), [("운동", "intended")])

    def test_desired(self):
        self.assertEqual(self.pairs("운동하고 싶어"), [("운동", "desired")])

    def test_not_performed(self):
        self.assertEqual(self.pairs("오늘 운동 안 했어"), [("운동", "not_performed")])

    def test_choice_candidates(self):
        self.assertEqual(self.pairs("운동할까 개발할까?"), [("운동", "candidate"), ("개발", "candidate")])

    def test_no_activity_fields_or_invented_time(self):
        item = self.analyze("오늘 운동했어").behaviors[0]
        self.assertEqual(set(item.model_dump()), {"action", "status", "evidence", "confidence"})
        self.assertIsNone(item.evidence.observed_at)
        self.assertIsNone(item.confidence)

    def test_general_question_abstains(self):
        self.assertEqual(self.pairs("파이썬 리스트가 뭐야?"), [])

    def test_dream_and_self_are_not_behavior(self):
        for text in ("나는 AI 개발자가 되고 싶어", "매일 운동하는 사람이 되고 싶다"):
            with self.subTest(text=text):
                self.assertEqual(self.pairs(text), [])

    def test_evidence_is_exact_source_clause(self):
        message_id = uuid4()
        now = datetime(2026, 10, 7, tzinfo=timezone.utc)
        result = self.analyze("  오늘 운동했어.  ", source_message_id=message_id, observed_at=now)
        self.assertEqual(result.source_message_id, message_id)
        evidence = result.behaviors[0].evidence
        self.assertEqual(evidence.summary, "오늘 운동했어")
        self.assertEqual(evidence.evidence_ref, str(message_id))
        self.assertEqual(evidence.observed_at, now)
        self.assertTrue(evidence.interpretation)

    def test_reported_time_not_timeline(self):
        self.assertEqual(self.pairs("3시부터 5시까지 NOIE 개발했어"), [("NOIE 개발", "performed")])

    def test_should_is_not_done(self):
        self.assertEqual(self.pairs("운동해야겠다"), [("운동", "intended")])

    def test_specific_study_plan(self):
        self.assertEqual(self.pairs("오늘 Python 공부할 거야"), [("Python 공부", "intended")])

    def test_hobbies(self):
        for text, action in (("기타 연습했어", "기타 연습"), ("뜨개질하고 있어", "뜨개질"), ("그림 그리기하고 싶다", "그림 그리기")):
            with self.subTest(text=text):
                self.assertEqual(self.pairs(text)[0][0], action)

    def test_polite_and_negative_forms(self):
        for text, status in (("운동했어요", "performed"), ("운동하고 있어요", "ongoing"),
                             ("운동하고 싶어요", "desired"), ("운동 안 했습니다", "not_performed"),
                             ("운동하지 않았어", "not_performed"), ("운동 못 했어", "not_performed")):
            with self.subTest(text=text):
                self.assertEqual(self.pairs(text), [("운동", status)])

    def test_third_party_quote_condition_and_completion_question_abstain(self):
        for text in ("친구가 운동했어", '"운동했어"라고 친구가 말했어', "운동했으면 좋겠어", "운동했어?", "운동할 거 아니야", "운동 안 하고 싶어"):
            with self.subTest(text=text):
                self.assertEqual(self.pairs(text), [])

    def test_multiple_reports(self):
        self.assertEqual(self.pairs("운동했어. 지금 개발하고 있어."), [("운동", "performed"), ("개발", "ongoing")])

    def test_multiline_quote_not_self_report(self):
        for text in ('친구가 말했다: "\n운동했어\n"', "친구가 말했다: ‘운동했어. 개발했어.’"):
            with self.subTest(text=text):
                self.assertEqual(self.pairs(text), [])

    def test_current_utterance_not_old_evidence(self):
        context = BehaviorContext(current_utterance="오늘 운동 안 했어", evidence=[
            OpinionEvidence(source_type="memory", summary="운동했어", interpretation=True)
        ])
        result = BehaviorSpecialist().analyze(context)
        self.assertEqual(result.behaviors[0].status, "not_performed")
        self.assertEqual(result.behaviors[0].evidence.source_type, "utterance")

    def test_registry_common_run(self):
        registry = SpecialistRegistry()
        registry.register(BehaviorSpecialist())
        opinion = registry.get("behavior").run(SpecialistInput(current_utterance="운동했어"))
        self.assertEqual(opinion.agent_name, "behavior")
        self.assertEqual(opinion.result_status, "OK")
        self.assertEqual(opinion.suggested_actions, [])

    def test_registry_abstention(self):
        opinion = BehaviorSpecialist().run(SpecialistInput(current_utterance="리스트가 뭐야?"))
        self.assertEqual(opinion.result_status, "NO_RECOMMENDATION")
        self.assertEqual(opinion.evidence, [])

    def test_privacy_restricted_and_no_debug_logs(self):
        text = "오늘 운동했어. password=SuperSecret987"
        logs = StringIO()
        with redirect_stdout(logs), redirect_stderr(logs):
            result = self.analyze(text)
        self.assertEqual(result.reason, "privacy_restricted")
        self.assertEqual(result.behaviors, [])
        self.assertEqual(logs.getvalue(), "")
        self.assertNotIn("SuperSecret987", result.model_dump_json())

    def test_input_and_output_contracts(self):
        for text in ("", " ", "a" * 8193):
            with self.subTest(length=len(text)), self.assertRaises(ValidationError):
                BehaviorContext(current_utterance=text)
        for changes in ({"status": "completed"}, {"confidence": float("nan")}, {"confidence": 1.1}, {"duration": 60}):
            item = self.analyze("운동했어").behaviors[0].model_dump()
            item.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                BehaviorObservation.model_validate(item)

    def test_naive_timestamp_rejected(self):
        with self.assertRaises(ValidationError):
            BehaviorContext(current_utterance="운동했어", observed_at=datetime(2026, 10, 7))

    def test_bounded_evidence_not_truncated(self):
        self.assertEqual(self.pairs("오늘 " * 200 + "운동했어"), [])

    def test_bounded_observations(self):
        result = self.analyze("운동했어. " * 30)
        self.assertEqual(len(result.behaviors), 16)

    def test_agent_has_no_io_or_tool_dependency(self):
        source = Path(__file__).parents[1] / "agent" / "behavior_specialist.py"
        modules = [node.module for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))) if isinstance(node, ast.ImportFrom)]
        self.assertFalse(any(any(word in (module or "") for word in ("sqlalchemy", "openai", "executor", "gateway", "database")) for module in modules))


if __name__ == "__main__":
    unittest.main()
