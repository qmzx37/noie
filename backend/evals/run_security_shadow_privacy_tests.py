"""예약 후 권한 상실을 실제 Shadow/adapter와 합성 SQLite로 검사합니다. 외부 통신은 금지합니다."""

import asyncio
from contextlib import ExitStack, contextmanager, redirect_stdout
import hashlib
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
    isolate()
if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Use the isolated security runner; live resources are forbidden")

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from account_lifecycle_service import deactivate_account, purge_deleted_account
import chat_persistence_service as persistence
from chat_persistence_service import ChatPersistenceContext
import lv4_shadow_service as shadow
from models.user import User
from private_model_access import private_model_access_scope, require_private_model_access
from resource_budget import budgeted_client
from agent.lv4 import recommendation_adapter
from evals import run_security_account_deletion_tests as deletion_fixture


class ShadowPrivacyTests(unittest.TestCase):
    """기존 삭제 fixture를 합성으로만 재사용하고 실제 모델 전송 경계의 호출 횟수를 검사합니다."""

    def setUp(self):
        """운영 URL/키 없이 두 계정과 원문/Memory 관계가 있는 메모리 DB를 만듭니다."""
        self.fixture = deletion_fixture.AccountDeletionTests()
        self.fixture.setUp()
        self.sessions = []
        self.text = "PRIVATE_TEXT_SENTINEL 지금 개발할까 쉴까?"
        self.memory_a = "PRIVATE_MEMORY_A 개발 목표"
        self.memory_b = "PRIVATE_MEMORY_B 개발 목표"
        self.sdk = SimpleNamespace(
            responses=SimpleNamespace(create=Mock(side_effect=self._respond)),
            close=Mock(),
        )

    def tearDown(self):
        """합성 fixture만 닫으며 repository 파일이나 실제 사용자 데이터를 변경하지 않습니다."""
        self.fixture.tearDown()

    def _respond(self, **kwargs):
        """실제 adapter가 전달한 인자를 받되 network 없이 올바른 Structured Output을 반환합니다."""
        # 활성 상태 조회와 모든 context 조회 세션이 닫힌 뒤에만 SDK 경계에 도달해야 합니다.
        self.assertTrue(self.sessions)
        self.assertTrue(all(not db.in_transaction() for db in self.sessions))
        return SimpleNamespace(status="completed", output_text=json.dumps({
            "needs_action": False, "actions": [], "used_evidence_refs": ["current"],
            "needs_user_input": False, "input_question": None,
        }))

    def _session(self):
        """PostgreSQL 전용 READ ONLY 선언만 SQLite에 맞추고 실제 SELECT/소유권 검사는 유지합니다."""
        class ReadSession(Session):
            def execute(self, statement, *args, **kwargs):
                """이 테스트에서 Shadow의 쓰기 SQL이 나타나면 성공으로 숨기지 않습니다."""
                sql = str(statement).lstrip()
                if sql == "SET TRANSACTION READ ONLY":
                    return None
                if sql.upper().startswith(("INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER")):
                    raise AssertionError("shadow_write_forbidden")
                return super().execute(statement, *args, **kwargs)

        db = ReadSession(self.fixture.engine, expire_on_commit=False, autoflush=False)
        self.sessions.append(db)
        return db

    @contextmanager
    def _boundaries(self):
        """현재 production의 worker/Bridge/네 Specialist/adapter를 그대로 호출합니다."""
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {
                "NOIE_LV4_SHADOW_ENABLED": "true",
                "OPENAI_API_KEY": "synthetic-private-key",
            }))
            stack.enter_context(patch("database.SessionLocal", self._session))
            stack.enter_context(patch.object(persistence, "SessionLocal", self._session))
            stack.enter_context(patch("openai.OpenAI", return_value=self.sdk))
            output = stack.enter_context(redirect_stdout(StringIO()))
            yield output

    def _schedule(self, *, owner=None, memory=None):
        """실제 allowlist와 snapshot 예약을 거치며 외부 사용자/대화 ID는 받지 않습니다."""
        owner = owner or self.fixture.aid
        conversation = self.fixture.ca if owner == self.fixture.aid else self.fixture.cb
        message = self.fixture.ma if owner == self.fixture.aid else self.fixture.mb
        context = ChatPersistenceContext(owner, conversation.id, uuid4(), message.id)
        tasks = BackgroundTasks()
        with patch.dict(os.environ, {
            "NOIE_LV4_SHADOW_ALLOWLIST": str(owner),
            "NOIE_LV4_SHADOW_REQUEST_ALLOWLIST": str(context.request_id),
        }):
            shadow.schedule_shadow(tasks, context=context, text=self.text,
                memories=[SimpleNamespace(content=memory or self.memory_a, relevance=.95, confidence=.8)])
        self.assertEqual(len(tasks.tasks), 2)
        self.assertEqual(tasks.tasks[0].kwargs["user_id"], owner)
        return tasks, context

    def _logs(self, output):
        """JSON 기록을 읽되 UUID/원문/secret/자유 예외 본문이 있으면 실패합니다."""
        logs = output.getvalue()
        for value in (self.text, self.memory_a, self.memory_b, str(self.fixture.aid),
                      str(self.fixture.bid), "PRIVATE_TEXT_SENTINEL", "PRIVATE_MEMORY_A",
                      "PRIVATE_MEMORY_B", "synthetic-private-key", "PRIVATE_ERROR_SENTINEL"):
            self.assertNotIn(value, logs)
        return [json.loads(line.split("[noie] lv4_shadow ", 1)[1])
                for line in logs.splitlines() if "[noie] lv4_shadow " in line]

    def _assert_blocked(self, output, context):
        """취소는 SDK 호출 0회와 고정된 skip 코드로 확인합니다. PASS 수치만으로 판단하지 않습니다."""
        self.sdk.responses.create.assert_not_called()
        records = self._logs(output)
        self.assertEqual(sum(row["event"] == "skipped" for row in records), 1)
        terminal = next(row for row in records if row["event"] == "skipped")
        self.assertEqual((terminal["status"], terminal["outcome"], terminal["failure_code"]),
                         ("SKIPPED", "SKIPPED", "private_access_denied"))
        self.assertEqual(terminal["correlation"],
                         hashlib.sha256(context.request_id.bytes).hexdigest()[:24])
        self.assertNotIn(str(context.request_id), output.getvalue())
        self.assertFalse(any(row["event"] == "completed" for row in records))

    def test_scheduled_then_deactivated_blocks_sdk_and_captured_memory(self):
        """CASE 1: 이미 capture된 Memory가 있어도 비활성화 commit 후 전송하지 않습니다."""
        with self._boundaries() as output, patch.object(shadow, "_make_bridge", wraps=shadow._make_bridge) as bridge:
            tasks, context = self._schedule()
            self.assertIn(self.memory_a, str(tasks.tasks[0].kwargs["memories"]))
            deactivate_account(self.fixture.db, self.fixture.principal)
            asyncio.run(tasks())
        self._assert_blocked(output, context)
        bridge.assert_not_called()

    def test_scheduled_then_purged_account_blocks_sdk(self):
        """CASE 2: 합성 계정을 실제 purge service로 제거한 뒤에도 snapshot은 전송하지 않습니다."""
        with self._boundaries() as output:
            tasks, context = self._schedule()
            deactivate_account(self.fixture.db, self.fixture.principal)
            self.assertEqual(purge_deleted_account(self.fixture.db, self.fixture.aid), "purged")
            self.assertIsNone(self.fixture.db.get(User, self.fixture.aid))
            asyncio.run(tasks())
        self._assert_blocked(output, context)

    def test_active_account_uses_real_adapter_once(self):
        """CASE 3: 활성 계정은 동일한 실제 SDK 경계까지 한 번 진행하며 snapshot을 사용합니다."""
        with self._boundaries() as output:
            tasks, context = self._schedule()
            asyncio.run(tasks())
        self.sdk.responses.create.assert_called_once()
        payload = json.dumps(self.sdk.responses.create.call_args.kwargs, ensure_ascii=False)
        self.assertIn(self.memory_a, payload)
        self.assertIn(self.text, payload)
        self.assertNotIn(self.memory_b, payload)
        self.assertEqual(next(row for row in self._logs(output) if row["event"] == "completed")["outcome"], "SUCCESS")
        self.assertNotIn(str(context.request_id), output.getvalue())

    def test_parent_private_access_denial_is_not_replaced(self):
        """CASE 4: Shadow의 활성 계정 검사가 상위 권한 거부를 대체하지 못합니다."""
        def deny():
            raise PermissionError("PRIVATE_ERROR_SENTINEL")
        with self._boundaries() as output, private_model_access_scope(deny):
            tasks, context = self._schedule()
            asyncio.run(tasks())
        self._assert_blocked(output, context)
        # worker scope가 종료되면 거부 callback도 다른 요청에 남지 않습니다.
        require_private_model_access()

    def test_account_query_db_failure_is_fail_closed(self):
        """CASE 5: DB 검사 실패도 원문을 전송할 fallback 권한이 아닙니다."""
        with self._boundaries() as output:
            tasks, context = self._schedule()
            with patch.object(persistence, "SessionLocal", side_effect=RuntimeError("PRIVATE_ERROR_SENTINEL")):
                asyncio.run(tasks())
        self._assert_blocked(output, context)

    def test_two_queued_accounts_do_not_share_payload_or_authority(self):
        """CASE 6: A 거부 뒤 B를 실행해도 A snapshot/권한 callback은 B에 섞이지 않습니다."""
        with self._boundaries() as output, patch.object(shadow, "_make_bridge", wraps=shadow._make_bridge) as bridge:
            first, context_a = self._schedule()
            second, context_b = self._schedule(owner=self.fixture.bid, memory=self.memory_b)
            deactivate_account(self.fixture.db, self.fixture.principal)
            combined = BackgroundTasks(first.tasks + second.tasks)
            asyncio.run(combined())
        self.sdk.responses.create.assert_called_once()
        payload = json.dumps(self.sdk.responses.create.call_args.kwargs, ensure_ascii=False)
        self.assertIn(self.memory_b, payload)
        self.assertNotIn(self.memory_a, payload)
        bridge.assert_called_once()
        self.assertEqual(bridge.call_args.args[0], self.fixture.bid)
        records = self._logs(output)
        self.assertEqual([row["event"] for row in records if row["event"] in {"skipped", "completed"}],
                         ["skipped", "completed"])
        for context in (context_a, context_b):
            self.assertNotIn(str(context.request_id), output.getvalue())

    def test_skip_log_contains_only_safe_metadata(self):
        """CASE 7: 고정된 skip metadata만 기록하고 user/Memory/UUID/token/예외 원문은 제외합니다."""
        with self._boundaries() as output:
            tasks, context = self._schedule()
            deactivate_account(self.fixture.db, self.fixture.principal)
            asyncio.run(tasks())
        self._assert_blocked(output, context)
        allowed = {"event", "correlation", "status", "gateway_policy", "executor_policy",
                   "write_policy", "failure_stage", "failure_code", "elapsed_ms", "outcome"}
        terminal = next(row for row in self._logs(output) if row["event"] == "skipped")
        self.assertLessEqual(set(terminal), allowed)

    def test_shadow_off_does_not_load_authorization_or_memory(self):
        """CASE 8 일부: 기존 OFF gate는 계정 조회나 snapshot 접근도 추가하지 않습니다."""
        context = ChatPersistenceContext(self.fixture.aid, self.fixture.ca.id, uuid4(), self.fixture.ma.id)
        with patch.dict(os.environ, {"NOIE_LV4_SHADOW_ENABLED": "false"}), \
                patch.object(shadow, "require_active_chat_user") as check:
            tasks = BackgroundTasks()
            shadow.schedule_shadow(tasks, context=context, text=self.text, memories=object())
        check.assert_not_called()
        self.assertEqual(tasks.tasks, [])

    def test_deactivation_during_context_build_is_rechecked(self):
        """예약/worker 시작 검사 통과 후 Bridge 중 비활성화되어도 SDK 앞에서 차단합니다."""
        original = shadow._make_bridge
        def build(*args):
            bridge = original(*args)
            actual = bridge.build
            def after_context(**kwargs):
                result = actual(**kwargs)
                deactivate_account(self.fixture.db, self.fixture.principal)
                return result
            return SimpleNamespace(build=after_context)
        with self._boundaries() as output, patch.object(shadow, "_make_bridge", side_effect=build):
            tasks, context = self._schedule()
            asyncio.run(tasks())
        self._assert_blocked(output, context)

    def test_deactivation_after_payload_preparation_blocks_sdk(self):
        """실제 adapter가 payload를 준비한 직후 비활성화해 SDK 직전 검사 자체를 검증합니다."""
        def prepared(client):
            deactivate_account(self.fixture.db, self.fixture.principal)
            return budgeted_client(client)
        with self._boundaries() as output, patch.object(recommendation_adapter, "budgeted_client", side_effect=prepared) as facade:
            tasks, context = self._schedule()
            asyncio.run(tasks())
        facade.assert_called_once()
        self._assert_blocked(output, context)
        self.sdk.close.assert_called_once()

    def test_db_error_after_payload_preparation_blocks_sdk(self):
        """후속 DB 검사 장애도 이미 준비한 private payload를 전송하지 않습니다."""
        with self._boundaries() as output, ExitStack() as stack:
            def prepared(client):
                stack.enter_context(patch.object(persistence, "SessionLocal",
                                                side_effect=RuntimeError("PRIVATE_ERROR_SENTINEL")))
                return budgeted_client(client)
            stack.enter_context(patch.object(recommendation_adapter, "budgeted_client", side_effect=prepared))
            tasks, context = self._schedule()
            asyncio.run(tasks())
        self._assert_blocked(output, context)

    def test_logging_failure_does_not_retry_or_send_private_data(self):
        """print 실패가 차단을 취소하거나 뒤 background task 실행을 막지 않습니다."""
        with self._boundaries():
            tasks, _ = self._schedule()
            deactivate_account(self.fixture.db, self.fixture.principal)
            with patch("builtins.print", side_effect=OSError("PRIVATE_ERROR_SENTINEL")):
                asyncio.run(tasks())
        self.sdk.responses.create.assert_not_called()

    def test_invalid_owner_never_uses_dev_user_fallback(self):
        """UUID가 아닌 내부 owner도 개발용 계정으로 바꾸지 않고 fail-closed합니다."""
        with self._boundaries() as output, patch.object(shadow, "_make_bridge") as bridge:
            result = shadow.run_shadow(user_id="invalid-owner", text=self.text,
                memories=({"content": self.memory_a, "relevance": .95},), correlation="opaque")
        self.sdk.responses.create.assert_not_called()
        bridge.assert_not_called()
        self.assertEqual(result["outcome"], "SKIPPED")
        self._logs(output)

    def test_snapshot_provider_rejects_different_owner(self):
        """기존 snapshot provider의 소유자 일치 검사도 유지합니다."""
        with self._boundaries():
            bridge = shadow._make_bridge(self.fixture.aid,
                ({"content": self.memory_a, "relevance": .95},))
            with self.assertRaises(PermissionError):
                bridge._providers.memory(self.fixture.bid, self.text, None)
        self.sdk.responses.create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
