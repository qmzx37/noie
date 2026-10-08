"""G2: clean HEAD의 실제 /chat, 원문 저장, 네 Specialist를 합성 DB/SDK로 검사합니다."""

from contextlib import ExitStack, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from evals.run_security_adversarial_verification import isolate
    isolate(legacy_fixtures=True)
if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Use the isolated runner; live resources are forbidden")

from sqlalchemy import select
from sqlalchemy.orm import Session

import main
import chat_persistence_service as persistence
import lv4_production_service as production
import memory_retriever
from account_lifecycle_service import deactivate_account, purge_deleted_account
from agent.lv4 import behavior_adapter
from auth_context import AuthPrincipal
from evals import run_security_account_deletion_tests as deletion_fixture
from models.chat_request import ChatRequestRecord
from models.memory import Memory, MemoryEvidence
from models.message import Message
from schemas import ChatRequest, ChatResponse
from resource_budget import budgeted_client


QUESTION = "지금 운동할까 개발할까?"
CHOICE = "개발부터 10분 해보세요."
LEGACY = "기존 Lv3 답변\n\n기존 Lv3 추천"


class ChatEntrypointClosureTests(unittest.TestCase):
    """미등록 eval fixture 없이 committed 삭제 fixture의 합성 SQLite만 재사용합니다."""

    def setUp(self):
        """두 계정/Memory를 분리하고 실제 begin/complete/Behavior 조회 함수를 사용합니다."""
        self.fixture = deletion_fixture.AccountDeletionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.fixture.memory.content = "OWN_MEMORY_A 개발 목표"
        other = Memory(user_id=self.fixture.bid, content="OTHER_MEMORY_B 개발 목표", kind="goal")
        self.fixture.db.add(other)
        self.fixture.db.flush()
        self.fixture.db.add(MemoryEvidence(memory_id=other.id, message_id=self.fixture.mb.id))
        self.fixture.db.commit()
        self.sessions = []
        self.requests = []
        self.payloads = []
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {
            "NOIE_LV4_PRODUCTION_ENABLED": "true", "NOIE_LV4_SHADOW_ENABLED": "false",
            "NOIE_CHAT_BG_PROBE_ENABLED": "false", "OPENAI_API_KEY": "SYNTHETIC_SDK_KEY",
        }))
        for target in ("database.SessionLocal", "chat_persistence_service.SessionLocal",
                       "memory_retriever.SessionLocal", "agent.lv4.behavior_adapter.SessionLocal"):
            self.stack.enter_context(patch(target, self._session))
        # 후보 소유권/threshold는 실제 service가 검사하고 관련성 모델만 합성 선택으로 바꿉니다.
        self.stack.enter_context(patch.object(memory_retriever, "select_relevant_memories",
            side_effect=lambda query, candidates: [{"memory_id": str(c.memory_id), "relevance": .9,
                                                   "reason": "현재 개발 선택 관련"} for c in candidates]))
        view = {"primary_axis": {"like": "Mid", "dislike": "Low"},
                "emotion_axis": {axis: "Low" for axis in "FADJCGTR"}, "state_summary": "합성 상태 요약"}
        analysis = {"input": QUESTION, "user_view": view, "admin_view": {
            "primary_axis": {"like": .4, "dislike": .1},
            "emotion_axis": {axis: .1 for axis in "FADJCGTR"}}, "source": "rule_based"}
        self.stack.enter_context(patch.object(main, "analyze_text", return_value=(analysis, "rule_based")))
        self.stack.enter_context(patch.object(main, "generate_chat_reply_with_openai", return_value="기존 Lv3 답변"))
        self.stack.enter_context(patch.object(main, "generate_project_chat_reply_with_checkpoint_openai",
                                             return_value={"reply": "기존 project 답변", "checkpoint_draft": None}))
        self.stack.enter_context(patch.object(main, "prepare_chat_recommendation", return_value=(None, "기존 Lv3 추천")))
        self.memory_task = self.stack.enter_context(patch.object(main, "run_memory_extraction_background"))
        self.agent_task = self.stack.enter_context(patch.object(main, "run_chat_agent_integration"))
        self.shadow = self.stack.enter_context(patch.object(main, "schedule_shadow"))
        self.complete = self.stack.enter_context(patch.object(main, "complete_chat_request",
                                                               wraps=persistence.complete_chat_request))
        self.failed = self.stack.enter_context(patch.object(main, "mark_chat_request_failed",
                                                             wraps=persistence.mark_chat_request_failed))
        self.bridge = self.stack.enter_context(patch.object(production, "_make_bridge", wraps=production._make_bridge))
        self.behavior = self.stack.enter_context(patch.object(production, "read_behavior", wraps=behavior_adapter.read_behavior))
        self.sdk = SimpleNamespace(responses=SimpleNamespace(create=Mock(side_effect=self._respond)), close=Mock())
        self.stack.enter_context(patch("agent.lv4.recommendation_adapter.OpenAI", return_value=self.sdk))

    def _session(self):
        """SQLite에 없는 READ ONLY 선언만 대체하고 나머지 ORM 조회/쓰기/commit은 실제 실행합니다."""
        class LocalSession(Session):
            def execute(self, statement, *args, **kwargs):
                """SQL dialect 차이만 제거하며 모델/서비스의 소유권 조건은 바꾸지 않습니다."""
                if str(statement).strip() == "SET TRANSACTION READ ONLY":
                    return None
                return super().execute(statement, *args, **kwargs)
        db = LocalSession(self.fixture.engine, expire_on_commit=False)
        self.sessions.append(db)
        return db

    def _respond(self, **kwargs):
        """실제 adapter의 최소 payload와 Structured Output 경계만 대역으로 처리합니다."""
        self.assertTrue(all(not db.in_transaction() for db in self.sessions))
        self.payloads.append(json.loads(kwargs["input"][1]["content"]))
        refs = kwargs["text"]["format"]["schema"]["properties"]["used_evidence_refs"]["items"]["enum"]
        return SimpleNamespace(status="completed", output_text=json.dumps({
            "needs_action": True, "actions": [{"type": "recommendation", "intent": "suggest_recommendation",
                "mode": "suggest", "reason": "현재 선택 질문", "confidence": .7,
                "requires_confirmation": False, "execution_order": 1,
                "arguments": {"primary_action": CHOICE, "rationale": "현재 개발 선택을 위한 후보입니다.",
                              "confidence": .7, "recommendation_kind": "direct"}}],
            "used_evidence_refs": refs[:12], "needs_user_input": False, "input_question": None,
        }, ensure_ascii=False))

    def send(self, text=QUESTION, *, request_id=None, **fields):
        """실제 ASGI 응답/serialization/background를 실행하며 로그는 검사 목적으로만 수집합니다."""
        request_id = request_id or uuid4()
        self.requests.append(request_id)
        with redirect_stdout(StringIO()) as logs:
            response = self.fixture.client.post("/chat", json={"text": text, "request_id": str(request_id), **fields})
        self.logs = logs.getvalue()
        return response

    def assert_saved_reply(self, response, source):
        """HTTP, 실제 assistant 행, cached 응답에 동일한 최종 원문이 저장되는지 확인합니다."""
        self.assertEqual(response.status_code, 200)
        body = response.json()
        ChatResponse.model_validate(body)
        with self._session() as db:
            record = db.get(ChatRequestRecord, self.requests[-1])
            self.assertEqual(record.status, "completed")
            assistant = db.get(Message, record.assistant_message_id)
            self.assertEqual(assistant.content, body["reply"])
            self.assertEqual(record.response["reply"], body["reply"])
            self.assertIsNone(assistant.user_id)
            self.assertEqual(assistant.metadata_["source"], source)
            self.assertEqual(record.conversation_id, self.complete.call_args.args[0].conversation_id)
        return body

    def test_flag_off_keeps_lv3_and_skips_context_sdk(self):
        """기본 OFF/오타에는 Lv4 개인 조회나 모델 호출 없이 기존 답변을 저장합니다."""
        for flag in ("false", "", "true!"):
            with self.subTest(flag=flag), patch.dict(os.environ, {"NOIE_LV4_PRODUCTION_ENABLED": flag}):
                body = self.assert_saved_reply(self.send(), "openai")
                self.assertEqual(body["reply"], LEGACY)
        self.bridge.assert_not_called()
        self.behavior.assert_not_called()
        self.sdk.responses.create.assert_not_called()

    def test_lv4_success_is_http_and_database_final_reply(self):
        """네 Specialist/adapter가 완료한 Lv4 답변만 최종 HTTP/DB source로 사용합니다."""
        body = self.assert_saved_reply(self.send(), "lv4")
        self.assertIn(CHOICE, body["reply"])
        self.assertNotIn("기존 Lv3", body["reply"])
        self.sdk.responses.create.assert_called_once()
        self.assertEqual(body["source"], "rule_based")

    def test_unexpected_entrypoint_exception_keeps_lv3(self):
        """선택적 service 진입 자체가 실패해도 기존 응답/저장은 유지하며 예외 원문을 숨깁니다."""
        with patch.object(main, "try_lv4_production_reply", side_effect=RuntimeError("PRIVATE_ERROR_SENTINEL")):
            body = self.assert_saved_reply(self.send(), "openai")
        self.assertEqual(body["reply"], LEGACY)
        self.assertNotIn("PRIVATE_ERROR_SENTINEL", self.logs)

    def test_pipeline_exception_keeps_lv3(self):
        """기존 service의 내부 장애 fallback 계약도 실제 HTTP 경로에서 유지합니다."""
        with patch.object(production, "_run_pipeline", side_effect=RuntimeError("PRIVATE_ERROR_SENTINEL")):
            self.assertEqual(self.assert_saved_reply(self.send(), "openai")["reply"], LEGACY)

    def test_none_and_unsupported_results_keep_lv3(self):
        """없거나 불완전한 pipeline 결과는 성공 reply로 저장하지 않습니다."""
        for result in (None, {}, {"pipeline_status": "COMPLETED"}):
            with self.subTest(result=result), patch.object(production, "_run_pipeline", return_value=result):
                self.assertEqual(self.assert_saved_reply(self.send(), "openai")["reply"], LEGACY)

    def test_non_recommendation_does_not_run_lv4(self):
        """명확한 보고/완료된 결정에는 Lv4 gate 뒤의 조회와 SDK가 실행되지 않습니다."""
        for text in ("오늘 기분 좋아.", "광안리 다녀왔어.", "오늘은 집에서 쉬기로 했어."):
            self.assertEqual(self.assert_saved_reply(self.send(text), "openai")["reply"], LEGACY)
        self.bridge.assert_not_called()
        self.behavior.assert_not_called()
        self.sdk.responses.create.assert_not_called()

    def test_project_is_excluded_from_lv4_entrypoint(self):
        """project/checkpoint 계약은 새 production 후보로 대체하지 않습니다."""
        with patch.object(main, "try_lv4_production_reply") as entrypoint:
            body = self.assert_saved_reply(self.send(is_project=True), "project")
        self.assertEqual(body["reply"], "기존 project 답변\n\n기존 Lv3 추천")
        entrypoint.assert_not_called()

    def test_behavior_reaches_state_and_recommendation_sdk(self):
        """실제 저장 Message의 Behavior가 State를 거쳐 SDK 최소 필드로 전달됩니다."""
        body = self.assert_saved_reply(self.send(), "lv4")
        self.assertIn(CHOICE, body["reply"])
        payload = self.payloads[0]
        self.assertEqual([b["action"] for b in payload["behavior_observations"]], ["운동", "개발"])
        self.assertTrue(all(b["status"] == "candidate" for b in payload["behavior_observations"]))
        self.assertIsNotNone(payload["state_opinion"])
        self.assertTrue(all(set(b) <= {"ref", "action", "status", "confidence", "observed_at"}
                            for b in payload["behavior_observations"]))
        encoded = json.dumps(payload)
        context = self.complete.call_args.args[0]
        for identity in (context.user_id, context.user_message_id, context.conversation_id, context.request_id):
            self.assertNotIn(str(identity), encoded)

    def test_two_accounts_keep_memory_behavior_and_saves_separate(self):
        """실제 retrieval/저장이 선택된 계정 밖의 Message/Memory를 재사용하지 않습니다."""
        self.assert_saved_reply(self.send(), "lv4")
        self.fixture.principal = AuthPrincipal(self.fixture.bid)
        self.assert_saved_reply(self.send(), "lv4")
        first, second = (json.dumps(p) for p in self.payloads)
        self.assertIn("OWN_MEMORY_A", first)
        self.assertNotIn("OTHER_MEMORY_B", first)
        self.assertIn("OTHER_MEMORY_B", second)
        self.assertNotIn("OWN_MEMORY_A", second)
        self.assertEqual(self.complete.call_args.args[0].user_id, self.fixture.bid)
        self.assertEqual(self.behavior.call_args.kwargs["user_id"], self.fixture.bid)

    def test_inactive_owner_is_rejected_before_new_path(self):
        """begin의 기존 소유권 검증을 우회해 Lv4에서 개발 계정을 다시 선택하지 않습니다."""
        deactivate_account(self.fixture.db, self.fixture.principal)
        self.assertEqual(self.send().status_code, 403)
        self.bridge.assert_not_called()
        self.sdk.responses.create.assert_not_called()
        self.complete.assert_not_called()

    def test_owner_deactivated_after_user_commit_blocks_lv4(self):
        """사용자 원문 commit 후 삭제 상태가 바뀌어도 새 모델 전송/assistant 저장은 차단합니다."""
        def after_legacy(**kwargs):
            deactivate_account(self.fixture.db, self.fixture.principal)
            return "기존 Lv3 답변"
        with patch.object(main, "generate_chat_reply_with_openai", side_effect=after_legacy):
            response = self.send()
        self.assertEqual(response.status_code, 403)
        self.sdk.responses.create.assert_not_called()
        self.complete.assert_not_called()
        self.failed.assert_called_once()
        with self._session() as db:
            record = db.get(ChatRequestRecord, self.requests[-1])
            self.assertEqual(record.status, "failed")
            self.assertEqual(db.get(Message, record.user_message_id).content, QUESTION)
            self.assertIsNone(record.assistant_message_id)

    def test_purged_owner_is_rejected_before_new_path(self):
        """계정이 실제 합성 DB에서 제거된 경우에도 개발 사용자 fallback 없이 거부합니다."""
        deactivate_account(self.fixture.db, self.fixture.principal)
        self.assertEqual(purge_deleted_account(self.fixture.db, self.fixture.aid), "purged")
        self.assertEqual(self.send().status_code, 403)
        self.sdk.responses.create.assert_not_called()
        self.complete.assert_not_called()

    def test_access_denial_is_not_an_ordinary_lv3_fallback(self):
        """권한 거부를 일반 장애로 삼켜 이전 private reply를 반환하지 않습니다."""
        from private_model_access import PrivateModelAccessDenied
        with patch.object(main, "try_lv4_production_reply", side_effect=PrivateModelAccessDenied):
            response = self.send()
        self.assertEqual(response.status_code, 403)
        self.complete.assert_not_called()
        self.failed.assert_called_once()
        self.sdk.responses.create.assert_not_called()

    def test_deactivation_at_sdk_boundary_blocks_transmission(self):
        """현재 Behavior/Memory payload 준비 후 비활성화되어도 SDK 직전 검사가 전송을 막습니다."""
        def prepared(client):
            deactivate_account(self.fixture.db, self.fixture.principal)
            return budgeted_client(client)
        with patch("agent.lv4.recommendation_adapter.budgeted_client", side_effect=prepared):
            response = self.send()
        self.assertEqual(response.status_code, 403)
        self.sdk.responses.create.assert_not_called()
        self.complete.assert_not_called()
        self.failed.assert_called_once()

    def test_cached_duplicate_reuses_reply_without_sdk_or_background(self):
        """DB에 완료된 동일 request_id는 기존 Lv4 결과를 그대로 재사용합니다."""
        request_id = uuid4()
        first = self.assert_saved_reply(self.send(request_id=request_id), "lv4")
        second = self.send(request_id=request_id).json()
        self.assertEqual(first, second)
        self.sdk.responses.create.assert_called_once()
        self.complete.assert_called_once()
        self.memory_task.assert_called_once()
        self.agent_task.assert_called_once()

    def test_new_request_same_text_is_not_deduplicated(self):
        """같은 문장도 새 request UUID라면 독립적인 user/assistant 원문으로 저장됩니다."""
        self.assert_saved_reply(self.send(), "lv4")
        self.assert_saved_reply(self.send(), "lv4")
        self.assertEqual(self.sdk.responses.create.call_count, 2)
        with self._session() as db:
            records = list(db.scalars(select(ChatRequestRecord)))
            self.assertEqual(len(records), 2)
            self.assertEqual(len({r.user_message_id for r in records}), 2)
            self.assertEqual(len({r.assistant_message_id for r in records}), 2)

    def test_original_text_schema_and_background_order_preserved(self):
        """원문 trim/응답 구조/후속 task 순서는 기존 계약 그대로입니다."""
        trace = []
        self.memory_task.side_effect = lambda *a: trace.append("memory")
        self.agent_task.side_effect = lambda *a: trace.append("agent")
        raw = "  " + QUESTION + "  \n"
        body = self.assert_saved_reply(self.send(raw), "lv4")
        self.assertEqual(set(body), set(ChatResponse.model_fields))
        self.assertNotIn("user_id", ChatRequest.model_fields)
        self.assertEqual(trace, ["memory", "agent"])
        with self._session() as db:
            record = db.get(ChatRequestRecord, self.requests[-1])
            self.assertEqual(db.get(Message, record.user_message_id).content, raw)

    def test_logs_and_http_reply_do_not_expose_private_internals(self):
        """관측 로그와 사용자 답변에는 내부 UUID/근거/credential을 추가하지 않습니다."""
        body = self.assert_saved_reply(self.send(), "lv4")
        context = self.complete.call_args.args[0]
        for private in (QUESTION, "OWN_MEMORY_A", "OTHER_MEMORY_B", "SYNTHETIC_SDK_KEY",
                        str(context.user_id), str(context.user_message_id), str(context.request_id)):
            self.assertNotIn(private, self.logs + body["reply"])


if __name__ == "__main__":
    unittest.main()
