"""시간 추측 없이 Behavior 상태와 Activity 시간 구조를 검사하는 결정론적 fixture입니다."""

from datetime import datetime, time, timezone
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from pydantic import ValidationError

from agent.activity_recorder import analyze_activity
from agent.activity_schemas import ActivityObservation
from agent.behavior_schemas import BehaviorContext
from agent.behavior_specialist import BehaviorSpecialist


NOW = datetime(2026, 10, 7, 15, 30, tzinfo=timezone.utc)


def analyze(text, *, when=NOW, zone="Asia/Seoul"):
    """한국 날짜 경계도 실제 관찰 시점과 명시적으로 설정한 zone으로만 계산합니다."""
    with patch.dict(os.environ, {"NOIE_SCHEDULE_TIMEZONE": zone}):
        return analyze_activity(BehaviorContext(current_utterance=text, observed_at=when, source_message_id=uuid4()))


class ActivityRecorderTests(unittest.TestCase):
    """네트워크/DB 없이 원문 근거, status eligibility와 partial time을 검사합니다."""

    def first(self, text, **kwargs):
        """한 활동이라는 기대를 명시합니다."""
        result = analyze(text, **kwargs)
        self.assertEqual(len(result.activities), 1)
        return result.activities[0]

    def test_explicit_24h_range_and_label(self):
        item = self.first("15시부터 17시까지 NOIE 개발했어")
        self.assertEqual((item.action, item.status, item.start_time, item.end_time, item.duration_minutes),
                         ("NOIE 개발", "performed", time(15), time(17), 120))
        self.assertIsNone(item.activity_date)

    def test_ambiguous_range_is_unknown_by_user_policy(self):
        item = self.first("3시부터 5시까지 NOIE 개발했어")
        self.assertIsNone(item.start_time); self.assertIsNone(item.end_time)
        self.assertIsNone(item.duration_minutes)
        self.assertIn("ambiguous_clock", item.time_issues)

    def test_explicit_pm_range(self):
        item = self.first("오후 3시부터 오후 5시까지 개발했어")
        self.assertEqual((item.start_time, item.end_time, item.duration_minutes), (time(15), time(17), 120))

    def test_today_zone_date_no_invented_clocks(self):
        item = self.first("오늘 운동했어")
        self.assertEqual(item.activity_date.isoformat(), "2026-10-08")
        self.assertEqual((item.start_time, item.end_time, item.duration_minutes), (None, None, None))

    def test_yesterday_date(self):
        self.assertEqual(self.first("어제 운동했어").activity_date.isoformat(), "2026-10-07")

    def test_duration_only(self):
        item = self.first("2시간 공부했어")
        self.assertEqual(item.duration_minutes, 120)
        self.assertEqual((item.start_time, item.end_time), (None, None))

    def test_hours_and_minutes_duration(self):
        self.assertEqual(self.first("1시간 30분 공부했어").duration_minutes, 90)

    def test_minutes_only(self):
        self.assertEqual(self.first("10분 운동했어").duration_minutes, 10)

    def test_start_only(self):
        item = self.first("15시부터 공부했어")
        self.assertEqual(item.start_time, time(15))
        self.assertEqual((item.end_time, item.duration_minutes), (None, None))

    def test_ambiguous_start_only(self):
        item = self.first("3시부터 공부했어")
        self.assertEqual((item.start_time, item.end_time, item.duration_minutes), (None, None, None))

    def test_end_only_completion(self):
        item = self.first("오후 5시에 운동 끝냈어")
        self.assertEqual((item.action, item.end_time), ("운동", time(17)))
        self.assertEqual((item.start_time, item.duration_minutes), (None, None))

    def test_ambiguous_end_only(self):
        item = self.first("5시에 운동 끝냈어")
        self.assertEqual((item.start_time, item.end_time, item.duration_minutes), (None, None, None))

    def test_completion_report_endings_reuse_performed_contract(self):
        for stem in ("마쳤", "완료했"):
            for ending in ("어", "다", "어요", "습니다"):
                with self.subTest(stem=stem, ending=ending):
                    item = self.first(f"공부 {stem}{ending}")
                    self.assertEqual((item.action, item.status), ("공부", "performed"))
                    self.assertEqual((item.activity_date, item.start_time, item.end_time, item.duration_minutes),
                                     (None, None, None, None))

    def test_completion_report_explicit_end_only(self):
        for text in ("오후 5시에 운동 마쳤어", "오후 5시에 운동 완료했어"):
            with self.subTest(text=text):
                item = self.first(text)
                self.assertEqual((item.status, item.end_time), ("performed", time(17)))
                self.assertEqual((item.start_time, item.duration_minutes), (None, None))

    def test_completion_report_ambiguous_end_stays_unknown(self):
        for text in ("5시에 운동 마쳤어", "5시에 운동 완료했어"):
            with self.subTest(text=text):
                item = self.first(text)
                self.assertIsNone(item.end_time)
                self.assertIn("ambiguous_clock", item.time_issues)

    def test_completion_report_negative_question_and_intention_not_recorded(self):
        for text in ("운동 안 마쳤어", "공부 못 완료했어", "운동 마치지 않았어",
                     "운동 완료했어?", "공부 마쳤어?", "운동 완료할 거야", "공부 마치고 싶어",
                     "민수가 운동 마쳤어", '"공부 완료했어"', "공부 마쳤다면"):
            with self.subTest(text=text):
                self.assertEqual(analyze(text).activities, [])

    def test_completion_report_keeps_original_evidence_and_context(self):
        context = BehaviorContext(current_utterance="오후 5시에 공부 완료했어.",
                                  source_message_id=uuid4(), observed_at=NOW)
        before = context.model_dump()
        first = analyze_activity(context)
        self.assertEqual(analyze_activity(context), first)
        self.assertEqual(context.model_dump(), before)
        item = first.activities[0]
        self.assertEqual(item.evidence.summary, "오후 5시에 공부 완료했어")
        self.assertEqual(item.evidence.evidence_ref, str(context.source_message_id))
        self.assertIsNone(item.confidence)

    def test_completion_report_does_not_extend_behavior_specialist(self):
        context = BehaviorContext(current_utterance="공부 마쳤어", observed_at=NOW)
        before = BehaviorSpecialist().analyze(context)
        self.assertEqual(before.behaviors, [])
        self.assertEqual(len(analyze_activity(context).activities), 1)
        self.assertEqual(BehaviorSpecialist().analyze(context), before)

    def test_completion_report_sensitive_source_not_recorded(self):
        result = analyze("공부 완료했어. password=SuperSecret987")
        self.assertEqual(result.reason, "privacy_restricted")
        self.assertEqual(result.activities, [])

    def test_non_completion_at_time_does_not_guess_start(self):
        item = self.first("오후 3시에 운동했어")
        self.assertEqual((item.start_time, item.end_time, item.duration_minutes), (None, None, None))

    def test_ongoing_has_no_end_or_invented_duration(self):
        item = self.first("지금 NOIE 개발하고 있어")
        self.assertEqual(item.status, "ongoing")
        self.assertEqual((item.end_time, item.duration_minutes), (None, None))

    def test_ongoing_range_does_not_mark_complete(self):
        item = self.first("15시부터 17시까지 개발하고 있어")
        self.assertEqual(item.status, "ongoing")
        self.assertEqual(item.start_time, time(15))
        self.assertEqual((item.end_time, item.duration_minutes), (None, None))
        self.assertIn("ongoing_end_unconfirmed", item.time_issues)

    def test_intended_has_no_activity(self):
        self.assertEqual(analyze("저녁에 운동할 거야").activities, [])

    def test_desired_has_no_activity(self):
        self.assertEqual(analyze("운동하고 싶어").activities, [])

    def test_candidates_have_no_activity(self):
        self.assertEqual(analyze("운동할까 개발할까?").activities, [])

    def test_not_performed_has_no_activity(self):
        self.assertEqual(analyze("오늘 운동 안 했어").activities, [])

    def test_general_question_has_no_activity(self):
        self.assertEqual(analyze("파이썬 리스트가 뭐야?").activities, [])

    def test_duration_conflict_preserves_both_not_selected(self):
        item = self.first("15시부터 17시까지 3시간 개발했어")
        self.assertEqual((item.reported_duration_minutes, item.calculated_duration_minutes), (180, 120))
        self.assertIsNone(item.duration_minutes)
        self.assertIn("duration_conflict", item.time_issues)

    def test_equal_reported_and_calculated_duration(self):
        self.assertEqual(self.first("15시부터 17시까지 2시간 개발했어").duration_minutes, 120)

    def test_overnight_not_assumed(self):
        item = self.first("23시부터 01:00까지 개발했어")
        self.assertIsNone(item.duration_minutes)
        self.assertIn("end_before_start", item.time_issues)

    def test_missing_zone_does_not_guess_date(self):
        item = self.first("오늘 운동했어", zone="")
        self.assertIsNone(item.activity_date)
        self.assertIn("timezone_unknown", item.time_issues)

    def test_missing_observation_does_not_use_now(self):
        item = self.first("오늘 운동했어", when=None)
        self.assertIsNone(item.activity_date); self.assertIsNone(item.observed_at)

    def test_explicit_iso_date(self):
        self.assertEqual(self.first("2026-10-06 운동했어", when=None).activity_date.isoformat(), "2026-10-06")

    def test_invalid_iso_date_unknown(self):
        item = self.first("2026-13-40 운동했어")
        self.assertIsNone(item.activity_date)
        self.assertIn("invalid_date", item.time_issues)

    def test_conflicting_dates_unknown(self):
        item = self.first("오늘 어제 운동했어")
        self.assertIsNone(item.activity_date)
        self.assertIn("date_conflict", item.time_issues)

    def test_tomorrow_intention_not_recorded(self):
        self.assertEqual(analyze("내일 운동할 거야").activities, [])

    def test_future_completed_relative_date_not_fact(self):
        item = self.first("내일 운동했어")
        self.assertIsNone(item.activity_date)
        self.assertIn("future_activity_date", item.time_issues)

    def test_invalid_hour_and_minute_unknown(self):
        item = self.first("25시부터 17시까지 개발했어")
        self.assertIsNone(item.start_time); self.assertIsNone(item.duration_minutes)
        self.assertIn("invalid_clock", item.time_issues)

    def test_no_meridiem_inheritance(self):
        item = self.first("오후 3시부터 5시까지 개발했어")
        self.assertEqual(item.start_time, time(15))
        self.assertIsNone(item.end_time); self.assertIsNone(item.duration_minutes)

    def test_am_pm_twelve(self):
        item = self.first("오전 12시부터 오후 12시까지 개발했어")
        self.assertEqual((item.start_time, item.end_time, item.duration_minutes), (time(0), time(12), 720))

    def test_evidence_exact_provenance_confidence_unknown(self):
        context = BehaviorContext(current_utterance="  15시부터 17시까지 NOIE 개발했어.  ", source_message_id=uuid4(), observed_at=NOW)
        item = analyze_activity(context).activities[0]
        self.assertIn(item.evidence.summary, context.current_utterance)
        self.assertEqual(item.evidence.evidence_ref, str(context.source_message_id))
        self.assertEqual(item.evidence.observed_at, NOW)
        self.assertIsNone(item.confidence)

    def test_original_behavior_unchanged(self):
        context = BehaviorContext(current_utterance="오늘 운동했어", observed_at=NOW)
        before = BehaviorSpecialist().analyze(context)
        analyze_activity(context)
        self.assertEqual(BehaviorSpecialist().analyze(context), before)

    def test_quoted_other_user_and_hypothetical_not_recorded(self):
        for text in ('"운동했어"', "민수가 운동했어", "운동했다면", "운동했어?"):
            self.assertEqual(analyze(text).activities, [], text)

    def test_sensitive_source_not_recorded(self):
        result = analyze("오늘 운동했어. password=SuperSecret987")
        self.assertEqual(result.reason, "privacy_restricted")
        self.assertEqual(result.activities, [])

    def test_multiple_simple_reports_separate(self):
        result = analyze("운동했어. 공부했어.")
        self.assertEqual([item.action for item in result.activities], ["운동", "공부"])

    def test_temporal_multi_action_not_broadcast(self):
        self.assertEqual(analyze("2시간 운동했어 그리고 공부했어").activities, [])

    def test_schema_rejects_promoted_status_extra_and_unknown_confidence(self):
        item = self.first("운동했어").model_dump()
        for update in ({"status": "intended"}, {"status": "candidate"}, {"confidence": 2}, {"user_id": uuid4()}):
            with self.assertRaises(ValidationError):
                ActivityObservation.model_validate({**item, **update})


if __name__ == "__main__":
    unittest.main()
