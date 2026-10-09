"""합성 SQLite와 기존 Action confirmation/Executor로 완료 연결의 안전 경계를 검사합니다."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, redirect_stdout, redirect_stderr
from copy import deepcopy
from datetime import datetime, timezone
from io import StringIO
from threading import Lock, Barrier
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from agent.action_schemas import ConfirmationRequest, PersistActionPlanRequest
from agent.action_service import (ActionConflictError, ActionConfirmationError, ActionValidationError,
                                  confirm_action, persist_action_plan)
from agent.activity_link_schemas import LinkActivityCompletionArguments
from agent.activity_lifecycle_service import LINK_KEY, ActivityLinkError, lock_activity_pair
from agent.executor_registry import ExecutorContext
from agent import executor_service
from agent import link_activity_completion_executor as linking
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from models.activity import Activity
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.user import User
from auth_context import AuthPrincipal
from evals import run_security_activity_recorder_tests as fixture


class ActivityLifecycleTests(unittest.TestCase):
    """실제 사용자/DB/SDK 대신 기존 소유권 fixture와 실제 실행 계층을 재사용합니다."""

    def setUp(self):
        fixture.ActivityOwnershipTests.setUp(self)
        self.stack.enter_context(patch.object(linking, "SessionLocal", self.factory))
        self.ongoing = self.seed("지금 공부하고 있어")
        self.completion = self.seed("공부 마쳤어")

    def tearDown(self):
        fixture.ActivityOwnershipTests.tearDown(self)

    count = fixture.ActivityOwnershipTests.count

    def seed(self, text, *, user_id=None, conversation=None):
        message = Message(user_id=user_id or self.aid, conversation_id=(conversation or self.ca).id,
                          role="user", content=text)
        self.db.add(message)
        self.db.commit()
        action = fixture.ActivityOwnershipTests.plan(self, message)
        fixture.ActivityOwnershipTests.execute(self, action)
        return self.db.scalar(select(Activity).where(Activity.message_id == message.id))

    def plan(self, *, ongoing=None, completion=None, action_id=None, confirm=True):
        ongoing = ongoing or self.ongoing
        completion = completion or self.completion
        result = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
            action_id=action_id or uuid4(), type="daily_life", intent="link_activity_completion",
            mode="execute", reason="합성 활동 연결 요청", confidence=.9, requires_confirmation=False,
            execution_order=1, arguments=dict(ongoing_activity_id=ongoing.id, completion_activity_id=completion.id),
        )]))
        self.assertEqual(result.plans[0].status, "pending_confirmation")
        self.assertTrue(result.plans[0].requires_confirmation)
        row = persist_action_plan(self.db, PersistActionPlanRequest(user_id=self.aid,
            conversation_id=completion.conversation_id, message_id=completion.message_id, plans=result.plans))[0]
        if confirm and row.status == "pending_confirmation":
            row = confirm_action(self.db, row.action_id,
                ConfirmationRequest(user_id=self.aid, confirmation_id=row.confirmation_id))
        return row

    def execute(self, action, *, expected="completed"):
        result = executor_service.execute_action(action.action_id, action.user_id)
        self.assertEqual(result.action.status, expected)
        self.db.expire_all()
        return result

    def link(self):
        self.db.expire_all()
        metadata = self.db.get(Activity, self.completion.id).metadata_
        return metadata.get(LINK_KEY) if isinstance(metadata, dict) else None

    def assert_unlinked(self):
        self.assertIsNone(self.link())

    def test_gateway_forces_confirmation_for_exact_pair(self):
        action = self.plan(confirm=False)
        self.assertEqual(action.status, "pending_confirmation")
        self.assertEqual(action.arguments, dict(ongoing_activity_id=str(self.ongoing.id),
                                               completion_activity_id=str(self.completion.id)))
        self.assert_unlinked()

    def test_existing_http_plan_confirm_execute_flow(self):
        payload = {"actions": [{"action_id": str(uuid4()), "type": "daily_life",
            "intent": "link_activity_completion", "mode": "execute", "reason": "합성 연결 요청",
            "confidence": .9, "requires_confirmation": False, "execution_order": 1,
            "arguments": {"ongoing_activity_id": str(self.ongoing.id),
                          "completion_activity_id": str(self.completion.id)}}]}
        planned = self.client.post("/agent/tool-plan", json=payload)
        self.assertEqual(planned.status_code, 200)
        saved = self.client.post("/agent/actions/plan", json={"user_id": str(self.aid),
            "conversation_id": str(self.ca.id), "message_id": str(self.completion.message_id),
            "plans": planned.json()["plans"]})
        self.assertEqual(saved.status_code, 201)
        action = saved.json()[0]
        path = f"/agent/actions/{action['action_id']}"
        self.assertEqual(self.client.post(path + "/execute", json={"user_id": str(self.aid)}).status_code, 409)
        self.assert_unlinked()
        confirmed = self.client.post(path + "/confirm", json={"user_id": str(self.aid),
            "confirmation_id": action["confirmation_id"]})
        self.assertEqual(confirmed.status_code, 200)
        executed = self.client.post(path + "/execute", json={"user_id": str(self.aid)})
        self.assertEqual(executed.status_code, 200)
        self.assertEqual(executed.json()["action"]["result"]["outcome"], "activity_completion_linked")
        repeated = self.client.post(path + "/execute", json={"user_id": str(self.aid)})
        self.assertEqual(repeated.status_code, 200)
        self.assertFalse(repeated.json()["executor_called"])
        self.assertIsNotNone(self.link())

    def test_http_other_principal_cannot_confirm_or_execute(self):
        action = self.plan(confirm=False)
        self.principal = AuthPrincipal(self.bid)
        path = f"/agent/actions/{action.action_id}"
        self.assertEqual(self.client.post(path + "/confirm", json={"user_id": str(self.aid),
            "confirmation_id": str(action.confirmation_id)}).status_code, 403)
        self.assertEqual(self.client.post(path + "/execute", json={"user_id": str(self.aid)}).status_code, 403)
        self.assert_unlinked()

    def test_multiple_ongoing_records_do_not_change_explicit_target(self):
        other = self.seed("공부하고 있어")
        self.execute(self.plan(ongoing=other))
        self.assertEqual(self.link()["ongoing_activity_id"], str(other.id))
        self.assertEqual(self.ongoing.status, "ongoing")
        self.assertNotIn(LINK_KEY, self.ongoing.metadata_)

    def test_unconfirmed_action_cannot_execute(self):
        action = self.plan(confirm=False)
        with self.assertRaises(executor_service.ExecutorConflictError):
            executor_service.execute_action(action.action_id, self.aid)
        self.assert_unlinked()

    def test_confirmed_pair_links_without_changing_reports(self):
        before = deepcopy(self.completion.metadata_)
        messages = {row.id: row.content for row in self.db.scalars(select(Message))}
        action = self.plan()
        result = self.execute(action)
        self.assertEqual(result.action.result["outcome"], "activity_completion_linked")
        self.assertEqual(self.link()["ongoing_activity_id"], str(self.ongoing.id))
        self.assertEqual(self.link()["completion_activity_id"], str(self.completion.id))
        self.assertEqual(self.link()["confirmation_action_id"], str(action.id))
        self.assertEqual(self.link()["basis"], "user_confirmed")
        self.assertEqual({k: v for k, v in self.completion.metadata_.items() if k != LINK_KEY}, before)
        self.assertEqual((self.ongoing.status, self.completion.status), ("ongoing", "performed"))
        self.assertEqual({row.id: row.content for row in self.db.scalars(select(Message))}, messages)

    def test_same_completed_action_does_not_execute_again(self):
        action = self.plan()
        self.execute(action)
        before = deepcopy(self.link())
        result = self.execute(action)
        self.assertFalse(result.executor_called)
        self.assertEqual(self.link(), before)
        self.assertEqual(self.count(), 2)

    def test_same_pair_new_action_reuses_first_link(self):
        self.execute(self.plan())
        before = deepcopy(self.link())
        result = self.execute(self.plan())
        self.assertTrue(result.action.result["data"]["reused"])
        self.assertEqual(self.link(), before)

    def test_same_plan_id_reuses_mapping(self):
        first = self.plan(confirm=False)
        again = self.plan(action_id=first.action_id, confirm=False)
        self.assertEqual(first.id, again.id)
        self.assertEqual(first.confirmation_id, again.confirmation_id)

    def test_changed_pair_same_plan_id_requires_new_confirmation(self):
        first = self.plan()
        other = self.seed("공부하고 있어")
        with self.assertRaises(ActionConflictError):
            self.plan(ongoing=other, action_id=first.action_id)
        self.assert_unlinked()

    def test_changed_pair_new_action_is_pending_not_implicitly_confirmed(self):
        self.plan()
        other = self.seed("공부하고 있어")
        action = self.plan(ongoing=other, confirm=False)
        self.assertEqual(action.status, "pending_confirmation")
        self.assert_unlinked()

    def test_arguments_tampered_before_confirmation_are_rejected(self):
        action = self.plan(confirm=False)
        action.arguments = dict(action.arguments, ongoing_activity_id=str(uuid4()))
        self.db.commit()
        with self.assertRaises(ActionConflictError):
            confirm_action(self.db, action.action_id,
                ConfirmationRequest(user_id=self.aid, confirmation_id=action.confirmation_id))
        self.assert_unlinked()

    def test_arguments_tampered_after_confirmation_do_not_use_old_approval(self):
        action = self.plan()
        action.arguments = dict(action.arguments, ongoing_activity_id=str(uuid4()))
        self.db.commit()
        self.execute(action, expected="failed")
        self.assert_unlinked()

    def test_wrong_confirmation_id_cannot_approve(self):
        action = self.plan(confirm=False)
        with self.assertRaises(ActionConfirmationError):
            confirm_action(self.db, action.action_id, ConfirmationRequest(user_id=self.aid, confirmation_id=uuid4()))
        self.assert_unlinked()

    def test_input_rejects_missing_invalid_self_pair_and_extra_fields(self):
        for data in ({}, dict(ongoing_activity_id="invalid", completion_activity_id=self.completion.id),
                     dict(ongoing_activity_id=self.ongoing.id, completion_activity_id=self.ongoing.id),
                     dict(ongoing_activity_id=self.ongoing.id, completion_activity_id=self.completion.id, user_id=self.bid)):
            with self.subTest(data_keys=sorted(data)):
                with self.assertRaises(ValidationError):
                    LinkActivityCompletionArguments.model_validate(data)

    def test_pair_arguments_are_restricted_to_execute_tool(self):
        for intent, mode in (("record_daily_trace", "record"), ("link_activity_completion", "record")):
            with self.assertRaises(ValidationError):
                GatewayAction(type="daily_life", intent=intent, mode=mode, reason="synthetic", confidence=.9,
                    requires_confirmation=False, execution_order=1,
                    arguments=dict(ongoing_activity_id=self.ongoing.id, completion_activity_id=self.completion.id))

    def test_reversed_status_pair_is_rejected(self):
        self.execute(self.plan(ongoing=self.completion, completion=self.ongoing), expected="failed")
        self.assert_unlinked()

    def test_general_performed_report_is_not_completion(self):
        completion = self.seed("공부했어")
        self.execute(self.plan(completion=completion), expected="failed")
        self.assertNotIn(LINK_KEY, completion.metadata_)

    def test_negative_question_ambiguous_and_intended_source_cannot_link(self):
        for text in ("공부 안 마쳤어", "공부 마쳤어?", "그거 끝났어", "공부 완료할 거야"):
            source = self.db.get(Message, self.completion.message_id)
            source.content = text
            self.db.commit()
            self.execute(self.plan(), expected="failed")
            self.assert_unlinked()

    def test_foreign_account_target_is_rejected(self):
        other = self.seed("공부하고 있어", user_id=self.bid, conversation=self.cb)
        self.execute(self.plan(ongoing=other), expected="failed")
        self.assert_unlinked()

    def test_cross_conversation_same_owner_is_rejected(self):
        other_conversation = Conversation(user_id=self.aid)
        self.db.add(other_conversation)
        self.db.commit()
        other = self.seed("공부하고 있어", conversation=other_conversation)
        self.execute(self.plan(ongoing=other), expected="failed")
        self.assert_unlinked()

    def test_account_deactivated_after_approval_blocks_execution(self):
        action = self.plan()
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        with self.assertRaises(executor_service.ExecutorDatabaseError):
            executor_service.execute_action(action.action_id, self.aid)
        self.assert_unlinked()

    def test_deleted_conversation_blocks_execution(self):
        action = self.plan()
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        with self.assertRaises(executor_service.ExecutorNotFoundError):
            executor_service.execute_action(action.action_id, self.aid)
        self.assert_unlinked()

    def test_message_author_mismatch_blocks_link(self):
        action = self.plan()
        self.db.get(Message, self.ongoing.message_id).user_id = self.bid
        self.db.commit()
        self.execute(action, expected="failed")
        self.assert_unlinked()

    def test_source_action_parent_mismatch_blocks_link(self):
        action = self.plan()
        self.db.get(AgentAction, self.ongoing.agent_action_id).conversation_id = self.cb.id
        self.db.commit()
        self.execute(action, expected="failed")
        self.assert_unlinked()

    def test_missing_activity_blocks_link(self):
        action = self.plan()
        self.db.delete(self.ongoing)
        self.db.commit()
        self.execute(action, expected="failed")
        self.assert_unlinked()

    def test_damaged_metadata_and_provenance_are_rejected(self):
        original = deepcopy(self.completion.metadata_)
        for metadata in ([], {}, dict(original, evidence={"summary": "PRIVATE_METADATA"}),
                         dict(original, time_issues=["PRIVATE_METADATA"])):
            self.completion.metadata_ = metadata
            self.db.commit()
            self.execute(self.plan(), expected="failed")
            self.assert_unlinked()
            self.assertEqual(self.completion.metadata_, metadata)

    def test_existing_corrupt_link_is_not_overwritten(self):
        self.completion.metadata_ = {**self.completion.metadata_, LINK_KEY: {"PRIVATE_METADATA": "invalid"}}
        self.db.commit()
        before = deepcopy(self.completion.metadata_)
        self.execute(self.plan(), expected="failed")
        self.assertEqual(self.completion.metadata_, before)

    def test_different_ongoing_cannot_replace_existing_link(self):
        self.execute(self.plan())
        before = deepcopy(self.link())
        other = self.seed("공부하고 있어")
        self.execute(self.plan(ongoing=other), expected="failed")
        self.assertEqual(self.link(), before)

    def test_second_completion_cannot_claim_same_ongoing(self):
        self.execute(self.plan())
        other = self.seed("공부 완료했어")
        self.execute(self.plan(completion=other), expected="failed")
        self.assertNotIn(LINK_KEY, other.metadata_)

    def test_unknown_times_are_not_derived_from_message_or_confirmation_time(self):
        self.execute(self.plan())
        for row in (self.ongoing, self.completion):
            self.assertEqual((row.start_time, row.end_time, row.duration_minutes), (None, None, None))

    def test_conflicting_explicit_dates_are_rejected(self):
        ongoing = self.seed("2026-10-08 공부하고 있어")
        completion = self.seed("2026-10-07 공부 마쳤어")
        self.execute(self.plan(ongoing=ongoing, completion=completion), expected="failed")
        self.assertNotIn(LINK_KEY, completion.metadata_)

    def test_conflicting_explicit_same_day_clocks_are_rejected(self):
        ongoing = self.seed("2026-10-08 17시부터 공부하고 있어")
        completion = self.seed("2026-10-08 15시에 공부 마쳤어")
        self.execute(self.plan(ongoing=ongoing, completion=completion), expected="failed")
        self.assertNotIn(LINK_KEY, completion.metadata_)

    def test_future_completion_report_not_linked_as_current_fact(self):
        completion = self.seed("내일 공부 완료했어")
        # SQLite 원문 timestamp에는 zone이 없으므로 unknown을 명시한 기존 time_issues를 검사합니다.
        # 실제 future_activity_date가 확인되는 분석을 합성 관찰 시점으로 재현합니다.
        from agent.behavior_schemas import BehaviorContext
        from agent.activity_recorder import analyze_activity
        from agent.activity_lifecycle_service import link_activity_completion
        before = analyze_activity(BehaviorContext(current_utterance="공부하고 있어")).activities[0]
        after = analyze_activity(BehaviorContext(current_utterance="내일 공부 완료했어",
            observed_at=datetime(2026, 10, 8, tzinfo=timezone.utc))).activities[0]
        self.assertIn("future_activity_date", after.time_issues)
        action = self.plan(completion=completion)
        pair = LinkActivityCompletionArguments.model_validate(action.arguments)
        with patch("agent.activity_lifecycle_service._validated_report", side_effect=[before, after]):
            with self.assertRaises(ActivityLinkError):
                link_activity_completion(self.db, action, pair)
        self.assertNotIn(LINK_KEY, completion.metadata_)

    def test_sensitive_source_and_error_text_are_not_logged(self):
        source = self.db.get(Message, self.completion.message_id)
        source.content = "공부 마쳤어. password=SyntheticPassword987 token=SyntheticToken987"
        self.db.commit()
        action = self.plan()
        output = StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            result = self.execute(action, expected="failed")
        for marker in (source.content, "SyntheticPassword987", "SyntheticToken987", str(source.id), str(self.aid)):
            self.assertNotIn(marker, output.getvalue())
            self.assertNotIn(marker, str(result.action.result))
            self.assertNotIn(marker, result.action.error_message)
        self.assert_unlinked()

    def test_before_commit_failure_rolls_back_then_retry_succeeds(self):
        action = self.plan()
        original = linking.link_activity_completion_executor
        def failing(context):
            def fail():
                raise RuntimeError("PRIVATE_ROLLBACK_ERROR")
            return original(context, before_commit=fail)
        with patch("agent.executor_service.get_executor", return_value=failing):
            result = self.execute(action, expected="failed")
        self.assertNotIn("PRIVATE_ROLLBACK_ERROR", result.action.error_message)
        self.assert_unlinked()
        self.execute(action)
        self.assertIsNotNone(self.link())

    def test_finalize_loss_retry_reuses_committed_link(self):
        action = self.plan()
        with patch.object(executor_service, "_finish_success", side_effect=RuntimeError("PRIVATE_FINALIZE_ERROR")):
            self.execute(action, expected="failed")
        before = deepcopy(self.link())
        result = self.execute(action)
        self.assertTrue(result.action.result["data"]["reused"])
        self.assertEqual(self.link(), before)

    def test_stale_attempt_cannot_write(self):
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, self.aid)
        self.db.expire_all()
        self.db.get(AgentAction, action.id).attempt_count += 1
        self.db.commit()
        with self.assertRaises(ActivityLinkError):
            linking.link_activity_completion_executor(ExecutorContext(str(action.action_id), str(self.aid),
                "link_activity_completion", lease.attempt_count))
        self.assert_unlinked()

    def test_flag_off_has_no_link_write(self):
        action = self.plan()
        with patch.dict("os.environ", {"NOIE_ACTIVITY_RECORDER_ENABLED": "false"}):
            self.execute(action, expected="failed")
        self.assert_unlinked()

    def test_pair_lock_order_and_postgres_for_update_contract(self):
        pair = LinkActivityCompletionArguments(ongoing_activity_id=self.ongoing.id,
                                               completion_activity_id=self.completion.id)
        db = Mock()
        ordered = sorted((self.ongoing, self.completion), key=lambda row: row.id)
        db.scalar.side_effect = ordered
        self.assertEqual(lock_activity_pair(db, self.aid, pair), (self.ongoing, self.completion))
        for call, row in zip(db.scalar.call_args_list, ordered):
            compiled = call.args[0].compile(dialect=postgresql.dialect())
            self.assertTrue(str(compiled).endswith("FOR UPDATE"))
            self.assertIn(row.id, compiled.params.values())
            self.assertIn(self.aid, compiled.params.values())

    def test_simultaneous_requests_with_simulated_db_serialization_keep_one_link(self):
        """SQLite row lock 증거가 아닙니다. 두 승인 요청의 직렬화된 충돌 처리를 모델링합니다."""
        other = self.seed("공부 완료했어")
        actions = (self.plan(), self.plan(completion=other))
        leases = [executor_service._acquire_lease(action.action_id, self.aid)[1] for action in actions]
        gate, ready = Lock(), Barrier(2)
        @contextmanager
        def serialized_factory():
            with gate:
                with self.factory() as db:
                    yield db
        def run(index):
            ready.wait(timeout=10)
            action, lease = actions[index], leases[index]
            try:
                linking.link_activity_completion_executor(ExecutorContext(str(action.action_id), str(self.aid),
                    "link_activity_completion", lease.attempt_count))
                return "linked"
            except ActivityLinkError:
                return "conflict"
        with patch.object(linking, "SessionLocal", serialized_factory), ThreadPoolExecutor(max_workers=2) as workers:
            outcomes = list(workers.map(run, (0, 1)))
        self.db.expire_all()
        self.assertCountEqual(outcomes, ("linked", "conflict"))
        rows = list(self.db.scalars(select(Activity)))
        self.assertEqual(sum(LINK_KEY in row.metadata_ for row in rows), 1)

    def test_existing_activity_read_contract_does_not_expose_link_metadata(self):
        self.execute(self.plan())
        response = self.client.get("/activities")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(LINK_KEY, response.text)
        self.assertNotIn("confirmation_action_id", response.text)


if __name__ == "__main__":
    unittest.main()
