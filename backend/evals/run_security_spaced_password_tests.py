"""띄어 쓴 비밀번호 회귀 검사입니다. 합성 SQLite와 SDK mock만 사용합니다."""

import json
import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

from evals import run_security_memory_privacy_tests as fixture
import memory_extraction_service as extraction
import memory_extractor as extractor
import memory_retriever as retrieval
from memory_privacy import (
    PRIVACY_BLOCK_REASON,
    PrivacyClass,
    automatic_memory_allowed,
    classify_memory_text,
    validate_auto_decision,
)
from models.memory import Memory, MemoryEvidence
from models.message import Message


SECRET = "내 비 밀 번 호 는 SYNTHETIC_SPACED_PASSWORD_ONLY"


class SpacedPasswordTests(unittest.TestCase):
    """등록된 ownership fixture를 재사용하며 과거 평가 결과에 의존하지 않습니다."""

    setUp = fixture.MemoryPrivacyTests.setUp
    tearDown = fixture.MemoryPrivacyTests.tearDown
    memory_body = fixture.MemoryPrivacyTests.memory_body
    message = fixture.MemoryPrivacyTests.message
    count = fixture.MemoryPrivacyTests.count
    run_extraction = fixture.MemoryPrivacyTests.run_extraction

    def test_password_label_whitespace_and_assignment_are_blocked(self):
        """라벨 내부 공백과 소유/값 할당 문맥을 함께 검사합니다."""
        for content in (
            SECRET,
            "나의 비 밀번호는 SYNTHETIC_ONLY",
            "사용자의 비밀 번 호 = SYNTHETIC_ONLY",
            "비 밀 번 호: SYNTHETIC_ONLY",
            "비\t밀\n번\t호 = SYNTHETIC_ONLY",
            "내 비밀번호는 SYNTHETIC_ONLY",
        ):
            with self.subTest(content_index=len(content)):
                self.assertEqual(classify_memory_text(content), PrivacyClass.RESTRICTED_SECRET)
                self.assertFalse(automatic_memory_allowed(content))

    def test_general_password_project_without_assignment_is_allowed(self):
        """일반 개발 주제를 차단하거나 문장 전체 공백을 제거하지 않습니다."""
        for content in (
            "비밀번호 관리 기능을 개발하고 싶다",
            "비 밀 번 호 관리 기능을 개발하고 싶다",
            "나는 AI 프로젝트를 완성하고 싶다",
        ):
            self.assertTrue(automatic_memory_allowed(content))

    def test_extractor_blocks_before_sdk_constructor_and_does_not_log_source(self):
        """실제 extractor 진입점에서 외부 요청 이전 차단을 확인합니다."""
        client = Mock()
        client.responses.create.return_value = SimpleNamespace(output_text=json.dumps(
            fixture.decision("", should_remember=False, reason="synthetic", importance=0, confidence=0).model_dump()))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), \
                patch.object(extractor, "OpenAI", return_value=client) as sdk, redirect_stdout(StringIO()) as logs:
            result = extractor.extract_memory_with_openai(SECRET)
        sdk.assert_not_called()
        self.assertFalse(result.should_remember)
        self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)
        self.assertNotIn("SYNTHETIC_SPACED_PASSWORD_ONLY", logs.getvalue())

    def test_service_and_cached_retry_preserve_source_without_memory(self):
        """원문은 유지하되 추출/조정 호출 및 Memory/Evidence 생성은 막습니다."""
        row = self.message(SECRET)
        before = (self.count(Memory), self.count(MemoryEvidence))
        with patch.object(extraction, "extract_memory_with_openai", return_value=fixture.decision()) as sdk, \
                patch.object(extraction, "reconcile_memory_candidate") as reconcile, \
                redirect_stdout(StringIO()) as logs:
            result = extraction.extract_memory_for_message(row.id, self.a.id)
            again = extraction.extract_memory_for_message(row.id, self.a.id)
        sdk.assert_not_called()
        reconcile.assert_not_called()
        self.assertEqual(result.status, "completed")
        self.assertFalse(result.should_remember)
        self.assertIsNone(result.memory_id)
        self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)
        self.assertEqual((again.id, again.attempt_count), (result.id, 1))
        self.assertEqual((self.count(Memory), self.count(MemoryEvidence)), before)
        self.assertEqual(self.db.get(Message, row.id).content, SECRET)
        self.assertNotIn("SYNTHETIC_SPACED_PASSWORD_ONLY", logs.getvalue())

    def test_generated_content_and_reason_cannot_bypass_privacy(self):
        """モデルが返した記憶本文/理由にも同じ検査を適用します."""
        for decision in (fixture.decision(SECRET), fixture.decision(reason=SECRET)):
            result = validate_auto_decision(decision)
            self.assertFalse(result.should_remember)
            self.assertEqual(result.content, "")
            self.assertEqual(result.reason, PRIVACY_BLOCK_REASON)

    def test_existing_private_memory_is_filtered_without_deletion(self):
        """既存データの削除ではなく自動検索候補からの除外だけを確認します."""
        row = Memory(user_id=self.a.id, content=SECRET, kind="other", importance=100)
        self.db.add(row)
        self.db.commit()
        before = self.count(Memory)
        candidates = retrieval.fetch_memory_candidates(self.a.id)
        self.assertNotIn(row.id, {item.memory_id for item in candidates})
        self.assertIn(self.memory.id, {item.memory_id for item in candidates})
        self.assertEqual(self.count(Memory), before)
        self.assertEqual(self.db.get(Memory, row.id).content, SECRET)

    def test_private_source_does_not_bypass_ownership_or_role(self):
        """비밀 차단 완료를 이용해 다른 계정/assistant 접근을 허용하지 않습니다."""
        row = self.message(SECRET)
        with self.assertRaises(extraction.MemoryExtractionAccessError):
            extraction.extract_memory_for_message(row.id, self.b.id)
        assistant = Message(conversation_id=self.ca.id, user_id=None, role="assistant", content=SECRET)
        self.db.add(assistant)
        self.db.commit()
        with self.assertRaises(extraction.MemoryExtractionRoleError):
            extraction.extract_memory_for_message(assistant.id, self.a.id)

    def test_standard_extractor_keeps_original_sdk_payload(self):
        """양성 대조군으로 정상 추출 호출과 원문 전달 계약을 보존합니다."""
        content = "나는 AI 프로젝트를 완성하고 싶다"
        client = Mock()
        client.responses.create.return_value = SimpleNamespace(
            output_text=json.dumps(fixture.decision(content).model_dump()))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-key"}), \
                patch.object(extractor, "OpenAI", return_value=client):
            result = extractor.extract_memory_with_openai(content)
        self.assertTrue(result.should_remember)
        client.responses.create.assert_called_once()
        self.assertEqual(client.responses.create.call_args.kwargs["input"][1]["content"], content)


if __name__ == "__main__":
    unittest.main()
