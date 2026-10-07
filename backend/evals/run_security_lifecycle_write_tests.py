"""11.9.1 로컬 합성 검증. SQLite 결과를 PostgreSQL 경합 검증으로 주장하지 않습니다."""

import importlib
import os
import unittest
from contextlib import ExitStack, redirect_stdout
from dataclasses import replace
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4

if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Run with the isolated security adversarial verifier")

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import event, select, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

import account_lifecycle_service as lifecycle
import account_write_guard as guard
import chat_persistence_service as chat
import chat_storage_service as storage
import main
import memory_extraction_service as extraction
import memory_reconciliation_service as reconciliation
import memory_service
from agent import executor_service as executor
from agent.executor_registry import ExecutorContext, ExecutorResult
from agent.record_daily_trace_executor import record_daily_trace_executor
from auth_context import AuthPrincipal
from chat_storage_schemas import MessageCreate
from memory_schemas import MemoryCreate, MemoryExtractionDecision, MemoryReconciliationDecision
from models.agent_action import AgentAction
from models.chat_request import ChatRequestRecord
from models.memory import Memory, MemoryEvidence
from models.memory_extraction import MemoryExtraction
from models.message import Message
from models.user import User
from evals import run_security_account_deletion_tests as fixture


class LifecycleWriteTests(unittest.TestCase):
    """실제 서비스와 FK 활성 DB를 사용하고 외부 생성 결과만 합성으로 제공합니다."""

    count = fixture.AccountDeletionTests.count

    def setUp(self):
        """기존 삭제 fixture를 재사용하되 guard와 deactivation은 mock하지 않습니다."""
        fixture.AccountDeletionTests.setUp(self)
        self.factory = sessionmaker(self.engine, expire_on_commit=False)
        self.stack = ExitStack()
        for module in (chat, extraction, reconciliation, executor):
            self.stack.enter_context(patch.object(module, "SessionLocal", self.factory))
        self.daily = importlib.import_module("agent.record_daily_trace_executor")
        self.stack.enter_context(patch.object(self.daily, "SessionLocal", self.factory))

    def tearDown(self):
        """합성 세션만 정리합니다. 운영 설정/데이터에는 접근하지 않습니다."""
        self.stack.close()
        fixture.AccountDeletionTests.tearDown(self)

    def deactivate(self):
        """실제 Phase A commit을 완료합니다."""
        lifecycle.deactivate_account(self.db, AuthPrincipal(self.aid))

    def snapshot(self):
        """늦은 결과가 추가될 수 있는 테이블의 실제 행 수를 비교합니다."""
        return {name: self.count(name) for name in (
            "users", "conversations", "messages", "memories", "memory_evidence",
            "memory_extractions", "agent_actions", "daily_life_events", "emotion_events",
            "dream_goals", "schedules", "place_events", "body_state_events",
            "cognitive_state_events", "recommendations", "relationship_events",
        )}

    def lease_memory(self):
        """이전 evidence와 다른 새 원문에 실제 lease를 얻습니다."""
        message = Message(user_id=self.aid, conversation_id=self.ca.id, role="user", content="AI 개발 목표")
        self.db.add(message); self.db.commit()
        lease, acquired, owner, _ = extraction._acquire_processing_lease(message.id, self.aid)
        self.assertTrue(acquired)
        self.assertEqual(owner, self.aid)
        return message, lease

    def reconcile(self, message, lease, action):
        """실제 NEW/REINFORCE/SUPERSEDE transaction을 실행합니다."""
        return reconciliation.apply_reconciliation(
            lease.id, self.aid, message.id,
            MemoryExtractionDecision(should_remember=True, content="AI 개발 목표", kind="goal",
                                     reason="합성 근거", confidence=.9, importance=70),
            MemoryReconciliationDecision(action=action, reason="합성 조정", confidence=.9,
                                         matched_memory_id=None if action == "new" else self.memory.id),
            [] if action == "new" else [{"id": str(self.memory.id)}], lease.attempt_count,
        )

    def lease_action(self):
        """Daily Tool의 실제 계획/lease를 합성 데이터로 준비합니다."""
        action = AgentAction(user_id=self.aid, conversation_id=self.ca.id, message_id=self.ma.id,
            action_id=uuid4(), tool_name="record_daily_trace", action_type="record_daily_trace",
            intent="record_daily_trace", mode="record", status="ready", confidence=.9,
            requires_confirmation=False, execution_order=1, idempotency_key=uuid4().hex,
            confirmation_status="not_required", arguments={"summary": "합성 일상", "category": None})
        self.db.add(action); self.db.commit()
        _, lease = executor._acquire_lease(action.action_id, self.aid)
        return action, lease, ExecutorContext(action_id=str(action.action_id), user_id=str(self.aid),
            tool_name="record_daily_trace", attempt_count=lease.attempt_count)

    def test_active_chat_preserves_raw_text_and_duplicate(self):
        raw = "  합성 원문\n그대로  "
        request = uuid4()
        start = chat.begin_chat_request(raw, request, authenticated_user_id=self.aid)
        reply = "  합성 응답\n그대로  "
        self.assertTrue(chat.complete_chat_request(start.context, reply, "fallback", {"reply": reply}, reject_unsafe_response=True))
        self.assertEqual(chat.begin_chat_request(raw, request, authenticated_user_id=self.aid).cached_response, {"reply": reply})
        record = self.db.get(ChatRequestRecord, request)
        self.assertEqual(self.db.get(Message, record.user_message_id).content, raw)
        self.assertEqual(self.db.get(Message, record.assistant_message_id).content, reply)

    def test_active_memory_all_actions_and_duplicate(self):
        for action in ("new", "reinforce", "supersede"):
            with self.subTest(action=action):
                message, lease = self.lease_memory()
                result = self.reconcile(message, lease, action)
                self.assertEqual(result.status, "completed")
                before = self.snapshot()
                self.assertEqual(self.reconcile(message, lease, action).id, result.id)
                self.assertEqual(self.snapshot(), before)

    def test_inactive_memory_new_reinforce_supersede_write_nothing(self):
        message, lease = self.lease_memory()
        self.deactivate()
        before = self.snapshot()
        for action in ("new", "reinforce", "supersede"):
            with self.subTest(action=action), self.assertRaises(reconciliation.MemoryReconciliationValidationError):
                self.reconcile(message, lease, action)
        self.db.expire_all()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.db.get(Memory, self.memory.id).status, "active")
        self.assertEqual(self.db.get(MemoryExtraction, lease.id).status, "processing")

    def test_inactive_no_memory_reason_and_failure_path_do_not_return_payload(self):
        _, lease = self.lease_memory()
        self.deactivate()
        decision = MemoryExtractionDecision(should_remember=False, reason="SYNTHETIC_PRIVATE_REASON",
            content="", kind="other", importance=0, confidence=0)
        with self.assertRaises(extraction.MemoryExtractionNotFoundError):
            extraction._complete_without_memory(lease.id, lease.attempt_count, decision)
        with self.assertRaises(extraction.MemoryExtractionNotFoundError):
            extraction._mark_failed(lease.id, lease.attempt_count, RuntimeError("SYNTHETIC_PRIVATE"))
        self.db.expire_all()
        row = self.db.get(MemoryExtraction, lease.id)
        self.assertIsNone(row.reason)
        self.assertIsNone(row.error_message)

    def test_extraction_external_call_holds_no_user_lock_and_late_return_is_rejected(self):
        opened = []
        def factory():
            session = self.factory()
            opened.append(session)
            return session
        def external(_):
            # 외부 호출 지점에는 guard/lease transaction이 끝나 있어 삭제를 별도 실행할 수 있습니다.
            self.assertTrue(opened)
            self.assertTrue(all(not session.in_transaction() for session in opened))
            self.deactivate()
            return MemoryExtractionDecision(should_remember=False, reason="합성 결과",
                content="", kind="other", importance=0, confidence=0)
        before = self.count("memories")
        with patch.object(extraction, "SessionLocal", factory), \
                patch.object(extraction, "extract_memory_with_openai", side_effect=external), \
                self.assertRaises(extraction.MemoryExtractionNotFoundError):
            extraction.extract_memory_for_message(self.ma.id, self.aid)
        self.assertEqual(self.count("memories"), before)

    def test_active_agent_domain_and_finalize(self):
        _, lease, context = self.lease_action()
        result = record_daily_trace_executor(context)
        action, fenced = executor._finish_success(lease, result)
        self.assertFalse(fenced)
        self.assertEqual(action.status, "completed")
        self.assertEqual(self.count("daily_life_events"), 1)
        self.assertEqual(executor._finish_success(lease, result)[1], True)
        self.assertEqual(self.count("daily_life_events"), 1)

    def test_late_all_nine_domain_writes_rejected_before_action_lock(self):
        _, _, context = self.lease_action()
        self.deactivate()
        before = self.snapshot()
        names = ("record_emotion", "record_daily_trace", "record_dream_goal", "create_schedule",
                 "record_place_event", "record_body_state", "record_cognitive_state",
                 "suggest_recommendation", "record_relationship_event")
        for name in names:
            module = importlib.import_module(f"agent.{name}_executor")
            queries = []
            def capture(conn, cursor, statement, parameters, context, many):
                queries.append(statement)
            event.listen(self.engine, "before_cursor_execute", capture)
            try:
                with self.subTest(tool=name), patch.object(module, "SessionLocal", self.factory), self.assertRaises(Exception):
                    getattr(module, name + "_executor")(context)
            finally:
                event.remove(self.engine, "before_cursor_execute", capture)
            self.assertTrue(any("FROM users" in sql for sql in queries))
            self.assertFalse(any("FROM agent_actions" in sql or "INSERT" in sql for sql in queries))
        self.assertEqual(self.snapshot(), before)

    def test_late_agent_cancels_current_attempt_without_result(self):
        row, lease, _ = self.lease_action()
        self.deactivate()
        before = self.snapshot()
        action, fenced = executor._finish_success(lease, ExecutorResult(outcome="synthetic", data={"private": "result"}))
        self.assertTrue(fenced)
        self.assertEqual(action.status, "failed")
        self.assertIsNone(action.result)
        self.assertEqual(action.error_message, "account_inactive")
        self.assertEqual(self.snapshot(), before)
        with self.assertRaises(executor.ExecutorDatabaseError):
            executor.execute_action(row.action_id, self.aid)

    def test_agent_api_never_returns_late_private_payload(self):
        row, _, _ = self.lease_action()
        # 새 HTTP 실행이 lease를 얻도록 fixture 상태만 ready로 돌립니다.
        self.db.execute(update(AgentAction).where(AgentAction.id == row.id).values(status="ready"))
        self.db.commit()
        def tool(_):
            self.deactivate()
            return ExecutorResult(outcome="synthetic", data={"value": "SYNTHETIC_PRIVATE_RESULT"})
        with patch.object(executor, "get_executor", return_value=tool):
            response = self.client.post(f"/agent/actions/{row.action_id}/execute", json={"user_id": str(self.aid)})
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("SYNTHETIC_PRIVATE", response.text)
        self.db.expire_all()
        saved = self.db.get(AgentAction, row.id)
        self.assertEqual(saved.status, "failed")
        self.assertIsNone(saved.result)

    def test_late_orchestrator_cannot_persist_plan_or_schedule_executor(self):
        import chat_agent_integration_service as integration
        from agent.schemas import OrchestratorAction, OrchestratorResult
        before = self.snapshot()
        def late(*args, **kwargs):
            self.deactivate()
            return OrchestratorResult(needs_action=True, actions=[OrchestratorAction(
                type="daily_life", intent="record_daily_trace", mode="record", reason="합성 사건",
                confidence=.9, requires_confirmation=False, execution_order=1,
                arguments={"summary": "SYNTHETIC_PRIVATE_PLAN", "category": None},
            )])
        with patch.object(integration, "SessionLocal", self.factory), \
                patch.object(integration, "retrieve_relevant_memories_safe", return_value=[]), \
                patch.object(integration, "orchestrate_with_openai", side_effect=late), \
                patch.object(integration, "execute_action") as run, redirect_stdout(StringIO()):
            integration.run_chat_agent_integration(self.ma.id, uuid4())
        run.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_old_attempt_cannot_cancel_new_attempt(self):
        row, lease, _ = self.lease_action()
        self.db.execute(update(AgentAction).where(AgentAction.id == row.id).values(attempt_count=lease.attempt_count + 1))
        self.db.commit()
        self.deactivate()
        result, fenced = executor._finish_success(lease, ExecutorResult(outcome="synthetic"))
        self.assertTrue(fenced)
        self.assertEqual(result.attempt_count, lease.attempt_count + 1)
        self.assertEqual(result.status, "processing")
        self.assertIsNone(result.result)

    def test_stale_user_identity_map_does_not_allow_pending_memory_autoflush(self):
        with self.factory() as stale:
            cached = stale.get(User, self.aid)
            self.assertIsNone(cached.deleted_at)
            self.deactivate()
            self.assertIsNone(cached.deleted_at)
            stale.add(Memory(user_id=self.aid, content="must not flush", kind="goal"))
            writes = []
            def capture(conn, cursor, statement, parameters, context, many):
                if statement.lstrip().startswith("INSERT"):
                    writes.append(statement)
            event.listen(self.engine, "before_cursor_execute", capture)
            try:
                with self.assertRaises(guard.AccountWriteRejected):
                    guard.require_active_account_for_write(stale, self.aid)
            finally:
                event.remove(self.engine, "before_cursor_execute", capture)
            self.assertEqual(writes, [])
            stale.commit()  # 거부 후 호출자가 잘못 commit해도 rollback된 payload는 남지 않습니다.
        self.assertEqual(self.count("memories"), 1)

    def test_manual_message_and_memory_late_request_rejected(self):
        self.deactivate()
        before = self.snapshot()
        with self.assertRaises(storage.StorageNotFoundError):
            storage.create_message(self.db, self.ca.id, MessageCreate(role="user", content="late"))
        with self.assertRaises(memory_service.MemoryNotFoundError):
            memory_service.create_memory(self.db, MemoryCreate(user_id=self.aid, content="late", kind="goal", evidence_message_ids=[self.ma.id]))
        self.assertEqual(self.snapshot(), before)

    def test_purge_and_rejoin_never_rebind_old_work(self):
        from auth_bootstrap_service import bootstrap_auth_identity
        message, lease = self.lease_memory()
        # 실제 worker처럼 이미 읽은 원문 식별자를 보존하고 삭제 세션의 expire_all과 분리합니다.
        self.db.expunge(message)
        _, agent_lease, context = self.lease_action()
        start = chat.begin_chat_request("synthetic", uuid4(), authenticated_user_id=self.aid)
        self.deactivate()
        lifecycle.purge_deleted_account(self.db, self.aid)
        new_principal = bootstrap_auth_identity(self.db, self.identity)
        self.assertNotEqual(new_principal, self.aid)
        before = self.snapshot()
        self.assertFalse(chat.complete_chat_request(start.context, "private", "fallback", {"reply": "private"}))
        with self.assertRaises(reconciliation.MemoryReconciliationValidationError):
            self.reconcile(message, lease, "new")
        with self.assertRaises(executor.ExecutorDatabaseError):
            executor._finish_success(agent_lease, ExecutorResult(outcome="private"))
        with self.assertRaises(Exception):
            record_daily_trace_executor(context)
        self.assertEqual(self.snapshot(), before)

    def test_a_inactive_b_still_saves_normally(self):
        self.deactivate()
        start = chat.begin_chat_request("B raw", uuid4(), authenticated_user_id=self.bid)
        self.assertTrue(chat.complete_chat_request(start.context, "B reply", "fallback", {"reply": "B reply"}, reject_unsafe_response=True))
        self.assertEqual(start.context.user_id, self.bid)
        self.assertIsNotNone(self.db.get(User, self.aid).deleted_at)

    def test_guard_db_failure_rolls_back_pending_writes(self):
        with self.factory() as db:
            db.add(Memory(user_id=self.aid, content="never committed", kind="goal"))
            with patch.object(db, "execute", side_effect=SQLAlchemyError("synthetic")), self.assertRaises(SQLAlchemyError):
                guard.require_active_account_for_write(db, self.aid)
            db.commit()
        self.assertEqual(self.count("memories"), 1)

    def test_finalize_db_failure_does_not_return_private_success(self):
        start = chat.begin_chat_request("synthetic", uuid4(), authenticated_user_id=self.aid)
        before = self.count("messages")
        with patch.object(guard, "bound_lifecycle_lock_wait", side_effect=SQLAlchemyError("synthetic")), \
                self.assertRaises(chat.AuthenticatedOwnershipError):
            chat.complete_chat_request(start.context, "private", "fallback", {"reply": "private"}, reject_unsafe_response=True)
        self.assertEqual(self.count("messages"), before)
        record = self.db.get(ChatRequestRecord, start.context.request_id)
        self.assertIsNone(record.response)

    def test_chat_commit_failure_rolls_back_flushed_reply_and_cache(self):
        start = chat.begin_chat_request("synthetic", uuid4(), authenticated_user_id=self.aid)
        before = self.count("messages")
        def fault(db):
            raise SQLAlchemyError("synthetic commit failure")
        event.listen(self.factory, "before_commit", fault)
        try:
            with self.assertRaises(chat.AuthenticatedOwnershipError):
                chat.complete_chat_request(start.context, "private", "fallback", {"reply": "private"}, reject_unsafe_response=True)
        finally:
            event.remove(self.factory, "before_commit", fault)
        self.assertEqual(self.count("messages"), before)
        self.assertIsNone(self.db.get(ChatRequestRecord, start.context.request_id).response)

    def test_domain_before_commit_failure_rolls_back_insert(self):
        _, _, context = self.lease_action()
        def fault():
            raise RuntimeError("synthetic before commit")
        with self.assertRaises(RuntimeError):
            record_daily_trace_executor(context, before_commit=fault)
        self.assertEqual(self.count("daily_life_events"), 0)

    def test_changed_owner_cannot_rebind_chat_or_memory_result(self):
        start = chat.begin_chat_request("synthetic", uuid4(), authenticated_user_id=self.aid)
        message, lease = self.lease_memory()
        before = self.snapshot()
        with self.assertRaises(chat.AuthenticatedOwnershipError):
            chat.complete_chat_request(replace(start.context, user_id=self.bid), "private", "fallback", {}, reject_unsafe_response=True)
        self.assertEqual(self.db.get(ChatRequestRecord, start.context.request_id).status, "processing")
        with self.assertRaises(reconciliation.MemoryReconciliationValidationError):
            reconciliation.apply_reconciliation(lease.id, self.bid, message.id,
                MemoryExtractionDecision(should_remember=True, content="synthetic", kind="goal", reason="synthetic", importance=70, confidence=.9),
                MemoryReconciliationDecision(action="new", matched_memory_id=None, reason="synthetic", confidence=.9), [], lease.attempt_count)
        self.assertEqual(self.snapshot(), before)

    def test_chat_late_result_no_success_or_follow_up(self):
        analysis = main.build_response("synthetic", {
            "primary_axis": {"like": .1, "dislike": .1},
            "emotion_axis": {axis: .1 for axis in "FADJCGTR"}, "state_summary": "synthetic"}, "rule_based")
        def respond(*args, **kwargs):
            self.deactivate()
            return "SYNTHETIC_PRIVATE_LATE_REPLY"
        tasks = BackgroundTasks()
        with ExitStack() as stack:
            stack.enter_context(patch.object(main, "retrieve_relevant_memories_safe", return_value=[]))
            stack.enter_context(patch.object(main, "analyze_text", return_value=(analysis, "rule_based")))
            stack.enter_context(patch.object(main, "generate_chat_reply_with_openai", side_effect=respond))
            stack.enter_context(patch.object(main, "prepare_chat_recommendation", return_value=(None, None)))
            with self.assertRaises(HTTPException) as caught:
                main.chat(main.ChatRequest(text="synthetic", request_id=uuid4()), tasks, self.principal)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertNotIn("PRIVATE", str(caught.exception.detail))
        self.assertEqual(tasks.tasks, [])
        self.assertEqual(self.count("messages"), 3)  # 원래 A/B + 요청 원문만 존재합니다.

    def test_sequential_save_then_delete_and_delete_then_save(self):
        # 순차 계약 검사일 뿐 PostgreSQL 동시 경합 증거는 아닙니다.
        start = chat.begin_chat_request("first", uuid4(), authenticated_user_id=self.aid)
        self.assertTrue(chat.complete_chat_request(start.context, "before deletion", "fallback", {}))
        late = chat.begin_chat_request("second", uuid4(), authenticated_user_id=self.aid)
        self.deactivate()
        before = self.count("messages")
        self.assertFalse(chat.complete_chat_request(late.context, "after deletion", "fallback", {}))
        self.assertEqual(self.count("messages"), before)

    def test_postgresql_guard_sql_and_user_first_transaction(self):
        statements = []
        def capture(conn, clause, params, multi, options):
            statements.append(clause)
        event.listen(self.engine, "before_execute", capture)
        try:
            start = chat.begin_chat_request("raw", uuid4(), authenticated_user_id=self.aid)
            statements.clear()
            self.assertTrue(chat.complete_chat_request(start.context, "reply", "fallback", {}))
        finally:
            event.remove(self.engine, "before_execute", capture)
        sql = [str(stmt.compile(dialect=postgresql.dialect())) for stmt in statements]
        user_lock = next(i for i, stmt in enumerate(sql) if "FROM users" in stmt and "FOR SHARE" in stmt)
        child_lock = next(i for i, stmt in enumerate(sql) if "FROM chat_requests" in stmt and "FOR UPDATE" in stmt)
        insert = next(i for i, stmt in enumerate(sql) if "INSERT INTO messages" in stmt)
        self.assertLess(user_lock, child_lock)
        self.assertLess(child_lock, insert)
        fake = Mock()
        fake.get_bind.return_value.dialect.name = "postgresql"
        guard.bound_lifecycle_lock_wait(fake)
        self.assertEqual(str(fake.execute.call_args.args[0]), "SET LOCAL lock_timeout = '3s'")


if __name__ == "__main__":
    unittest.main()
