"""Memory privacy는 합성 내용/격리 SQLite/mock으로 검사합니다. 외부 서비스는 호출하지 않습니다."""

import json
import os
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import datetime, timedelta, timezone
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

import memory_extraction_service as extraction
import memory_extractor as extractor
import memory_retriever as retrieval
import memory_reconciler as reconciler
import memory_reconciliation_service as reconciliation
from memory_privacy import PrivacyClass, PRIVACY_BLOCK_REASON, automatic_memory_allowed, classify_memory_text
from memory_schemas import MemoryExtractionDecision, MemoryReconciliationDecision, MemoryRetrievalCandidate
from models.memory import Memory, MemoryEvidence
from models.memory_extraction import MemoryExtraction
from models.message import Message
from evals import run_auth_surface_tests as ownership


FAKE_PASSWORD = "SYNTHETIC_NOT_A_CREDENTIAL"
SECRET = f"이건 꼭 기억해. 내 비밀번호는 {FAKE_PASSWORD}"
HEALTH = "나는 당뇨가 있다"
THIRD = "내 친구가 암 진단받았어"


def decision(content="나는 장기적으로 AI 개발자가 되고 싶다", **updates):
    """모델 응답도 실제 개인 정보가 아닌 합성 fixture입니다."""
    return MemoryExtractionDecision(**{**dict(should_remember=True, reason="명시적인 장기 목표",
        content=content, kind="goal", importance=70, confidence=.9), **updates})


class MemoryPrivacyTests(unittest.TestCase):
    """기존 ownership fixture의 PostgreSQL 모델 복사 테이블만 SQLite로 사용합니다."""

    def setUp(self):
        ownership.AuthSurfaceTests.setUp(self)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {"NOIE_RATE_LIMIT_ENABLED": "false"}))
        factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        for module in (extraction, retrieval, reconciliation):
            self.stack.enter_context(patch.object(module, "SessionLocal", factory))

    def tearDown(self):
        self.stack.close()
        ownership.AuthSurfaceTests.tearDown(self)

    memory_body = ownership.AuthSurfaceTests.memory_body

    def message(self, content):
        """테스트 계정에만 원문을 추가하며 기존 실제 DB에는 접근하지 않습니다."""
        row = Message(conversation_id=self.ca.id, user_id=self.a.id, role="user", content=content)
        self.db.add(row)
        self.db.commit()
        return row

    def count(self, model):
        return self.db.scalar(select(func.count()).select_from(model))

    def run_extraction(self, message, output=None):
        with patch.object(extraction, "extract_memory_with_openai", return_value=output or decision()) as llm, \
                patch.object(extraction, "reconcile_memory_candidate", return_value=MemoryReconciliationDecision(
                    action="new", matched_memory_id=None, reason="새 목표", confidence=.9)):
            result = extraction.extract_memory_for_message(message.id, self.a.id)
            return result, llm.call_count

    def test_standard_goals_projects_routines_and_relationships_allowed(self):
        for content in ("나는 장기적으로 AI 개발자가 되고 싶다", "NOIE 프로젝트를 계속 개발 중이다",
                        "나는 매운 음식을 좋아한다", "매일 아침 달린다", "친구 A와 매주 같이 운동한다"):
            self.assertEqual(classify_memory_text(content), PrivacyClass.STANDARD)
            row = self.message(content)
            result, calls = self.run_extraction(row, decision(content))
            self.assertEqual(result.status, "completed")
            self.assertTrue(result.should_remember)
            self.assertIsNotNone(result.memory_id)
            self.assertEqual(calls, 1)

    def test_false_positive_project_examples_are_not_sensitive(self):
        for content in ("병원 예약 앱 아이디어를 만들고 싶다", "정치 뉴스 추천 서비스를 만들고 싶다",
                        "비밀번호 관리 기능을 개발하고 싶다", "은행 API 공부 중이다", "친구랑 운동한다"):
            self.assertTrue(automatic_memory_allowed(content), content)

    def test_attack_memory_001_002_prefilter_secret_and_completed_no_retry(self):
        row = self.message(SECRET)
        before = self.count(Memory)
        with redirect_stdout(StringIO()) as logs:
            result, calls = self.run_extraction(row)
            again, second_calls = self.run_extraction(row)
        self.assertEqual(calls + second_calls, 0)
        self.assertEqual(result.status, "completed")
        self.assertFalse(result.should_remember)
        self.assertIsNone(result.memory_id)
        self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)
        self.assertEqual(again.id, result.id)
        self.assertEqual(again.attempt_count, 1)
        self.assertEqual(self.count(Memory), before)
        self.assertEqual(self.db.get(Message, row.id).content, SECRET)
        self.assertNotIn(FAKE_PASSWORD, logs.getvalue())

    def test_secret_categories_block_before_extractor_client(self):
        examples = (SECRET, "Authorization: Bearer SYNTHETIC_TOKEN_ONLY", "api_key=SYNTHETIC_API_KEY_ONLY",
                    "refresh_token=SYNTHETIC_REFRESH_ONLY", "내 access token은 SYNTHETIC_ONLY", "sk-proj-" + "SYNTHETIC" * 4,
                    "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_ONLY\n-----END PRIVATE KEY-----",
                    "카드번호: " + "0" * 16, "주민번호 " + "0" * 6 + "-" + "1" + "0" * 6)
        for content in examples:
            self.assertEqual(classify_memory_text(content), PrivacyClass.RESTRICTED_SECRET)
            result = extractor.extract_memory_with_openai(content)
            self.assertFalse(result.should_remember)
            result, calls = self.run_extraction(self.message(content))
            self.assertEqual(calls, 0)
            self.assertEqual(result.status, "completed")

    def test_sensitive_auto_blocked_categories(self):
        for content in (HEALTH, "나는 암 진단을 받았다", "나는 성생활에 대해 말하고 싶어", "내 종교는 불교야",
                        "나는 민주당을 지지한다", "나는 노동조합에 가입했어", "나는 유죄 판결을 받았어",
                        "내 연봉은 5000만원", "내 주소는 합성로 123호"):
            self.assertEqual(classify_memory_text(content), PrivacyClass.SENSITIVE, content)
            result, calls = self.run_extraction(self.message(content))
            self.assertEqual(calls, 0)
            self.assertFalse(result.should_remember)

    def test_attack_memory_003_third_party_sensitive(self):
        for content in (THIRD, "친구가 민주당을 지지한다", "동료가 노동조합에 가입했다",
                        "어머니는 불교 신자다", "친구가 동성애자다", "친구의 연봉은 5000만원",
                        "친구의 주소는 합성로 123호", "친구는 유죄 판결을 받았다"):
            self.assertEqual(classify_memory_text(content), PrivacyClass.THIRD_PARTY_SENSITIVE, content)
            result, calls = self.run_extraction(self.message(content))
            self.assertFalse(result.should_remember)
            self.assertEqual(calls, 0)

    def test_attack_memory_004_model_output_cannot_override_privacy(self):
        before = self.count(Memory)
        for output in (decision(SECRET), decision(HEALTH), decision(THIRD), decision(reason=SECRET)):
            result, calls = self.run_extraction(self.message("장기적으로 개발을 계속하고 싶다"), output)
            self.assertEqual(calls, 1)
            self.assertEqual(result.status, "completed")
            self.assertFalse(result.should_remember)
            self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)
        self.assertEqual(self.count(Memory), before)

    def test_false_model_decision_with_secret_reason_is_sanitized(self):
        result, _ = self.run_extraction(self.message("일반 대화"), decision("", should_remember=False, reason=SECRET))
        self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)
        self.assertIsNone(result.memory_id)

    def test_manual_standard_and_sensitive_allowed_with_original_evidence(self):
        for content in ("나는 AI 개발자가 되고 싶다", HEALTH):
            body = {**self.memory_body(), "content": content}
            response = self.client.post("/memories", json=body)
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["content"], content)
            self.assertEqual(response.json()["evidence"][0]["message"]["content"], self.ma.content)

    def test_manual_secret_rejected_safely_and_no_memory_or_evidence_write(self):
        before = (self.count(Memory), self.count(MemoryEvidence))
        with redirect_stdout(StringIO()) as logs:
            response = self.client.post("/memories", json={**self.memory_body(), "content": SECRET})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(FAKE_PASSWORD, response.text + logs.getvalue())
        self.assertEqual((self.count(Memory), self.count(MemoryEvidence)), before)

    def test_ownership_404_and_foreign_evidence_still_rejected(self):
        self.principal = type(self.principal)(self.b.id)
        response = self.client.get(f"/memories/{self.memory.id}")
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(self.ma.content, response.text)
        self.assertEqual(self.client.post("/memories", json={**self.memory_body(user_id=self.b.id), "content": HEALTH}).status_code, 400)

    def test_attack_memory_005_legacy_candidates_filtered_but_not_deleted(self):
        rows = [Memory(user_id=self.a.id, content=content, kind="other", importance=100) for content in (SECRET, HEALTH, THIRD)]
        self.db.add_all(rows)
        self.db.commit()
        candidates = retrieval.fetch_memory_candidates(self.a.id)
        self.assertIn(self.memory.id, {candidate.memory_id for candidate in candidates})
        self.assertFalse({row.id for row in rows} & {candidate.memory_id for candidate in candidates})
        self.assertEqual(self.count(Memory), 4)
        # 본인 detail은 원문 evidence/legacy 조회 계약을 그대로 유지합니다.
        self.assertEqual(self.client.get(f"/memories/{rows[0].id}").json()["content"], SECRET)

    def test_selection_double_check_and_threshold_top_k_unchanged(self):
        secret = MemoryRetrievalCandidate(memory_id=uuid4(), content=SECRET, kind="other", importance=99, confidence=.9)
        standard = MemoryRetrievalCandidate(memory_id=uuid4(), content="AI 개발 목표", kind="goal", importance=80, confidence=.9)
        result = retrieval.resolve_selected_memories([
            {"memory_id": str(secret.memory_id), "relevance": 1, "reason": "fixture"},
            {"memory_id": str(standard.memory_id), "relevance": .9, "reason": SECRET},
        ], [secret, standard])
        self.assertEqual([item.memory_id for item in result], [standard.memory_id])
        self.assertNotIn(FAKE_PASSWORD, result[0].reason)
        self.assertEqual((retrieval.MAX_MEMORY_CANDIDATES, retrieval.MAX_SELECTED_MEMORIES, retrieval.MIN_RELEVANCE), (25, 4, .55))

    def test_sensitive_query_avoids_extra_retrieval_model_call(self):
        candidates = [MemoryRetrievalCandidate(memory_id=uuid4(), content="AI 개발 목표", kind="goal", importance=70, confidence=.9)]
        self.assertEqual(retrieval.select_relevant_memories(SECRET, candidates), [])
        self.assertEqual(retrieval.select_relevant_memories("일반 질문", [candidates[0].model_copy(update={"content": SECRET})]), [])

    def test_reconciliation_legacy_private_candidates_not_sent_or_reinforced(self):
        for content in (SECRET, HEALTH, THIRD):
            row = Memory(user_id=self.a.id, content=content, kind="goal", importance=99)
            self.db.add(row)
        self.db.commit()
        candidates = reconciliation.find_reconciliation_candidates(self.a.id, "goal")
        self.assertEqual([candidate["content"] for candidate in candidates], [self.memory.content])
        result = reconciler.reconcile_memory_candidate(decision(), [{"id": str(uuid4()), "content": SECRET}])
        self.assertEqual(result.action, "new")

    def test_new_reinforce_supersede_standard_transaction_regression(self):
        result, _ = self.run_extraction(self.message("AI 개발 목표"))
        old_id = result.memory_id
        for action in ("reinforce", "supersede"):
            row = self.message("명시적으로 바뀐 AI 개발 목표" if action == "supersede" else "AI 개발 목표를 유지한다")
            with patch.object(extraction, "extract_memory_with_openai", return_value=decision()), \
                    patch.object(extraction, "reconcile_memory_candidate", return_value=MemoryReconciliationDecision(
                        action=action, matched_memory_id=old_id, reason="명시적인 목표", confidence=.9)):
                result = extraction.extract_memory_for_message(row.id, self.a.id)
                again = extraction.extract_memory_for_message(row.id, self.a.id)
            self.assertEqual(result.status, "completed")
            self.assertEqual(again.memory_id, result.memory_id)
            if action == "reinforce":
                self.assertEqual(result.memory_id, old_id)
            else:
                self.assertNotEqual(result.memory_id, old_id)
                self.db.expire_all()
                self.assertEqual(self.db.get(Memory, old_id).status, "superseded")

    def test_privacy_completion_respects_attempt_fencing(self):
        row = self.message(SECRET)
        state = MemoryExtraction(message_id=row.id, extractor_version=extractor.EXTRACTOR_VERSION,
                                 status="processing", attempt_count=2)
        self.db.add(state)
        self.db.commit()
        from memory_privacy import blocked_memory_decision
        result = extraction._complete_without_memory(state.id, 1, blocked_memory_decision())
        self.assertEqual(result.status, "processing")
        self.assertEqual(result.attempt_count, 2)

    def test_reconciliation_reason_sensitive_is_completed_without_memory(self):
        with patch.object(extraction, "extract_memory_with_openai", return_value=decision()), \
                patch.object(extraction, "reconcile_memory_candidate", return_value=MemoryReconciliationDecision(
                    action="new", matched_memory_id=None, reason=SECRET, confidence=.9)):
            result = extraction.extract_memory_for_message(self.message("AI 개발 목표").id, self.a.id)
        self.assertEqual(result.status, "completed")
        self.assertFalse(result.should_remember)
        self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)

    def test_extractor_real_parser_post_gate_overrides_mock_model(self):
        """실제 JSON 파서 뒤 gate도 검사하되 SDK는 완전히 mock으로 대체합니다."""
        client = Mock()
        client.responses.create.return_value = SimpleNamespace(
            output_text=json.dumps(decision(SECRET).model_dump()))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), \
                patch.object(extractor, "OpenAI", return_value=client):
            result = extractor.extract_memory_with_openai("일반적인 개발 목표")
        self.assertFalse(result.should_remember)
        self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)
        self.assertEqual(result.content, "")

    def test_selection_and_reconciliation_payloads_exclude_private_legacy(self):
        """SDK에 넘기는 실제 payload와 동적 ID schema 모두 공개 가능한 후보만 포함합니다."""
        standard = MemoryRetrievalCandidate(memory_id=uuid4(), content="AI 개발 목표", kind="goal", importance=70, confidence=.9)
        secret = standard.model_copy(update={"memory_id": uuid4(), "content": SECRET})
        client = Mock()
        client.responses.create.return_value = SimpleNamespace(output_text='{"selected_memories": []}')
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), \
                patch.object(retrieval, "OpenAI", return_value=client):
            retrieval.select_relevant_memories("개발 목표 질문", [standard, secret])
        payload = client.responses.create.call_args.kwargs
        self.assertNotIn(FAKE_PASSWORD, json.dumps(payload))
        self.assertNotIn(str(secret.memory_id), json.dumps(payload))
        client.reset_mock()
        client.responses.create.return_value = SimpleNamespace(output_text=json.dumps(
            dict(action="new", matched_memory_id="", reason="새 목표", confidence=.9)))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), \
                patch.object(reconciler, "OpenAI", return_value=client):
            reconciler.reconcile_memory_candidate(decision(), [
                {"id": str(standard.memory_id), "content": standard.content},
                {"id": str(secret.memory_id), "content": SECRET}])
        self.assertNotIn(FAKE_PASSWORD, json.dumps(client.responses.create.call_args.kwargs))
        self.assertNotIn(str(secret.memory_id), json.dumps(client.responses.create.call_args.kwargs))

    def test_sdk_exception_logs_only_type_not_secret_or_sensitive_text(self):
        """SDK 예외에 합성 민감 원문이 있어도 Memory 로그에는 오류 종류만 남깁니다."""
        client = Mock()
        client.responses.create.side_effect = RuntimeError(SECRET + HEALTH)
        standard = MemoryRetrievalCandidate(memory_id=uuid4(), content="AI 개발 목표", kind="goal", importance=70, confidence=.9)
        calls = (
            (extractor, lambda: extractor.extract_memory_with_openai("개발 목표")),
            (retrieval, lambda: retrieval.select_relevant_memories("개발 질문", [standard])),
            (reconciler, lambda: reconciler.reconcile_memory_candidate(decision(), [{"id": str(uuid4()), "content": "개발 목표"}])),
        )
        for module, invoke in calls:
            with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), \
                    patch.object(module, "OpenAI", return_value=client), redirect_stdout(StringIO()) as logs:
                with self.assertRaises(RuntimeError):
                    invoke()
            self.assertIn("RuntimeError", logs.getvalue())
            self.assertNotIn(FAKE_PASSWORD, logs.getvalue())
            self.assertNotIn(HEALTH, logs.getvalue())

    def test_active_stale_and_exhausted_lease_control_flow_preserved(self):
        """시간 분기는 mock 세션으로 검증합니다. 실제 PostgreSQL lock 경쟁 테스트는 아닙니다."""
        now = datetime.now(timezone.utc)
        for attempts, expires, acquired in ((1, now + timedelta(hours=1), False),
                                             (1, now - timedelta(hours=1), True),
                                             (3, now - timedelta(hours=1), False)):
            state = MemoryExtraction(id=uuid4(), message_id=self.ma.id, status="processing",
                                     attempt_count=attempts, lease_expires_at=expires)
            db = Mock()
            db.scalar.return_value = state
            factory = Mock()
            factory.return_value.__enter__ = Mock(return_value=db)
            factory.return_value.__exit__ = Mock(return_value=False)
            with patch.object(extraction, "SessionLocal", factory), \
                    patch.object(extraction, "_get_owned_user_message", return_value=(self.ma, self.a.id)):
                result, got_lease, _, _ = extraction._acquire_processing_lease(self.ma.id, self.a.id)
            self.assertEqual(got_lease, acquired)
            self.assertEqual(result.attempt_count, attempts + int(acquired))
            if attempts == 3:
                self.assertEqual(result.status, "failed")

    def test_failed_extraction_retry_preserves_safe_error_and_then_completes(self):
        row = self.message("지속적인 AI 개발 목표")
        with patch.object(extraction, "extract_memory_with_openai", side_effect=RuntimeError(SECRET)):
            failed = extraction.extract_memory_for_message(row.id, self.a.id)
        self.assertEqual(failed.status, "failed")
        self.assertNotIn(FAKE_PASSWORD, failed.error_message)
        result, calls = self.run_extraction(row)
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.attempt_count, 2)
        self.assertEqual(calls, 1)

    def test_extraction_role_and_ownership_gate_precede_privacy(self):
        """private라는 이유로 다른 사용자 접근/assistant 자동 추출을 허용하지 않습니다."""
        with self.assertRaises(extraction.MemoryExtractionAccessError):
            extraction.extract_memory_for_message(self.ma.id, self.b.id)
        row = Message(conversation_id=self.ca.id, user_id=None, role="assistant", content=SECRET)
        self.db.add(row)
        self.db.commit()
        with self.assertRaises(extraction.MemoryExtractionRoleError):
            extraction.extract_memory_for_message(row.id, self.a.id)


if __name__ == "__main__":
    unittest.main()
