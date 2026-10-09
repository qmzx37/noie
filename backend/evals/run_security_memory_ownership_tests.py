"""P1-3 소유권 경계를 합성 SQLite와 Mock SDK로 검증합니다. 운영 DB에는 연결하지 않습니다."""

import contextlib
import io
import json
import logging
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Run with the isolated security verifier")

from sqlalchemy import select
import memory_extraction_service as extraction
import memory_reconciliation_service as reconciliation
import memory_retriever as retrieval
import memory_service as service
from evals import run_security_memory_privacy_tests as fixture
from memory_schemas import MemoryReconciliationDecision
from models.memory import Memory, MemoryEvidence
from models.memory_extraction import MemoryExtraction
from models.message import Message


class MemoryOwnershipTests(unittest.TestCase):
    """기존 fixture의 계정/원문만 사용하며 모듈 guard와 개인정보 assertion은 제거하지 않습니다."""

    count = fixture.MemoryPrivacyTests.count
    message = fixture.MemoryPrivacyTests.message
    memory_body = fixture.MemoryPrivacyTests.memory_body
    run_extraction = fixture.MemoryPrivacyTests.run_extraction

    def setUp(self):
        fixture.MemoryPrivacyTests.setUp(self)
        self.stack.enter_context(patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-not-a-key"}))
        self.first, self.second, self.selector = Mock(), Mock(), Mock()
        self.first.responses.create.return_value = SimpleNamespace(output_text=json.dumps(fixture.decision().model_dump()))
        self.second.responses.create.return_value = SimpleNamespace(output_text=json.dumps(
            dict(action="new", matched_memory_id="", reason="synthetic new goal", confidence=.9)))
        self.selector.responses.create.return_value = SimpleNamespace(output_text='{"selected_memories": []}')
        for name, client in (("memory_extractor", self.first), ("memory_reconciler", self.second),
                             ("memory_retriever", self.selector)):
            self.stack.enter_context(patch(name + ".OpenAI", return_value=client))
        self.logs = io.StringIO()
        self.stack.enter_context(contextlib.redirect_stdout(self.logs))
        self.stack.enter_context(contextlib.redirect_stderr(self.logs))
        handler = logging.StreamHandler(self.logs)
        logging.getLogger().addHandler(handler)
        self.stack.callback(logging.getLogger().removeHandler, handler)

    def tearDown(self):
        fixture.MemoryPrivacyTests.tearDown(self)

    def snapshot(self):
        return tuple(self.count(model) for model in (Message, Memory, MemoryEvidence, MemoryExtraction))

    def corrupt_author(self, user_id):
        self.ma.user_id = user_id
        self.db.commit()

    def add_evidence(self, message_id):
        self.db.add(MemoryEvidence(memory_id=self.memory.id, message_id=message_id))
        self.db.commit()

    def assert_hidden(self, response):
        # 거부 응답/로그에 다른 계정 원문, UUID 또는 DB 예외가 복제되지 않는지 확인합니다.
        for value in (self.ma.content, self.mb.content, self.memory.content, str(self.a.id),
                      str(self.b.id), str(self.memory.id), "SYNTHETIC_P13_SECRET"):
            self.assertNotIn(value, response.text + self.logs.getvalue())

    def assert_memory_excluded(self):
        response = self.client.get(f"/memories/{self.memory.id}")
        self.assertEqual(response.status_code, 404)
        self.assert_hidden(response)
        listed = self.client.get(f"/users/{self.a.id}/memories")
        self.assertEqual(listed.status_code, 200)
        self.assertNotIn(str(self.memory.id), listed.text)
        self.assertNotIn(self.mb.content, listed.text)
        self.assertNotIn(self.memory.id, {item.memory_id for item in retrieval.fetch_memory_candidates(self.a.id)})
        self.assertNotIn(str(self.memory.id), {item["id"] for item in reconciliation.find_reconciliation_candidates(self.a.id, "goal")})

    def test_v204_foreign_author_message_not_returned(self):
        self.corrupt_author(self.b.id)
        before = self.snapshot()
        response = self.client.get(f"/conversations/{self.ca.id}/messages")
        self.assertEqual(response.status_code, 404)
        self.assert_hidden(response)
        self.assertEqual(self.snapshot(), before)

    def test_v205_foreign_author_no_extraction_or_sdk(self):
        self.corrupt_author(self.b.id)
        before = self.snapshot()
        response = self.client.post(f"/messages/{self.ma.id}/extract-memory", json={"user_id": str(self.a.id)})
        self.assertEqual(response.status_code, 404)
        self.first.responses.create.assert_not_called()
        self.second.responses.create.assert_not_called()
        self.assert_hidden(response)
        self.assertEqual(self.snapshot(), before)

    def test_null_user_author_rejected_before_sdk(self):
        self.corrupt_author(None)
        with self.assertRaises(extraction.MemoryExtractionNotFoundError):
            extraction.extract_memory_for_message(self.ma.id, self.a.id)
        self.first.responses.create.assert_not_called()
        self.assertEqual(self.count(MemoryExtraction), 0)

    def test_manual_memory_rejects_inconsistent_author_without_write(self):
        self.corrupt_author(self.b.id)
        before = self.snapshot()
        response = self.client.post("/memories", json=self.memory_body())
        self.assertEqual(response.status_code, 400)
        self.assert_hidden(response)
        self.assertEqual(self.snapshot(), before)

    def test_manual_memory_rejects_null_user_author(self):
        self.corrupt_author(None)
        before = self.snapshot()
        self.assertEqual(self.client.post("/memories", json=self.memory_body()).status_code, 400)
        self.assertEqual(self.snapshot(), before)

    def test_manual_memory_rejects_foreign_conversation(self):
        before = self.snapshot()
        self.assertEqual(self.client.post("/memories", json=self.memory_body(evidence=self.mb.id)).status_code, 400)
        self.assertEqual(self.snapshot(), before)

    def test_normal_manual_memory_create_get_and_list(self):
        response = self.client.post("/memories", json=self.memory_body())
        self.assertEqual(response.status_code, 201)
        memory_id = response.json()["id"]
        self.assertEqual(response.json()["evidence"][0]["message"]["content"], self.ma.content)
        self.assertEqual(self.client.get(f"/memories/{memory_id}").status_code, 200)
        self.assertIn(memory_id, self.client.get(f"/users/{self.a.id}/memories").text)
        self.assertNotIn(self.mb.content, response.text)

    def test_assistant_and_system_null_author_evidence_remains_allowed(self):
        for role in ("assistant", "system"):
            row = Message(conversation_id=self.ca.id, user_id=None, role=role, content="synthetic reply")
            self.db.add(row)
            self.db.commit()
            response = self.client.post("/memories", json=self.memory_body(evidence=row.id))
            self.assertEqual(response.status_code, 201)

    def test_assistant_foreign_author_evidence_rejected(self):
        self.assistant.user_id = self.b.id
        self.db.commit()
        self.assertEqual(self.client.post("/memories", json=self.memory_body(evidence=self.assistant.id)).status_code, 400)

    def test_foreign_evidence_excludes_entire_memory_without_deletion(self):
        self.add_evidence(self.mb.id)
        before = self.snapshot()
        self.assert_memory_excluded()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.db.get(Memory, self.memory.id).content, self.memory.content)

    def test_inconsistent_evidence_author_excluded(self):
        self.corrupt_author(self.b.id)
        self.assert_memory_excluded()

    def test_null_user_evidence_author_excluded(self):
        self.corrupt_author(None)
        self.assert_memory_excluded()

    def test_deleted_evidence_conversation_excluded(self):
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assert_memory_excluded()

    def test_missing_evidence_message_fail_closed(self):
        evidence = self.db.scalar(select(MemoryEvidence).where(MemoryEvidence.memory_id == self.memory.id))
        evidence.message_id = uuid4()
        self.db.commit()
        self.assert_memory_excluded()

    def test_missing_evidence_conversation_fail_closed(self):
        self.ma.conversation_id = uuid4()
        self.db.commit()
        self.assert_memory_excluded()

    def test_inactive_user_blocks_reads_extraction_and_candidate_loading(self):
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        for url in (f"/memories/{self.memory.id}", f"/users/{self.a.id}/memories"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 404)
            self.assert_hidden(response)
        with self.assertRaises(retrieval.MemoryRetrievalNotFoundError):
            retrieval.fetch_memory_candidates(self.a.id)
        with self.assertRaises(reconciliation.MemoryReconciliationValidationError):
            reconciliation.find_reconciliation_candidates(self.a.id, "goal")
        with self.assertRaises(extraction.MemoryExtractionNotFoundError):
            extraction.extract_memory_for_message(self.ma.id, self.a.id)
        self.first.responses.create.assert_not_called()

    def test_deleted_conversation_blocks_new_evidence_and_extraction(self):
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.client.post("/memories", json=self.memory_body()).status_code, 400)
        with self.assertRaises(extraction.MemoryExtractionNotFoundError):
            extraction.extract_memory_for_message(self.ma.id, self.a.id)
        self.first.responses.create.assert_not_called()

    def test_invalid_memory_not_sent_to_selector_or_reconciler(self):
        self.add_evidence(self.mb.id)
        self.assertEqual(retrieval.retrieve_relevant_memories(self.a.id, "goal"), ([], []))
        self.selector.responses.create.assert_not_called()
        # 유효한 새 원문의 추출은 계속되지만 기존의 잘못된 Memory는 두 번째 모델 후보에 없습니다.
        result = extraction.extract_memory_for_message(self.message("synthetic new lasting goal").id, self.a.id)
        self.assertEqual(result.status, "completed")
        self.second.responses.create.assert_not_called()
        self.assertNotIn(self.mb.content, json.dumps(self.first.responses.create.call_args.kwargs))

    def test_mixed_candidates_exclude_foreign_evidence_and_identifier(self):
        bad = Memory(user_id=self.a.id, content="synthetic foreign-linked memory", kind="goal", importance=100)
        self.db.add(bad)
        self.db.flush()
        self.db.add(MemoryEvidence(memory_id=bad.id, message_id=self.mb.id))
        self.db.commit()
        retrieval.retrieve_relevant_memories(self.a.id, "goal")
        extraction.extract_memory_for_message(self.message("synthetic new goal").id, self.a.id)
        for client in (self.selector, self.second):
            self.assertEqual(client.responses.create.call_count, 1)
            payload = json.dumps(client.responses.create.call_args.kwargs)
            for value in (bad.content, str(bad.id), self.mb.content, str(self.b.id)):
                self.assertNotIn(value, payload + self.logs.getvalue())

    def test_sdk_boundary_rechecks_evidence_after_client_construction(self):
        def client(**_kwargs):
            self.add_evidence(self.mb.id)
            return self.selector
        with patch.object(retrieval, "OpenAI", side_effect=client):
            with self.assertRaises(Exception) as caught:
                retrieval.retrieve_relevant_memories(self.a.id, "goal")
        from private_model_access import PrivateModelAccessDenied
        self.assertIsInstance(caught.exception, PrivateModelAccessDenied)
        self.selector.responses.create.assert_not_called()
        self.assertNotIn(self.mb.content, self.logs.getvalue())

    def test_retrieval_rechecks_after_sdk_before_returning_memory(self):
        def reply(**_kwargs):
            self.add_evidence(self.mb.id)
            return SimpleNamespace(output_text=json.dumps({"selected_memories": [
                dict(memory_id=str(self.memory.id), relevance=.9, reason="synthetic relevant")]}))
        self.selector.responses.create.side_effect = reply
        self.assertEqual(retrieval.retrieve_relevant_memories(self.a.id, "goal"), ([], []))

    def test_retrieval_rechecks_account_after_sdk(self):
        def reply(**_kwargs):
            self.a.deleted_at = datetime.now(timezone.utc)
            self.db.commit()
            return SimpleNamespace(output_text='{"selected_memories": []}')
        self.selector.responses.create.side_effect = reply
        with self.assertRaises(retrieval.MemoryRetrievalNotFoundError):
            retrieval.retrieve_relevant_memories(self.a.id, "goal")

    def test_db_failure_is_fail_closed_without_sensitive_response_or_logs(self):
        from sqlalchemy.exc import SQLAlchemyError
        with patch.object(self.db, "scalar", side_effect=SQLAlchemyError("SYNTHETIC_P13_SECRET")):
            response = self.client.get(f"/memories/{self.memory.id}")
        self.assertEqual(response.status_code, 500)
        self.assert_hidden(response)
        with patch.object(retrieval, "SessionLocal", side_effect=SQLAlchemyError("SYNTHETIC_P13_SECRET")):
            self.assertEqual(retrieval.retrieve_relevant_memories_safe(self.a.id, "goal"), [])
        self.selector.responses.create.assert_not_called()
        self.assertNotIn("SYNTHETIC_P13_SECRET", self.logs.getvalue())

    def test_cached_extraction_does_not_bypass_new_author_mismatch(self):
        result = extraction.extract_memory_for_message(self.ma.id, self.a.id)
        self.corrupt_author(self.b.id)
        for invoke in (extraction.extract_memory_for_message, extraction.get_memory_extraction):
            with self.assertRaises(extraction.MemoryExtractionNotFoundError):
                invoke(self.ma.id, self.a.id)
        self.assertEqual(self.first.responses.create.call_count, 1)
        self.assertEqual(self.count(MemoryExtraction), 1)
        self.assertEqual(result.status, "completed")

    def test_cached_extraction_rejects_foreign_memory_result(self):
        result = extraction.extract_memory_for_message(self.ma.id, self.a.id)
        foreign = Memory(user_id=self.b.id, content="synthetic foreign memory", kind="goal")
        self.db.add(foreign)
        self.db.flush()
        stored = self.db.get(MemoryExtraction, result.id)
        stored.memory_id = foreign.id
        self.db.commit()
        for invoke in (extraction.extract_memory_for_message, extraction.get_memory_extraction):
            with self.assertRaises(extraction.MemoryExtractionNotFoundError):
                invoke(self.ma.id, self.a.id)
        self.assertEqual(self.first.responses.create.call_count, 1)

    def test_cached_extraction_rejects_corrupt_result_evidence(self):
        result = extraction.extract_memory_for_message(self.ma.id, self.a.id)
        self.db.add(MemoryEvidence(memory_id=result.memory_id, message_id=self.mb.id))
        self.db.commit()
        with self.assertRaises(extraction.MemoryExtractionNotFoundError):
            extraction.get_memory_extraction(self.ma.id, self.a.id)

    def test_reinforce_and_supersede_revalidate_existing_evidence_before_commit(self):
        for action in ("reinforce", "supersede"):
            self.first.reset_mock()
            self.second.reset_mock()
            # 소유권 검증 뒤 연결이 바뀌는 finalize 경로를 직접 호출합니다.
            message = self.message("synthetic lasting goal")
            state, acquired, _, _ = extraction._acquire_processing_lease(message.id, self.a.id)
            self.assertTrue(acquired)
            before = self.snapshot()
            candidates = [{"id": str(self.memory.id), "content": self.memory.content}]
            if action == "reinforce":
                self.add_evidence(self.mb.id)
                before = self.snapshot()
            with self.assertRaises(reconciliation.MemoryReconciliationValidationError):
                reconciliation.apply_reconciliation(extraction_id=state.id, user_id=self.a.id,
                    message_id=message.id, candidate=fixture.decision(), candidates=candidates,
                    decision=MemoryReconciliationDecision(action=action, matched_memory_id=self.memory.id,
                        reason="synthetic change", confidence=.9), expected_attempt_count=state.attempt_count)
            self.assertEqual(self.snapshot(), before)
            self.db.expire_all()
            self.assertEqual(self.db.get(Memory, self.memory.id).status, "active")
            self.assertEqual(self.db.get(MemoryExtraction, state.id).status, "processing")

    def test_normal_new_reinforce_supersede_and_duplicate_preserved(self):
        fixture.MemoryPrivacyTests.test_new_reinforce_supersede_standard_transaction_regression(self)

    def test_reconciler_sdk_boundary_rechecks_candidate_evidence(self):
        def client(**_kwargs):
            self.add_evidence(self.mb.id)
            return self.second
        with patch("memory_reconciler.OpenAI", side_effect=client):
            with self.assertRaises(extraction.MemoryExtractionNotFoundError):
                extraction.extract_memory_for_message(self.message("synthetic lasting goal").id, self.a.id)
        self.assertEqual(self.first.responses.create.call_count, 1)
        self.second.responses.create.assert_not_called()
        self.assertNotIn(self.mb.content, self.logs.getvalue())

    def test_reconciler_sdk_boundary_rechecks_source_author(self):
        def client(**_kwargs):
            self.corrupt_author(self.b.id)
            return self.second
        with patch("memory_reconciler.OpenAI", side_effect=client):
            with self.assertRaises(extraction.MemoryExtractionNotFoundError):
                extraction.extract_memory_for_message(self.ma.id, self.a.id)
        self.assertEqual(self.first.responses.create.call_count, 1)
        self.second.responses.create.assert_not_called()

    def test_reconciliation_sdk_guard_database_failure_is_fail_closed(self):
        from sqlalchemy.exc import SQLAlchemyError
        def client(**_kwargs):
            reconciliation.SessionLocal = Mock(side_effect=SQLAlchemyError("SYNTHETIC_P13_SECRET"))
            return self.second
        with patch.object(reconciliation, "SessionLocal", reconciliation.SessionLocal), \
                patch("memory_reconciler.OpenAI", side_effect=client):
            with self.assertRaises(extraction.MemoryExtractionNotFoundError):
                extraction.extract_memory_for_message(self.ma.id, self.a.id)
        self.second.responses.create.assert_not_called()
        self.assertNotIn("SYNTHETIC_P13_SECRET", self.logs.getvalue())

    def test_other_account_http_denial_still_404_without_content(self):
        self.principal = type(self.principal)(self.b.id)
        response = self.client.get(f"/memories/{self.memory.id}")
        self.assertEqual(response.status_code, 404)
        self.assert_hidden(response)


if __name__ == "__main__":
    unittest.main()
