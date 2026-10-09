"""P1-2: 합성 SQLite와 Mock SDK로 Memory의 실제 전송 객체 전체를 검사합니다."""

import contextlib
import io
import json
import logging
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Run with the isolated security verifier")

import memory_extraction_service as extraction
import memory_extractor as extractor
import memory_privacy as privacy
import memory_reconciler as reconciler
import memory_retriever as retrieval
from evals import run_security_memory_privacy_tests as fixture
from memory_schemas import MemoryRetrievalCandidate
from models.memory import Memory, MemoryEvidence
from models.message import Message


SECRET = "password=SYNTHETIC_P12_ONLY"
HEALTH = "나는 당뇨가 있다"
THIRD = "친구가 암 진단받았어"


class MemoryTransmissionPrivacyTests(unittest.TestCase):
    """완료된 소유권/privacy fixture를 재사용하고 실제 DB/SDK 연결은 대체합니다."""

    count = fixture.MemoryPrivacyTests.count
    message = fixture.MemoryPrivacyTests.message
    memory_body = fixture.MemoryPrivacyTests.memory_body

    def setUp(self):
        """모든 모델 클라이언트를 mock으로 고정하고 출력도 테스트 안에서만 수집합니다."""
        fixture.MemoryPrivacyTests.setUp(self)
        self.stack.enter_context(patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-not-a-key"}))
        self.first, self.second, self.selector = Mock(), Mock(), Mock()
        self.first.responses.create.return_value = SimpleNamespace(
            output_text=json.dumps(fixture.decision().model_dump()))
        self.second.responses.create.return_value = SimpleNamespace(output_text=json.dumps(
            {"action": "new", "matched_memory_id": "", "reason": "synthetic new goal", "confidence": .9}))
        self.selector.responses.create.return_value = SimpleNamespace(output_text='{"selected_memories": []}')
        for module, client in ((extractor, self.first), (reconciler, self.second), (retrieval, self.selector)):
            self.stack.enter_context(patch.object(module, "OpenAI", return_value=client))
        self.logs = io.StringIO()
        self.stack.enter_context(contextlib.redirect_stdout(self.logs))
        self.stack.enter_context(contextlib.redirect_stderr(self.logs))
        handler = logging.StreamHandler(self.logs)
        logging.getLogger().addHandler(handler)
        self.stack.callback(logging.getLogger().removeHandler, handler)

    def tearDown(self):
        """patch와 합성 DB만 정리하고 저장소 파일은 변경하지 않습니다."""
        fixture.MemoryPrivacyTests.tearDown(self)

    def allowed(self, payload):
        """공통 검사가 아직 없던 HEAD에서도 테스트 누락을 명확한 FAIL로 기록합니다."""
        helper = getattr(privacy, "automatic_memory_payload_allowed", None)
        self.assertTrue(callable(helper), "Missing whole-payload privacy gate")
        return helper(payload)

    def candidate(self, **updates):
        """일반적인 모델 후보에서 원하는 필드 하나만 합성 공격 값으로 바꿉니다."""
        base = MemoryRetrievalCandidate(memory_id=uuid4(), content="synthetic development goal",
                                        kind="goal", importance=60, confidence=.9)
        return base.model_copy(update=updates)

    def legacy(self, kind=SECRET):
        """이미 저장된 legacy 행을 재현하며 내용이나 기존 사용자 행을 수정하지 않습니다."""
        row = Memory(user_id=self.a.id, content="synthetic legacy goal", kind=kind, importance=90)
        self.db.add(row)
        self.db.flush()
        self.db.add(MemoryEvidence(memory_id=row.id, message_id=self.ma.id))
        self.db.commit()
        return row

    def assert_payload_excludes(self, client, *values):
        """사용자 입력뿐 아니라 동적 ID schema를 포함한 SDK 인자 전체를 확인합니다."""
        self.assertEqual(client.responses.create.call_count, 1)
        payload = json.dumps(client.responses.create.call_args.kwargs, ensure_ascii=False)
        for value in values:
            self.assertNotIn(value, payload + self.logs.getvalue())

    def test_v201_legacy_kind_not_sent_to_selector(self):
        """실제 preview 경로에서 content가 정상이어도 secret kind와 ID는 전송하지 않습니다."""
        row = self.legacy()
        before = self.count(Memory)
        response = self.client.post("/memory-retrieval/preview",
                                    json={"user_id": str(self.a.id), "query": "development goal"})
        self.assertEqual(response.status_code, 200)
        self.assert_payload_excludes(self.selector, SECRET, str(row.id))
        self.assertNotIn(SECRET, response.text)
        self.assertEqual(self.count(Memory), before)
        self.assertEqual(self.db.get(Memory, row.id).kind, SECRET)

    def test_v202_legacy_kind_not_sent_to_reconciler(self):
        """실제 추출/조정 경로에서 기존 Memory의 kind가 외부 전송을 우회하지 못합니다."""
        row = self.legacy()
        message = self.message("synthetic lasting development goal")
        response = self.client.post(f"/messages/{message.id}/extract-memory", json={"user_id": str(self.a.id)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assert_payload_excludes(self.second, SECRET, str(row.id), self.mb.content)
        self.assertEqual(self.first.responses.create.call_count, 1)
        self.assertEqual(self.db.get(Message, message.id).content, message.content)
        self.assertEqual(self.db.get(Memory, row.id).kind, SECRET)

    def test_selector_checks_content_kind_and_extension_fields(self):
        """후보가 향후 보조 필드를 추가하더라도 model_dump 전체를 검사합니다."""
        class ExtendedCandidate(MemoryRetrievalCandidate):
            note: dict
        safe = self.candidate()
        for value in (SECRET, HEALTH, THIRD):
            for field in ("content", "kind"):
                with self.subTest(field=field, category=value == SECRET):
                    self.selector.reset_mock()
                    bad = self.candidate(**{field: value})
                    retrieval.select_relevant_memories("development goal", [safe, bad])
                    self.assert_payload_excludes(self.selector, value, str(bad.memory_id))
            self.selector.reset_mock()
            bad = ExtendedCandidate(**self.candidate().model_dump(), note={"summary": [value]})
            retrieval.select_relevant_memories("development goal", [safe, bad])
            self.assert_payload_excludes(self.selector, value, str(bad.memory_id))

    def test_reconciler_checks_all_existing_text_and_keys(self):
        """content/kind 외 실제 전송되는 reason, 보조 값과 동적 key도 검사합니다."""
        safe = {"id": str(uuid4()), "content": "synthetic goal"}
        for value in (SECRET, HEALTH, THIRD):
            for field in ("content", "kind", "reason", "summary"):
                self.second.reset_mock()
                bad = {"id": str(uuid4()), "content": "synthetic legacy", field: value}
                reconciler.reconcile_memory_candidate(fixture.decision(), [safe, bad])
                self.assert_payload_excludes(self.second, value, bad["id"])
        self.second.reset_mock()
        bad = {"id": str(uuid4()), "content": "synthetic legacy", SECRET: "ordinary"}
        reconciler.reconcile_memory_candidate(fixture.decision(), [safe, bad])
        self.assert_payload_excludes(self.second, SECRET, bad["id"])

    def test_reconciler_checks_nested_existing_fields(self):
        """모델에 전달되는 보조 객체의 중첩 배열도 같은 정책을 적용합니다."""
        safe = {"id": str(uuid4()), "content": "synthetic goal"}
        bad = {"id": str(uuid4()), "content": "synthetic legacy", "note": [{"summary": THIRD}]}
        reconciler.reconcile_memory_candidate(fixture.decision(), [safe, bad])
        self.assert_payload_excludes(self.second, THIRD, bad["id"])

    def test_reconciler_rejects_unsafe_new_candidate_fields(self):
        """mock/내부 호출도 신규 후보의 content/reason/kind 검사를 우회하지 못합니다."""
        for field in ("content", "reason", "kind"):
            for value in (SECRET, HEALTH, THIRD):
                with self.subTest(field=field, secret=value == SECRET):
                    self.second.reset_mock()
                    bad = fixture.decision().model_copy(update={field: value})
                    with self.assertRaises(ValueError):
                        reconciler.reconcile_memory_candidate(bad, [{"id": str(uuid4()), "content": "goal"}])
                    self.second.responses.create.assert_not_called()

    def test_unserializable_or_nonfinite_legacy_fields_not_sent(self):
        """모르는 객체나 JSON 숫자가 아닌 값은 문자열로 강제 변환해 전송하지 않습니다."""
        safe = {"id": str(uuid4()), "content": "synthetic goal"}
        for value in (object(), float("nan"), float("inf")):
            self.second.reset_mock()
            bad = {"id": str(uuid4()), "content": "synthetic legacy", "note": value}
            reconciler.reconcile_memory_candidate(fixture.decision(), [safe, bad])
            self.assert_payload_excludes(self.second, bad["id"])

    def test_secret_identifier_not_put_in_dynamic_schema(self):
        """직접 전달한 ID 문자열도 content만 검사한 뒤 schema로 복제하지 않습니다."""
        reconciler.reconcile_memory_candidate(fixture.decision(), [{"id": SECRET, "content": "synthetic goal"}])
        self.second.responses.create.assert_not_called()

    def test_payload_gate_accepts_standard_json_without_mutation(self):
        """정상 값, null, 숫자, 중첩 객체를 그대로 유지하며 검사만 합니다."""
        payload = {"content": "password management project", "kind": "project", "confidence": .9,
                   "importance": 50, "active": True, "note": [None, {"summary": "development goal"}]}
        before = json.dumps(payload)
        self.assertTrue(self.allowed(payload))
        self.assertEqual(json.dumps(payload), before)

    def test_payload_gate_rejects_secret_keys_and_split_credentials(self):
        """라벨과 값이 JSON key/value로 나뉘어도 할당 문맥을 검사합니다."""
        for payload in ({SECRET: "ordinary"}, {"password": "SYNTHETIC_P12_ONLY"},
                        {"access_token": "SYNTHETIC_P12_ONLY"}, {"note": [{"reason": THIRD}]}):
            self.assertFalse(self.allowed(payload))

    def test_payload_gate_rejects_invalid_types_and_nonfinite_numbers(self):
        """JSON으로 검증할 수 없는 입력은 허용으로 추측하지 않습니다."""
        for payload in (object(), {1: "ordinary"}, {"note": {"bad"}},
                        float("nan"), float("inf"), float("-inf")):
            self.assertFalse(self.allowed(payload))

    def test_payload_gate_rejects_cycles_and_excessive_depth(self):
        """순환/과도한 중첩은 검사를 중단하고 전송 불가로 처리합니다."""
        cyclic = []
        cyclic.append(cyclic)
        deep = "ordinary"
        for _ in range(40):
            deep = [deep]
        self.assertFalse(self.allowed(cyclic))
        self.assertFalse(self.allowed(deep))

    def test_detector_failure_is_fail_closed_without_logs(self):
        """탐지기가 예외를 내도 원문 예외를 출력하거나 검사를 통과시키지 않습니다."""
        with patch.object(privacy, "automatic_memory_allowed", side_effect=RuntimeError(SECRET)):
            self.assertFalse(self.allowed({"content": "ordinary"}))
        self.assertNotIn(SECRET, self.logs.getvalue())

    def test_selector_does_not_call_sdk_when_inspection_fails(self):
        """후보 검사 중 DB 밖의 privacy 오류도 선택 모델 전송을 허용하지 않습니다."""
        with patch.object(privacy, "automatic_memory_allowed", side_effect=RuntimeError(SECRET)):
            self.assertEqual(retrieval.select_relevant_memories("goal", [self.candidate()]), [])
        self.selector.responses.create.assert_not_called()
        self.assertNotIn(SECRET, self.logs.getvalue())

    def test_final_selector_gate_blocks_after_earlier_pass(self):
        """후보 검사 성공 뒤에도 실제 직렬화된 입력에 최종 gate를 적용합니다."""
        with patch.object(retrieval, "automatic_memory_payload_allowed", side_effect=[True, False], create=True):
            with self.assertRaises(ValueError):
                retrieval.select_relevant_memories("goal", [self.candidate()])
        self.selector.responses.create.assert_not_called()

    def test_final_reconciler_gate_blocks_after_earlier_pass(self):
        """기존/신규 후보 검사 후 실제 전송 객체 검사가 거부되면 SDK는 호출하지 않습니다."""
        with patch.object(reconciler, "automatic_memory_payload_allowed", side_effect=[True, True, False], create=True):
            with self.assertRaises(ValueError):
                reconciler.reconcile_memory_candidate(fixture.decision(), [{"id": str(uuid4()), "content": "goal"}])
        self.second.responses.create.assert_not_called()

    def test_selector_transmits_frozen_checked_json(self):
        """클라이언트 생성 후 후보 객체가 바뀌어도 검사한 JSON만 전송합니다."""
        candidate = self.candidate()
        def client(**_kwargs):
            candidate.kind = SECRET
            return self.selector
        with patch.object(retrieval, "OpenAI", side_effect=client):
            retrieval.select_relevant_memories("goal", [candidate])
        self.assert_payload_excludes(self.selector, SECRET)

    def test_reconciler_transmits_frozen_checked_json(self):
        """기존 후보의 참조가 바뀌어도 이미 검사한 입력 문자열을 재생성하지 않습니다."""
        existing = {"id": str(uuid4()), "content": "synthetic goal", "kind": "goal"}
        def client(**_kwargs):
            existing["kind"] = SECRET
            return self.second
        with patch.object(reconciler, "OpenAI", side_effect=client):
            reconciler.reconcile_memory_candidate(fixture.decision(), [existing])
        self.assert_payload_excludes(self.second, SECRET)

    def test_private_extraction_input_has_no_first_sdk_call(self):
        """첫 모델에는 원문 한 건만 전달하며 기존 secret/sensitive prefilter를 보존합니다."""
        for value in (SECRET, HEALTH, THIRD):
            self.assertFalse(extractor.extract_memory_with_openai(value).should_remember)
        self.first.responses.create.assert_not_called()

    def test_unsafe_extractor_output_blocks_followup_and_preserves_message(self):
        """모델 출력도 재검사해 후속 전송/저장 전에 기존 안전한 완료 상태로 전환합니다."""
        before = self.count(Memory)
        message = self.message("synthetic lasting goal")
        for field in ("content", "reason", "kind"):
            output = fixture.decision().model_copy(update={field: SECRET})
            current = self.message(message.content)
            with patch.object(extraction, "extract_memory_with_openai", return_value=output):
                result = extraction.extract_memory_for_message(current.id, self.a.id)
            self.assertEqual((result.status, result.should_remember), ("completed", False))
            self.assertEqual(result.reason, privacy.PRIVACY_BLOCK_REASON)
            self.assertEqual(self.db.get(Message, current.id).content, message.content)
            self.assertNotIn(SECRET, result.reason + self.logs.getvalue())
        self.second.responses.create.assert_not_called()
        self.assertEqual(self.count(Memory), before)

    def test_normal_new_reinforce_supersede_and_duplicate_preserved(self):
        """실제 SDK 파싱/DB 반영과 evidence 보존을 세 행동 모두에서 검사합니다."""
        for action in ("new", "reinforce", "supersede"):
            self.first.reset_mock()
            self.second.reset_mock()
            matched = "" if action == "new" else str(self.memory.id)
            self.second.responses.create.return_value = SimpleNamespace(output_text=json.dumps(
                {"action": action, "matched_memory_id": matched, "reason": "synthetic explicit goal", "confidence": .9}))
            message = self.message("synthetic explicit development goal")
            result = extraction.extract_memory_for_message(message.id, self.a.id)
            duplicate = extraction.extract_memory_for_message(message.id, self.a.id)
            self.assertEqual((result.status, result.reconciliation_action), ("completed", action))
            self.assertEqual(duplicate.id, result.id)
            self.assertEqual((self.first.responses.create.call_count, self.second.responses.create.call_count), (1, 1))
            self.assertEqual(self.db.get(Message, message.id).content, message.content)
        self.db.expire_all()
        self.assertEqual(self.db.get(Memory, self.memory.id).status, "superseded")

    def test_standard_projects_and_selection_limits_preserved(self):
        """일반 프로젝트를 민감 진술과 구분하고 기존 25/4/0.55 계약을 유지합니다."""
        for value in ("password management project", "병원 예약 앱 개발", "정치 뉴스 서비스"):
            self.assertTrue(self.allowed({"content": value, "kind": "project"}))
        candidate = self.candidate()
        self.assertEqual(retrieval.select_relevant_memories("development goal", [candidate]), [])
        self.assertEqual((retrieval.MAX_MEMORY_CANDIDATES, retrieval.MAX_SELECTED_MEMORIES, retrieval.MIN_RELEVANCE), (25, 4, .55))
        self.assertEqual(json.loads(self.selector.responses.create.call_args.kwargs["input"][1]["content"])
                         ["memory_candidates"][0]["kind"], "goal")

    def test_other_account_not_in_selector_or_reconciler(self):
        """동일 사용자 필터를 보존하며 다른 계정의 Memory는 실제 payload에 포함하지 않습니다."""
        foreign = Memory(user_id=self.b.id, content="synthetic other-account goal", kind="goal", importance=100)
        self.db.add(foreign)
        self.db.flush()
        self.db.add(MemoryEvidence(memory_id=foreign.id, message_id=self.mb.id))
        self.db.commit()
        candidates = retrieval.fetch_memory_candidates(self.a.id)
        retrieval.select_relevant_memories("goal", candidates)
        self.assert_payload_excludes(self.selector, foreign.content, str(foreign.id))
        message = self.message("synthetic lasting goal")
        extraction.extract_memory_for_message(message.id, self.a.id)
        self.assert_payload_excludes(self.second, foreign.content, str(foreign.id))


if __name__ == "__main__":
    unittest.main()
