"""합성 SQLite + 기존 Activity fixture로 읽기 전용 Object Preview를 검증합니다."""

from contextlib import contextmanager, redirect_stderr, redirect_stdout
from copy import deepcopy
from datetime import datetime, timezone
from io import StringIO
import logging
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import event, select, update
from sqlalchemy.exc import SQLAlchemyError

from auth_context import AuthPrincipal
from agent import object_reference_service as service
from agent.object_reference_schemas import ActivityObjectReferenceRequest, SourceSpan
from evals import run_security_activity_recorder_tests as fixture
from models.activity import Activity
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.user import User


@contextmanager
def captured_output():
    """stdout/stderr뿐 아니라 logging도 합성 값의 비노출을 확인합니다."""
    output = StringIO()
    handler = logging.StreamHandler(output)
    logger = logging.getLogger()
    logger.addHandler(handler)
    try:
        with redirect_stdout(output), redirect_stderr(output):
            yield output
    finally:
        logger.removeHandler(handler)


class ObjectReferenceTests(unittest.TestCase):
    """setup 쓰기는 fixture에만 있으며 preview 중에는 DB/SDK 쓰기를 금지합니다."""

    setUp = fixture.ActivityOwnershipTests.setUp
    tearDown = fixture.ActivityOwnershipTests.tearDown

    def record(self, text="NOIE 개발했어", *, other_owner=False, index=0):
        message = Message(user_id=self.bid if other_owner else self.aid,
            conversation_id=self.cb.id if other_owner else self.ca.id, role="user", content=text)
        self.db.add(message)
        self.db.commit()
        action = fixture.ActivityOwnershipTests.plan(self, message)
        fixture.ActivityOwnershipTests.execute(self, action)
        row = self.db.scalar(select(Activity).where(Activity.message_id == message.id, Activity.record_index == index))
        self.assertIsNotNone(row)
        return row, message

    def request(self, row, message, label="NOIE", kind="project", *, start=None):
        start = message.content.index(label) if start is None else start
        return ActivityObjectReferenceRequest(activity_id=row.id, kind=kind, label=label,
            source_span=SourceSpan(start=start, end=start + len(label)))

    def preview(self, request, *, principal=None):
        return service.preview_activity_object_reference(self.db, principal or self.principal, request)

    def rejected(self, request, status, *, principal=None):
        with self.assertRaises(HTTPException) as error:
            self.preview(request, principal=principal)
        self.assertEqual(error.exception.status_code, status)
        return error.exception

    def test_place(self):
        row, message = self.record("Cafe 공부했어")
        result = self.preview(self.request(row, message, "Cafe", "place"))
        self.assertEqual((result.label, result.kind, result.kind_basis), ("Cafe", "place", "user_selected"))

    def test_person(self):
        row, message = self.record("Alex 운동했어")
        result = self.preview(self.request(row, message, "Alex", "person"))
        self.assertEqual((result.label, result.identity_status), ("Alex", "unresolved"))

    def test_thing(self):
        row, message = self.record("기타 연습했어")
        self.assertEqual(self.preview(self.request(row, message, "기타", "thing")).label, "기타")

    def test_project(self):
        row, message = self.record()
        self.assertEqual(self.preview(self.request(row, message)).kind, "project")

    def test_kind_is_user_selected_not_inferred(self):
        row, message = self.record()
        result = self.preview(self.request(row, message, kind="thing"))
        self.assertEqual((result.kind, result.kind_basis, result.identity_status), ("thing", "user_selected", "unresolved"))

    def test_schema_forbids_guessed_identity_or_user(self):
        row, message = self.record()
        data = self.request(row, message).model_dump()
        for key, value in (("user_id", self.bid), ("object_id", uuid4()), ("confidence", .9), ("identity_status", "resolved")):
            self.rejected({**data, key: value}, 422)

    def test_invalid_ranges_and_types(self):
        for start, end in ((-1, 2), (2, 2), (3, 1), (True, 2), (0, "4")):
            with self.assertRaises(ValidationError):
                SourceSpan(start=start, end=end)
        row, message = self.record()
        self.rejected({**self.request(row, message).model_dump(), "source_span": {"start": 0, "end": 999}}, 422)

    def test_nonmatching_label_no_normalization(self):
        row, message = self.record()
        data = self.request(row, message).model_dump()
        for label in ("noie", " NOIE", "NOIE ", "OTHER"):
            self.rejected({**data, "label": label}, 422)

    def test_other_activity_segment_same_message_rejected(self):
        row, message = self.record("NOIE 개발했어. Cafe 공부했어.")
        self.rejected(self.request(row, message, "Cafe", "place"), 422)
        second = self.db.scalar(select(Activity).where(Activity.message_id == message.id, Activity.record_index == 1))
        self.assertEqual(self.preview(self.request(second, message, "Cafe", "place")).label, "Cafe")

    def test_span_crossing_evidence_boundary_rejected(self):
        row, message = self.record("NOIE 개발했어. Cafe 공부했어.")
        label = message.content[:message.content.index("Cafe") + 4]
        self.rejected(self.request(row, message, label), 422)

    def test_multiple_evidence_without_selection_is_rejected(self):
        row, message = self.record()
        data = deepcopy(row.metadata_)
        data["evidence"] = [data["evidence"], data["evidence"]]
        row.metadata_ = data
        self.db.commit()
        self.rejected(self.request(row, message), 409)

    def test_repeated_evidence_is_ambiguous_not_first_match(self):
        row, message = self.record("NOIE 개발했어. NOIE 개발했어.")
        self.rejected(self.request(row, message), 409)
        second = self.db.scalar(select(Activity).where(Activity.message_id == message.id, Activity.record_index == 1))
        self.rejected(self.request(second, message, start=message.content.rindex("NOIE")), 409)

    def test_unicode_codepoints_not_utf16_or_bytes(self):
        row, message = self.record("🙂 e\u0301 기록. NOIE 개발했어.")
        request = self.request(row, message)
        self.assertEqual(request.source_span.start, 9)
        self.assertEqual(self.preview(request).source_span, request.source_span)
        data = request.model_dump()
        for start in (10, len(message.content[:9].encode("utf-8"))):
            self.rejected({**data, "source_span": {"start": start, "end": start + 4}}, 422)

    def test_same_name_different_records_never_merged(self):
        first, one = self.record("Alex 운동했어")
        second, two = self.record("Alex 운동했어")
        a = self.preview(self.request(first, one, "Alex", "person"))
        b = self.preview(self.request(second, two, "Alex", "person"))
        self.assertNotEqual(a.activity_id, b.activity_id)
        self.assertEqual((a.identity_status, b.identity_status), ("unresolved", "unresolved"))
        self.assertNotIn("object_id", a.model_dump())

    def test_pronoun_is_not_resolved_to_person(self):
        row, message = self.record("그 사람 이야기. NOIE 개발했어.")
        self.rejected(self.request(row, message, "그 사람", "person"), 422)
        self.rejected({**self.request(row, message).model_dump(), "label": "Alex"}, 422)

    def test_cross_account_and_missing_same_404(self):
        row, message = self.record(other_owner=True)
        self.rejected(self.request(row, message), 404)
        self.rejected({**self.request(row, message).model_dump(), "activity_id": uuid4()}, 404)

    def test_inactive_account_rejected_despite_cached_user(self):
        row, message = self.record()
        self.db.get(User, self.aid)
        with self.factory() as other:
            other.execute(update(User).where(User.id == self.aid).values(deleted_at=datetime.now(timezone.utc)))
            other.commit()
        self.rejected(self.request(row, message), 404)

    def test_deleted_conversation_rejected(self):
        row, message = self.record()
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.rejected(self.request(row, message), 404)

    def test_message_owner_mismatch_rejected(self):
        row, message = self.record()
        message.user_id = self.bid
        self.db.commit()
        self.rejected(self.request(row, message), 404)

    def test_message_conversation_mismatch_rejected(self):
        row, message = self.record()
        message.conversation_id = self.cb.id
        self.db.commit()
        self.rejected(self.request(row, message), 404)

    def test_assistant_and_system_sources_rejected(self):
        row, message = self.record()
        request = self.request(row, message)
        for role in ("assistant", "system"):
            message.role = role
            message.user_id = None
            self.db.commit()
            self.rejected(request, 404)

    def test_action_owner_or_source_mismatch_rejected(self):
        row, message = self.record()
        action = self.db.get(AgentAction, row.agent_action_id)
        for field, value in (("user_id", self.bid), ("message_id", self.mb.id), ("conversation_id", self.cb.id)):
            old = getattr(action, field)
            setattr(action, field, value)
            self.db.commit()
            self.rejected(self.request(row, message), 404)
            setattr(action, field, old)
            self.db.commit()

    def test_damaged_evidence_provenance_rejected(self):
        row, message = self.record()
        original = deepcopy(row.metadata_)
        for field, value in (("evidence_ref", str(self.mb.id)), ("summary", "OTHER 개발했어"),
                             ("source_type", "memory"), ("interpretation", False)):
            data = deepcopy(original)
            data["evidence"][field] = value
            row.metadata_ = data
            self.db.commit()
            self.rejected(self.request(row, message), 409)

    def test_damaged_metadata_rejected(self):
        row, message = self.record()
        original = deepcopy(row.metadata_)
        for data in ([], {}, {**original, "user_reported": False}, {**original, "time_issues": "PRIVATE_TOKEN"}):
            row.metadata_ = data
            self.db.commit()
            self.rejected(self.request(row, message), 409)

    def test_record_index_and_analysis_mismatch_rejected(self):
        row, message = self.record()
        row.record_index = 15
        self.db.commit()
        self.rejected(self.request(row, message), 409)
        row.record_index = 0
        row.action = "OTHER 개발"
        self.db.commit()
        self.rejected(self.request(row, message), 409)

    def test_mutated_original_or_sensitive_original_rejected(self):
        row, message = self.record()
        request = self.request(row, message)
        for content in ("NOIE 개발 안 했어", "NOIE 개발했어. password=SyntheticSecret987"):
            message.content = content
            self.db.commit()
            with captured_output() as output:
                error = self.rejected(request, 409)
            self.assertEqual(output.getvalue(), "")
            self.assertNotIn("SyntheticSecret987", str(error))

    def test_anonymous_denied_without_query(self):
        row, message = self.record()
        with patch.object(self.db, "execute") as execute, self.assertRaises(HTTPException) as error:
            service.preview_activity_object_reference(self.db, None, self.request(row, message))
        self.assertEqual(error.exception.status_code, 401)
        execute.assert_not_called()

    def test_db_failure_safe_no_log_or_transaction_mutation(self):
        row, message = self.record()
        secret = "password=SyntheticPassword token=SyntheticToken DATABASE_URL=synthetic-private"
        with captured_output() as output, patch.object(self.db, "execute", side_effect=SQLAlchemyError(secret)), \
                patch.object(self.db, "rollback") as rollback:
            error = self.rejected(self.request(row, message), 503)
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn(secret, str(error))
        rollback.assert_not_called()

    def test_invalid_input_safe_no_log(self):
        row, message = self.record()
        secret = "password=SyntheticPassword token=SyntheticToken"
        with captured_output() as output:
            error = self.rejected({**self.request(row, message).model_dump(), "kind": secret}, 422)
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn(secret, str(error))

    def test_repeat_read_no_writes_sdk_or_logs(self):
        row, message = self.record()
        request = self.request(row, message)
        before = deepcopy(row.metadata_)
        sql = []
        def trace(conn, cursor, statement, parameters, context, executemany):
            sql.append(statement.lstrip().split()[0].upper())
        event.listen(self.engine, "before_cursor_execute", trace)
        try:
            with captured_output() as output, patch.object(self.db, "flush") as flush, \
                    patch.object(self.db, "commit") as commit, patch.object(self.db, "rollback") as rollback, \
                    patch("openai.resources.responses.Responses.create") as responses, \
                    patch("openai.resources.chat.completions.Completions.create") as chat:
                first = self.preview(request)
                second = self.preview(request)
            self.assertEqual(first, second)
            self.assertEqual(output.getvalue(), "")
            for call in (flush, commit, rollback, responses, chat):
                call.assert_not_called()
            self.assertEqual(sql, ["SELECT", "SELECT"])
            self.assertEqual(row.metadata_, before)
            self.assertEqual(message.content, "NOIE 개발했어")
            self.assertFalse(self.db.dirty or self.db.new or self.db.deleted)
        finally:
            event.remove(self.engine, "before_cursor_execute", trace)

    def test_caller_pending_changes_neither_flushed_nor_overwritten(self):
        row, message = self.record()
        request = self.request(row, message)
        message.content = "caller pending unrelated edit"
        row.action = "caller pending interpretation"
        pending = User(name="synthetic-pending")
        self.db.add(pending)
        with patch.object(self.db, "flush") as flush, patch.object(self.db, "rollback") as rollback:
            result = self.preview(request)
        self.assertEqual(result.label, "NOIE")
        self.assertEqual(message.content, "caller pending unrelated edit")
        self.assertEqual(row.action, "caller pending interpretation")
        self.assertIn(pending, self.db.new)
        self.assertIn(message, self.db.dirty)
        flush.assert_not_called()
        rollback.assert_not_called()

    def test_unknown_observation_and_activity_times_preserved(self):
        row, message = self.record()
        self.assertIsNone(self.preview(self.request(row, message)).observed_at)
        self.assertEqual((row.start_time, row.end_time, row.duration_minutes), (None, None, None))

    def test_existing_aware_observation_only_not_invented(self):
        row, message = self.record()
        statement = service._owned_query(self.aid).where(Activity.id == row.id).with_only_columns(
            Activity.record_index, Activity.action, Activity.status, Activity.activity_date, Activity.start_time,
            Activity.end_time, Activity.duration_minutes, Activity.observed_at, Activity.confidence,
            Activity.metadata_.label("metadata"), Message.id.label("message_id"), Message.content,
            Message.created_at.label("message_created_at"))
        snapshot = deepcopy(dict(self.db.execute(statement).mappings().one()))
        observed = datetime(2026, 10, 9, 1, 2, tzinfo=timezone.utc)
        snapshot["observed_at"] = snapshot["message_created_at"] = observed
        snapshot["metadata"]["evidence"]["observed_at"] = observed.isoformat()
        result = Mock()
        result.mappings.return_value.one_or_none.return_value = snapshot
        with patch.object(self.db, "execute", return_value=result):
            self.assertEqual(self.preview(self.request(row, message)).observed_at, observed)
        snapshot["observed_at"] = datetime(2026, 10, 8, 1, 2, tzinfo=timezone.utc)
        with patch.object(self.db, "execute", return_value=result):
            self.rejected(self.request(row, message), 409)


if __name__ == "__main__":
    unittest.main()
