"""Synthetic SQLite/Mock checks, never PostgreSQL lock or live SDK evidence."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from threading import Barrier, Lock
import unittest
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm.attributes import set_committed_value

import account_lifecycle_service as lifecycle
from auth_context import AuthPrincipal
from agent import executor_service, object_mention_service as service
from agent import save_object_mention_executor as saving
from agent.action_schemas import ConfirmationRequest, PersistActionPlanRequest, AgentActionResponse
from agent.action_service import (ActionConflictError, ActionValidationError, confirm_action, persist_action_plan)
from agent.executor_registry import ExecutorContext
from agent.object_mention_schemas import GatewayActionType
from agent.schemas import AgentType, OrchestratorAction
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from evals import run_object_reference_tests as preview_fixture
from evals import run_security_activity_recorder_tests as fixture
from models.activity import Activity
from models.agent_action import AgentAction
from models.message import Message
from models.object_mention import ObjectMention
from models.user import User


@contextmanager
def sqlite_utc_leases():
    """Restore server-generated lease UTC lost by SQLite, not unknown activity times."""
    def restore(action, context, *attrs):
        value = action.lease_expires_at
        if value is not None and value.utcoffset() is None:
            set_committed_value(action, "lease_expires_at", value.replace(tzinfo=timezone.utc))
    event.listen(AgentAction, "load", restore)
    event.listen(AgentAction, "refresh", restore)
    try:
        yield
    finally:
        event.remove(AgentAction, "load", restore)
        event.remove(AgentAction, "refresh", restore)


class ObjectMentionTests(unittest.TestCase):
    record = preview_fixture.ObjectReferenceTests.record
    request = preview_fixture.ObjectReferenceTests.request

    def setUp(self):
        fixture.ActivityOwnershipTests.setUp(self)
        self.stack.enter_context(patch.dict("os.environ", {"NOIE_OBJECT_MENTION_ENABLED": "true"}))
        self.stack.enter_context(patch.object(saving, "SessionLocal", self.factory))
        self.sdk = self.stack.enter_context(patch("openai.resources.responses.Responses.create",
            side_effect=AssertionError("SDK must not run")))
        self.activity, self.message = self.record()
        self.args = self.request(self.activity, self.message)

    def tearDown(self):
        self.sdk.assert_not_called()
        fixture.ActivityOwnershipTests.tearDown(self)

    def count(self):
        return fixture.ActivityOwnershipTests.count(self, ObjectMention)

    def plan(self, args=None, *, confirm=True, action_id=None, message_id=None, conversation_id=None):
        response = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
            action_id=action_id or uuid4(), type="object", intent="save_object_mention", mode="execute",
            reason="Explicit source selection", confidence=.9, requires_confirmation=False,
            execution_order=1, arguments=args or self.args,
        )]))
        self.assertEqual(response.plans[0].status, "pending_confirmation")
        row = persist_action_plan(self.db, PersistActionPlanRequest(user_id=self.aid,
            conversation_id=conversation_id or self.ca.id, message_id=message_id or self.message.id,
            plans=response.plans))[0]
        if confirm and row.status == "pending_confirmation":
            row = confirm_action(self.db, row.action_id,
                ConfirmationRequest(user_id=self.aid, confirmation_id=row.confirmation_id))
        return row

    def execute(self, action, expected="completed"):
        outcome = executor_service.execute_action(action.action_id, action.user_id)
        self.assertEqual(outcome.action.status, expected)
        self.db.expire_all()
        return outcome

    def read(self, **kwargs):
        return service.read_object_mentions(self.db, self.principal, **kwargs)

    def test_four_kinds_store_and_read_unresolved(self):
        for kind in ("person", "place", "thing", "project"):
            with self.subTest(kind=kind):
                args = self.args.model_copy(update={"kind": kind})
                result = self.execute(self.plan(args))
                row = self.read(mention_id=UUID(result.action.result["data"]["mention_id"]))
                self.assertEqual((row.kind, row.label, row.identity_status, row.kind_basis),
                                 (kind, "NOIE", "unresolved", "user_selected"))
                self.assertIn("mention_id", result.action.result["data"])
        self.assertEqual(self.count(), 4)

    def test_unicode_uses_python_codepoints_not_utf16(self):
        row, message = self.record("\U0001f4da e\u0301 \uae30\ub85d. Cafe \uacf5\ubd80\ud588\uc5b4.")
        args = self.request(row, message, "Cafe", "place")
        self.execute(self.plan(args, message_id=message.id))
        result = self.read()[0]
        self.assertEqual(result.source_span.start, 9)
        self.assertEqual(message.content[result.source_span.start:result.source_span.end], result.label)

    def test_wrong_span_or_label_rejected_before_approval(self):
        for changed in ({"label": "noie"}, {"source_span": {"start": 1, "end": 5}}):
            args = self.args.model_dump()
            args.update(changed)
            with self.assertRaises(ActionValidationError):
                self.plan(args)
        self.assertEqual(self.count(), 0)

    def test_other_activity_segment_in_same_message_rejected(self):
        row, message = self.record("NOIE \uac1c\ubc1c\ud588\uc5b4. Cafe \uacf5\ubd80\ud588\uc5b4.")
        args = self.request(row, message, "Cafe", "place")
        with self.assertRaises(ActionValidationError):
            self.plan(args, message_id=message.id)

    def test_wrong_action_source_rejected(self):
        with self.assertRaises(ActionValidationError):
            self.plan(message_id=self.ma.id)

    def test_same_label_new_actions_are_not_merged(self):
        for _ in range(2):
            self.execute(self.plan())
        self.assertEqual(self.count(), 2)
        self.assertEqual(len({row.id for row in self.read()}), 2)

    def test_same_label_in_new_source_is_a_separate_mention(self):
        self.execute(self.plan())
        row, message = self.record()
        self.execute(self.plan(self.request(row, message), message_id=message.id))
        self.assertEqual(self.count(), 2)

    def test_unconfirmed_action_never_writes(self):
        action = self.plan(confirm=False)
        with self.assertRaises(executor_service.ExecutorConflictError):
            executor_service.execute_action(action.action_id, self.aid)
        self.assertEqual(self.count(), 0)

    def test_confirmation_forced_and_action_response_accepts_object(self):
        action = self.plan(confirm=False)
        self.assertTrue(action.requires_confirmation)
        self.assertEqual(action.status, "pending_confirmation")
        self.assertEqual(AgentActionResponse.model_validate(action).action_type, "object")

    def test_orchestrator_contract_does_not_accept_object(self):
        with self.assertRaises(ValidationError):
            OrchestratorAction(type="object", intent="save_object_mention", mode="execute",
                reason="Explicit source", confidence=.9, requires_confirmation=True, execution_order=1)

    def test_gateway_rejects_object_record_and_foreign_argument_domain(self):
        for kind, mode, intent in (("object", "record", "save_object_mention"),
                                    ("daily_life", "execute", "save_object_mention"),
                                    ("place", "record", "record_place_event")):
            with self.assertRaises(ValidationError):
                GatewayAction(type=kind, intent=intent, mode=mode, reason="Explicit source",
                    confidence=.9, requires_confirmation=False, execution_order=1, arguments=self.args)

    def test_forged_ready_plan_is_rejected(self):
        response = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(type="object",
            intent="save_object_mention", mode="execute", reason="Explicit source", confidence=.9,
            requires_confirmation=True, execution_order=1, arguments=self.args)]))
        plan = response.plans[0].model_copy(update={"status": "ready", "requires_confirmation": False})
        with self.assertRaises(ActionValidationError):
            persist_action_plan(self.db, PersistActionPlanRequest(user_id=self.aid,
                message_id=self.message.id, conversation_id=self.ca.id, plans=[plan]))
        self.assertEqual(self.count(), 0)

    def test_same_plan_id_reuses_confirmation(self):
        first = self.plan(confirm=False)
        again = self.plan(confirm=False, action_id=first.action_id)
        self.assertEqual((first.id, first.confirmation_id), (again.id, again.confirmation_id))

    def test_same_plan_changed_kind_requires_new_confirmation(self):
        action = self.plan()
        with self.assertRaises(ActionConflictError):
            self.plan(self.args.model_copy(update={"kind": "thing"}), action_id=action.action_id)
        self.assertEqual(self.count(), 0)

    def test_tampered_arguments_before_confirmation_rejected(self):
        action = self.plan(confirm=False)
        action.arguments = {**action.arguments, "kind": "thing"}
        self.db.commit()
        with self.assertRaises(ActionConflictError):
            confirm_action(self.db, action.action_id,
                ConfirmationRequest(user_id=self.aid, confirmation_id=action.confirmation_id))
        self.assertEqual(self.count(), 0)

    def test_tampered_arguments_after_confirmation_rejected(self):
        action = self.plan()
        action.arguments = {**action.arguments, "label": "OTHER"}
        self.db.commit()
        with self.assertRaises(executor_service.ExecutorConflictError):
            executor_service.execute_action(action.action_id, self.aid)
        self.assertEqual(self.count(), 0)

    def test_completed_duplicate_does_not_execute_again(self):
        action = self.plan()
        first = self.execute(action)
        again = self.execute(action)
        self.assertFalse(again.executor_called)
        self.assertEqual(first.action.result, again.action.result)
        self.assertEqual(self.count(), 1)

    def test_foreign_activity_cannot_be_planned(self):
        row, message = self.record(other_owner=True)
        with self.assertRaises(ActionValidationError):
            self.plan(self.request(row, message))
        self.assertEqual(self.count(), 0)

    def test_other_account_read_returns_no_private_fields(self):
        self.execute(self.plan())
        mention = self.read()[0]
        self.assertEqual(service.read_object_mentions(self.db, AuthPrincipal(self.bid)), [])
        with self.assertRaises(HTTPException) as error:
            service.read_object_mentions(self.db, AuthPrincipal(self.bid), mention_id=mention.id)
        self.assertEqual(error.exception.status_code, 404)

    def test_other_account_execute_denied(self):
        action = self.plan()
        with self.assertRaises(executor_service.ExecutorNotFoundError):
            executor_service.execute_action(action.action_id, self.bid)
        self.assertEqual(self.count(), 0)

    def test_inactive_account_cannot_execute_or_read(self):
        action = self.plan()
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        with self.assertRaises(executor_service.ExecutorDatabaseError):
            executor_service.execute_action(action.action_id, self.aid)
        with self.assertRaises(HTTPException) as error:
            self.read()
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(self.count(), 0)

    def test_deleted_conversation_prevents_cached_result_and_read(self):
        action = self.plan()
        self.execute(action)
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.read(), [])
        with self.assertRaises(executor_service.ExecutorNotFoundError):
            executor_service.execute_action(action.action_id, self.aid)

    def test_damaged_activity_evidence_excluded_from_read(self):
        self.execute(self.plan())
        self.activity.metadata_ = {}
        self.db.commit()
        self.assertEqual(self.read(), [])

    def test_source_author_mismatch_excluded_from_read_and_replay(self):
        action = self.plan()
        self.execute(action)
        self.message.user_id = self.bid
        self.db.commit()
        self.assertEqual(self.read(), [])
        with self.assertRaises(executor_service.ExecutorNotFoundError):
            executor_service.execute_action(action.action_id, self.aid)

    def test_changed_source_content_cannot_be_confirmed(self):
        action = self.plan(confirm=False)
        self.message.content = "OTHER"
        self.db.commit()
        with self.assertRaises(ActionConflictError):
            confirm_action(self.db, action.action_id,
                ConfirmationRequest(user_id=self.aid, confirmation_id=action.confirmation_id))

    def test_deleted_or_superseded_mention_not_returned_or_recreated(self):
        for field, value in (("deleted_at", datetime.now(timezone.utc)), ("status", "superseded")):
            action = self.plan()
            self.execute(action)
            row = self.db.scalar(select(ObjectMention).where(ObjectMention.agent_action_id == action.id))
            setattr(row, field, value)
            self.db.commit()
            with self.assertRaises(HTTPException):
                self.read(mention_id=row.id)
            with self.assertRaises(executor_service.ExecutorConflictError):
                executor_service.execute_action(action.action_id, self.aid)
        self.assertEqual(self.count(), 2)

    def test_damaged_mention_binding_is_not_returned(self):
        action = self.plan()
        self.execute(action)
        row = self.db.scalar(select(ObjectMention))
        row.label = "XXXX"
        self.db.commit()
        self.assertEqual(self.read(), [])
        with self.assertRaises(executor_service.ExecutorConflictError):
            executor_service.execute_action(action.action_id, self.aid)

    def test_before_commit_failure_rolls_back_and_retry_succeeds(self):
        action = self.plan()
        def fail(context):
            def before_commit():
                raise RuntimeError("SYNTHETIC_PRIVATE_ERROR")
            return saving.save_object_mention_executor(context, before_commit=before_commit)
        with patch.object(executor_service, "get_executor", return_value=fail):
            result = self.execute(action, "failed")
        self.assertNotIn("SYNTHETIC_PRIVATE_ERROR", result.action.error_message)
        self.assertEqual(self.count(), 0)
        self.execute(action)
        self.assertEqual(self.count(), 1)

    def test_finalize_loss_retry_reuses_committed_row(self):
        action = self.plan()
        with patch.object(executor_service, "_finish_success", side_effect=RuntimeError("SYNTHETIC_PRIVATE_ERROR")):
            self.execute(action, "failed")
        before = self.db.scalar(select(ObjectMention.id))
        result = self.execute(action)
        self.assertTrue(result.action.result["data"]["reused"])
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.db.scalar(select(ObjectMention.id)), before)

    def test_stale_attempt_cannot_write_or_overwrite(self):
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, self.aid)
        self.db.expire_all()
        self.db.get(AgentAction, action.id).attempt_count += 1
        self.db.commit()
        with self.assertRaises(service.ObjectMentionError):
            saving.save_object_mention_executor(ExecutorContext(str(action.action_id), str(self.aid),
                "save_object_mention", lease.attempt_count))
        self.assertEqual(self.count(), 0)

    def test_valid_processing_lease_is_not_reclaimed(self):
        action = self.plan()
        executor_service._acquire_lease(action.action_id, self.aid)
        with sqlite_utc_leases(), self.assertRaises(executor_service.ExecutorBusyError):
            executor_service._acquire_lease(action.action_id, self.aid)

    def test_stale_lease_retry_uses_new_attempt(self):
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, self.aid)
        self.db.expire_all()
        stored = self.db.get(AgentAction, action.id)
        stored.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)
        self.db.commit()
        with sqlite_utc_leases():
            result = self.execute(action)
        self.assertEqual(result.action.attempt_count, lease.attempt_count + 1)
        self.assertEqual(self.count(), 1)

    def test_simulated_serialization_keeps_one_row_for_same_action(self):
        """SQLite cannot prove PostgreSQL row-lock behavior."""
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, self.aid)
        context = ExecutorContext(str(action.action_id), str(self.aid), "save_object_mention", lease.attempt_count)
        gate, ready = Lock(), Barrier(2)
        @contextmanager
        def serialized_factory():
            with gate:
                with self.factory() as db:
                    yield db
        def run(_):
            ready.wait(timeout=10)
            return saving.save_object_mention_executor(context).data["reused"]
        with patch.object(saving, "SessionLocal", serialized_factory), ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(run, (0, 1)))
        self.db.expire_all()
        self.assertCountEqual(outcomes, (False, True))
        self.assertEqual(self.count(), 1)

    def test_account_purge_preserves_other_account_and_handles_self_fk(self):
        self.execute(self.plan())
        first = self.db.scalar(select(ObjectMention))
        second_action = self.plan()
        self.execute(second_action)
        second = self.db.scalar(select(ObjectMention).where(ObjectMention.id != first.id))
        second.supersedes_mention_id = first.id
        first.status = "superseded"
        self.db.commit()
        lifecycle.validate_inventory()
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(lifecycle.purge_deleted_account(self.db, self.aid), "purged")
        self.assertEqual(self.count(), 0)
        self.assertIsNotNone(self.db.get(User, self.bid))
        self.assertIsNotNone(self.db.get(Message, self.mb.id))

    def test_cross_account_self_reference_aborts_purge(self):
        self.execute(self.plan())
        first = self.db.scalar(select(ObjectMention))
        other = ObjectMention(user_id=self.bid, activity_id=first.activity_id, message_id=self.mb.id,
            conversation_id=self.cb.id, agent_action_id=first.agent_action_id,
            kind="thing", label="NOIE", source_start=0, source_end=4, supersedes_mention_id=first.id)
        # A separate approval is needed to satisfy the one-action constraint.
        second_action = self.plan()
        other.agent_action_id = second_action.id
        self.db.add(other)
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        with self.assertRaises(lifecycle.AccountLifecycleError):
            lifecycle.purge_deleted_account(self.db, self.aid)
        self.assertEqual(self.count(), 2)
        self.assertIsNotNone(self.db.get(User, self.aid))

    def test_original_message_activity_and_unknown_times_unchanged(self):
        before = deepcopy(self.activity.metadata_)
        raw = self.message.content
        status = self.activity.status
        self.execute(self.plan())
        self.assertEqual(self.db.get(Message, self.message.id).content, raw)
        stored = self.db.get(Activity, self.activity.id)
        self.assertEqual((stored.status, stored.metadata_), (status, before))
        self.assertIsNone(stored.start_time)
        self.assertIsNone(stored.end_time)
        self.assertIsNone(self.read()[0].observed_at)

    def test_read_does_not_write_or_expose_internal_metadata(self):
        self.execute(self.plan())
        writes = []
        def observe(connection, cursor, statement, parameters, context, many):
            if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
                writes.append(statement)
        event.listen(self.engine, "before_cursor_execute", observe)
        try:
            response = self.read()[0].model_dump(mode="json")
        finally:
            event.remove(self.engine, "before_cursor_execute", observe)
        self.assertEqual(writes, [])
        for key in ("user_id", "message_id", "conversation_id", "agent_action_id", "metadata", "confidence"):
            self.assertNotIn(key, response)

    def test_read_limit_and_auth_validation(self):
        for limit in (0, 51, True, "2"):
            with self.assertRaises(HTTPException) as error:
                self.read(limit=limit)
            self.assertEqual(error.exception.status_code, 422)
        with self.assertRaises(HTTPException) as error:
            service.read_object_mentions(self.db, None)
        self.assertEqual(error.exception.status_code, 401)

    def test_db_read_failure_is_safe_and_closed(self):
        with preview_fixture.captured_output() as output, patch.object(self.db, "scalar",
                side_effect=SQLAlchemyError("SYNTHETIC_PASSWORD token=PRIVATE")):
            with self.assertRaises(HTTPException) as error:
                self.read()
        self.assertEqual(error.exception.status_code, 503)
        self.assertNotIn("SYNTHETIC_PASSWORD", str(error.exception.detail))
        self.assertEqual(output.getvalue(), "")

    def test_errors_and_executor_output_do_not_log_raw_private_fields(self):
        action = self.plan()
        with preview_fixture.captured_output() as output:
            self.execute(action)
            self.read()
        for marker in (self.message.content, str(self.message.id), str(self.aid), str(action.action_id)):
            self.assertNotIn(marker, output.getvalue())
        self.assertEqual(output.getvalue(), "")

    def test_sensitive_source_rejected_without_logging(self):
        self.message.content += " password=SyntheticPassword987 token=SyntheticToken987"
        self.db.commit()
        with preview_fixture.captured_output() as output:
            with self.assertRaises(ActionValidationError):
                self.plan()
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(self.count(), 0)

    def test_feature_off_never_writes(self):
        action = self.plan()
        with patch.dict("os.environ", {"NOIE_OBJECT_MENTION_ENABLED": "false"}):
            with self.assertRaises(executor_service.ExecutorConflictError):
                executor_service.execute_action(action.action_id, self.aid)
        self.assertEqual(self.count(), 0)

    def test_unique_action_and_fk_restrict_constraints(self):
        self.execute(self.plan())
        row = self.db.scalar(select(ObjectMention))
        data = {column.name: getattr(row, column.name) for column in ObjectMention.__table__.columns
                if column.name not in {"id", "created_at", "updated_at"}}
        self.db.add(ObjectMention(**data))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()
        self.db.delete(self.db.get(Activity, self.activity.id))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()
        self.assertEqual(self.count(), 1)


if __name__ == "__main__":
    unittest.main()
