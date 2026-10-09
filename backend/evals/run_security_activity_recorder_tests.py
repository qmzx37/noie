"""합성 SQLite에서 기존 Gateway/Executor 경로와 Activity 소유권·삭제·rollback을 검사합니다."""

from contextlib import ExitStack, redirect_stdout, redirect_stderr
from datetime import datetime, timezone
from io import StringIO
import importlib
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import CheckConstraint, MetaData, PrimaryKeyConstraint, UniqueConstraint, delete, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from auth_context import AuthPrincipal
from database import Base
from agent.action_schemas import PersistActionPlanRequest
from agent.action_service import ActionValidationError, persist_action_plan
from agent.activity_service import activity_recorder_enabled
from agent.executor_registry import ExecutorContext
from agent import executor_service
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from models.activity import Activity
from models.agent_action import AgentAction
from models.message import Message
from evals import run_security_account_deletion_tests as fixture
import account_lifecycle_service as lifecycle


class ActivityOwnershipTests(unittest.TestCase):
    """운영 DB/인증/모델은 호출하지 않고 기존 FK 활성 합성 fixture만 재사용합니다."""

    def setUp(self):
        """서로 다른 계정을 가진 fixture로 기존 lease/fencing/executor를 검사합니다."""
        fixture.AccountDeletionTests.setUp(self)
        self.ma.content = "15시부터 17시까지 NOIE 개발했어"
        self.mb.content = "운동했어"
        self.db.commit()
        self.stack = ExitStack()
        self.stack.enter_context(patch.dict(os.environ, {"NOIE_ACTIVITY_RECORDER_ENABLED": "true", "NOIE_SCHEDULE_TIMEZONE": "Asia/Seoul"}))
        self.daily = importlib.import_module("agent.record_daily_trace_executor")
        self.factory = sessionmaker(self.engine, expire_on_commit=False)
        self.stack.enter_context(patch.object(self.daily, "SessionLocal", self.factory))
        self.stack.enter_context(patch.object(executor_service, "SessionLocal", self.factory))

    def tearDown(self):
        """테스트 override와 합성 데이터만 정리합니다."""
        self.stack.close()
        fixture.AccountDeletionTests.tearDown(self)

    def count(self, model=Activity):
        """검사 대상 실제 합성 행 수입니다."""
        return self.db.scalar(select(func.count()).select_from(model))

    def plan(self, message=None, *, user_id=None):
        """새 framework 없이 실제 Gateway 정책과 Action persistence를 사용합니다."""
        message = message or self.ma
        owner = user_id or message.user_id
        response = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(
            type="daily_life", intent="record_daily_trace", mode="record", action_id=uuid4(),
            reason="합성 생활 보고", confidence=.9, requires_confirmation=False, execution_order=1,
            arguments={"summary": "합성 일상 기록", "category": "activity"},
        )]))
        self.assertEqual(response.plans[0].status, "ready")
        return persist_action_plan(self.db, PersistActionPlanRequest(user_id=owner,
            conversation_id=message.conversation_id, message_id=message.id, plans=response.plans))[0]

    def execute(self, action):
        """기존 lease -> 실제 Daily Tool -> finalize 경로를 실행합니다."""
        result = executor_service.execute_action(action.action_id, action.user_id)
        self.assertEqual(result.action.status, "completed")
        self.db.expire_all()
        return result

    def stored(self):
        """첫 Activity는 provenance가 포함된 내부 ORM 객체입니다."""
        return self.db.scalar(select(Activity).order_by(Activity.record_index))

    def test_gateway_executor_persists_original_provenance(self):
        raw = self.ma.content
        result = self.execute(self.plan())
        row = self.stored()
        self.assertEqual((row.action, row.status, row.duration_minutes), ("NOIE 개발", "performed", 120))
        self.assertEqual(row.metadata_["evidence"]["summary"], raw)
        self.assertEqual(row.metadata_["evidence"]["evidence_ref"], str(self.ma.id))
        self.assertEqual(row.message_id, self.ma.id)
        self.assertIsNone(row.confidence)
        self.assertEqual(self.db.get(Message, self.ma.id).content, raw)
        self.assertEqual(result.action.result["outcome"], "daily_trace_recorded")

    def test_same_completed_action_does_not_execute_or_duplicate(self):
        action = self.plan()
        self.execute(action)
        again = self.execute(action)
        self.assertFalse(again.executor_called)
        self.assertEqual(self.count(), 1)

    def test_same_message_new_action_does_not_duplicate(self):
        self.execute(self.plan())
        before = self.stored().id
        self.execute(self.plan())
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.stored().id, before)

    def test_same_text_new_message_records_new_activity(self):
        self.execute(self.plan())
        other = Message(user_id=self.aid, conversation_id=self.ca.id, role="user", content=self.ma.content)
        self.db.add(other); self.db.commit()
        self.execute(self.plan(other))
        self.assertEqual(self.count(), 2)

    def test_multiple_reports_have_stable_indexes(self):
        self.ma.content = "운동했어. 공부했어."
        self.db.commit()
        self.execute(self.plan()); self.execute(self.plan())
        self.assertEqual(self.count(), 2)
        self.assertEqual(list(self.db.scalars(select(Activity.record_index).order_by(Activity.record_index))), [0, 1])

    def test_ongoing_not_performed(self):
        self.ma.content = "지금 개발하고 있어"
        self.db.commit()
        self.execute(self.plan())
        row = self.stored()
        self.assertEqual(row.status, "ongoing")
        self.assertEqual((row.end_time, row.duration_minutes), (None, None))

    def test_completion_report_persists_original_and_reuses_same_message(self):
        self.ma.content = "오후 5시에 공부 완료했어"
        self.db.commit()
        action = self.plan()
        self.execute(action)
        row = self.stored()
        row_id = row.id
        self.assertEqual((row.action, row.status), ("공부", "performed"))
        self.assertEqual(row.end_time.isoformat(), "17:00:00")
        self.assertEqual((row.start_time, row.duration_minutes, row.confidence), (None, None, None))
        self.assertEqual(row.metadata_["evidence"]["summary"], self.ma.content)
        self.assertEqual(self.db.get(Message, self.ma.id).content, "오후 5시에 공부 완료했어")
        self.execute(action)
        self.execute(self.plan())
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.stored().id, row_id)

    def test_completion_report_new_message_not_text_deduplicated(self):
        self.ma.content = "공부 마쳤어"
        self.db.commit()
        self.execute(self.plan())
        other = Message(user_id=self.aid, conversation_id=self.ca.id, role="user", content=self.ma.content)
        self.db.add(other)
        self.db.commit()
        self.execute(self.plan(other))
        self.assertEqual(self.count(), 2)

    def test_completion_report_preserves_previous_ongoing(self):
        self.ma.content = "지금 개발하고 있어"
        self.db.commit()
        self.execute(self.plan())
        ongoing_id = self.stored().id
        other = Message(user_id=self.aid, conversation_id=self.ca.id, role="user", content="개발 마쳤어")
        self.db.add(other)
        self.db.commit()
        self.execute(self.plan(other))
        self.assertEqual(self.count(), 2)
        ongoing = self.db.get(Activity, ongoing_id)
        self.assertEqual((ongoing.status, ongoing.end_time, ongoing.duration_minutes), ("ongoing", None, None))
        completed = self.db.scalar(select(Activity).where(Activity.message_id == other.id))
        self.assertEqual(completed.status, "performed")

    def test_completion_report_before_commit_failure_rolls_back(self):
        from models.daily_life_event import DailyLifeEvent
        self.ma.content = "공부 완료했어"
        self.db.commit()
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, action.user_id)
        context = ExecutorContext(str(action.action_id), str(action.user_id), action.tool_name, lease.attempt_count)
        def fail():
            raise RuntimeError("PRIVATE_COMPLETION_FAILURE")
        with self.assertRaises(RuntimeError):
            self.daily.record_daily_trace_executor(context, before_commit=fail)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.count(DailyLifeEvent), 0)
        self.assertEqual(self.db.get(Message, self.ma.id).content, "공부 완료했어")

    def test_completion_report_cross_account_source_rejected(self):
        self.mb.content = "공부 완료했어"
        self.db.commit()
        with self.assertRaises(ActionValidationError):
            self.plan(self.mb, user_id=self.aid)
        self.assertEqual(self.count(), 0)

    def test_intention_desire_candidate_negative_never_stored(self):
        for text in ("내일 운동할 거야", "운동하고 싶어", "운동할까 개발할까?", "운동 안 했어", "파이썬 리스트가 뭐야?"):
            self.ma.content = text; self.db.commit()
            self.execute(self.plan())
        self.assertEqual(self.count(), 0)

    def test_unknown_times_and_confidence_stored_null(self):
        self.ma.content = "오늘 운동했어"; self.db.commit()
        self.execute(self.plan())
        row = self.stored()
        self.assertEqual((row.start_time, row.end_time, row.duration_minutes, row.confidence), (None, None, None, None))

    def test_duration_conflict_survives_persistence(self):
        self.ma.content = "15시부터 17시까지 3시간 개발했어"; self.db.commit()
        self.execute(self.plan())
        row = self.stored()
        self.assertIsNone(row.duration_minutes)
        self.assertEqual(row.metadata_["reported_duration_minutes"], 180)
        self.assertEqual(row.metadata_["calculated_duration_minutes"], 120)
        self.assertIn("duration_conflict", row.metadata_["time_issues"])

    def test_before_commit_failure_rolls_back_activity_and_daily(self):
        from models.daily_life_event import DailyLifeEvent
        def fail():
            """새 row가 생긴 뒤 commit 전 오류를 재현합니다."""
            raise RuntimeError("PRIVATE_FAILURE")
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, action.user_id)
        context = ExecutorContext(str(action.action_id), str(action.user_id), action.tool_name, lease.attempt_count)
        with self.assertRaises(RuntimeError):
            self.daily.record_daily_trace_executor(context, before_commit=fail)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.count(DailyLifeEvent), 0)

    def test_activity_failure_rolls_back_unit_without_error_payload(self):
        from models.daily_life_event import DailyLifeEvent
        action = self.plan()
        with patch.object(self.daily, "persist_activity_for_action", side_effect=SQLAlchemyError("PRIVATE_DATABASE_URL")):
            outcome = executor_service.execute_action(action.action_id, action.user_id)
        self.assertEqual(outcome.action.status, "failed")
        self.assertNotIn("PRIVATE_DATABASE_URL", outcome.action.error_message)
        self.assertEqual(self.count(), 0); self.assertEqual(self.count(DailyLifeEvent), 0)

    def test_finalize_loss_retry_reuses_committed_activity(self):
        action = self.plan()
        with patch.object(executor_service, "_finish_success", side_effect=RuntimeError("PRIVATE_FINALIZE_FAILURE")):
            failed = executor_service.execute_action(action.action_id, action.user_id)
        self.assertEqual(failed.action.status, "failed")
        self.assertEqual(self.count(), 1)
        first_id = self.stored().id
        self.execute(action)
        self.assertEqual(self.count(), 1); self.assertEqual(self.stored().id, first_id)

    def test_stale_attempt_does_not_write(self):
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, action.user_id)
        self.db.expire_all()
        self.db.get(AgentAction, action.id).attempt_count += 1
        self.db.commit()
        context = ExecutorContext(str(action.action_id), str(action.user_id), action.tool_name, lease.attempt_count)
        with self.assertRaises(self.daily.RecordDailyTraceError):
            self.daily.record_daily_trace_executor(context)
        self.assertEqual(self.count(), 0)

    def test_activity_flag_default_invalid_and_off_preserve_daily(self):
        from models.daily_life_event import DailyLifeEvent
        for value in ("", "false", "invalid"):
            with patch.dict(os.environ, {"NOIE_ACTIVITY_RECORDER_ENABLED": value}), patch.object(self.daily, "persist_activity_for_action") as recorder:
                self.execute(self.plan())
                recorder.assert_not_called()
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.count(DailyLifeEvent), 3)

    def test_feature_flag_truth_values(self):
        for value in ("1", " true ", "YES", "On"):
            with patch.dict(os.environ, {"NOIE_ACTIVITY_RECORDER_ENABLED": value}):
                self.assertTrue(activity_recorder_enabled())

    def test_get_owner_minimal_no_provenance_or_raw_uuid(self):
        self.execute(self.plan())
        response = self.client.get("/activities")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        for marker in ("metadata", "evidence", "user_id", "message_id", "agent_action_id", "conversation_id", self.ma.content, str(self.ma.id)):
            self.assertNotIn(marker, response.text)

    def test_get_cross_account_and_nonexistent_same_404(self):
        self.execute(self.plan()); row_id = self.stored().id
        self.principal = AuthPrincipal(self.bid)
        self.assertEqual(self.client.get(f"/activities/{row_id}").status_code, 404)
        self.assertEqual(self.client.get(f"/activities/{uuid4()}").status_code, 404)
        self.assertEqual(self.client.get("/activities").json(), [])

    def test_b_own_activity_not_mixed(self):
        self.execute(self.plan()); self.execute(self.plan(self.mb))
        self.principal = AuthPrincipal(self.bid)
        response = self.client.get("/activities")
        self.assertEqual([row["action"] for row in response.json()], ["운동"])

    def test_anonymous_even_auth_off_no_db_read(self):
        self.principal = None
        with patch.dict(os.environ, {"NOIE_AUTH_ENABLED": "false"}), patch("agent.activity_router.read_activities") as read:
            self.assertEqual(self.client.get("/activities").status_code, 401)
            read.assert_not_called()

    def test_invalid_id_and_page_bounds(self):
        for path in ("/activities/not-a-uuid", "/activities?limit=0", "/activities?limit=101"):
            self.assertEqual(self.client.get(path).status_code, 422)

    def test_deleted_account_no_read_or_late_write(self):
        action = self.plan()
        _, lease = executor_service._acquire_lease(action.action_id, action.user_id)
        lifecycle.deactivate_account(self.db, self.principal)
        context = ExecutorContext(str(action.action_id), str(action.user_id), action.tool_name, lease.attempt_count)
        with self.assertRaises(self.daily.RecordDailyTraceError):
            self.daily.record_daily_trace_executor(context)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.client.get("/activities").status_code, 404)

    def test_deleted_conversation_no_read(self):
        self.execute(self.plan())
        self.ca.deleted_at = datetime.now(timezone.utc); self.db.commit()
        self.assertEqual(self.client.get(f"/activities/{self.stored().id}").status_code, 404)

    def test_rebound_action_parent_not_readable(self):
        """기존/비정상 FK가 다른 계정 대화를 가리켜도 반환하지 않습니다."""
        action = self.plan()
        self.execute(action)
        row_id = self.stored().id
        self.db.get(AgentAction, action.id).conversation_id = self.cb.id
        self.db.commit()
        self.assertEqual(self.client.get(f"/activities/{row_id}").status_code, 404)
        self.assertEqual(self.client.get("/activities").json(), [])

    def test_assistant_system_not_sources(self):
        for role in ("assistant", "system"):
            source = Message(user_id=None, role=role, conversation_id=self.ca.id, content="운동했어")
            self.db.add(source); self.db.commit()
            # 기존 공통 Action은 assistant/system 소유권도 인정합니다. 사용자 보고 여부는 Daily Tool이 거부합니다.
            action = self.plan(source, user_id=self.aid)
            result = executor_service.execute_action(action.action_id, self.aid)
            self.assertEqual(result.action.status, "failed")
        self.assertEqual(self.count(), 0)

    def test_cross_account_plan_blocked(self):
        with self.assertRaises(ActionValidationError):
            self.plan(self.mb, user_id=self.aid)
        self.assertEqual(self.count(), 0)

    def test_privacy_restricted_no_activity_or_log(self):
        self.ma.content = "운동했어. password=SuperSecret987"; self.db.commit()
        logs = StringIO()
        with redirect_stdout(logs), redirect_stderr(logs):
            self.execute(self.plan())
        self.assertEqual(self.count(), 0)
        self.assertNotIn("SuperSecret987", logs.getvalue())

    def test_database_read_failure_safe_and_rollback(self):
        with patch.object(self.db, "scalar", side_effect=SQLAlchemyError("PRIVATE_DATABASE_URL")), patch.object(self.db, "rollback", wraps=self.db.rollback) as rollback:
            response = self.client.get("/activities")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("PRIVATE_DATABASE_URL", response.text)
        rollback.assert_called_once()

    def test_malformed_stored_metadata_no_error_echo(self):
        self.execute(self.plan())
        row = self.stored(); row.metadata_ = {"time_issues": ["PRIVATE_METADATA"]}; self.db.commit()
        response = self.client.get("/activities")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("PRIVATE_METADATA", response.text)

    def test_readonly_api_does_not_commit_or_modify(self):
        self.execute(self.plan())
        before = self.count()
        with patch.object(self.db, "commit", side_effect=AssertionError("UNEXPECTED_WRITE")), patch.object(self.db, "flush", side_effect=AssertionError("UNEXPECTED_WRITE")):
            self.assertEqual(self.client.get("/activities").status_code, 200)
        self.assertEqual(self.count(), before)

    def test_source_fk_restrict_and_explicit_purge_inventory(self):
        self.execute(self.plan()); self.execute(self.plan(self.mb))
        with self.assertRaises(IntegrityError):
            self.db.execute(delete(Message).where(Message.id == self.ma.id)); self.db.commit()
        self.db.rollback()
        lifecycle.validate_inventory()
        lifecycle.deactivate_account(self.db, self.principal)
        self.assertEqual(lifecycle.purge_deleted_account(self.db, self.aid), "purged")
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.stored().user_id, self.bid)

    def test_unique_conflict_sql_for_race_boundary(self):
        from sqlalchemy.dialects.postgresql import insert
        sql = str(insert(Activity).values(record_index=0).on_conflict_do_nothing(
            index_elements=[Activity.message_id, Activity.record_index]).compile(dialect=postgresql.dialect()))
        self.assertIn("ON CONFLICT (message_id, record_index) DO NOTHING", sql)
        self.assertTrue(any(c.name == "uq_activities_message_record" for c in Activity.__table__.constraints))


class ActivityMigrationTests(unittest.TestCase):
    """실제 DB 연결 없이 PostgreSQL SQL과 model/migration 구조를 비교합니다."""

    def test_model_migration_exact_structure(self):
        migration = importlib.import_module("migrations.versions.20261008_0021_add_activities")
        class Capture:
            """Alembic 정의를 SQLAlchemy Table로 받아 타입/제약을 실제 모델과 대조합니다."""
            def __init__(self):
                self.meta = MetaData()
                self.indexes = {}
            def create_table(self, name, *items):
                from sqlalchemy import Table
                self.table = Table(name, self.meta, *items)
            def create_index(self, name, table, columns):
                self.indexes[name] = tuple(columns)
        capture = Capture()
        with patch.object(migration, "op", capture):
            migration.upgrade()
        expected = Activity.__table__
        def columns(table):
            """DB 타입, NULL 정책과 DB default를 같은 dialect로 비교합니다."""
            return {c.name: (str(c.type.compile(dialect=postgresql.dialect())), c.nullable,
                str(c.server_default.arg) if c.server_default is not None else None) for c in table.columns}
        self.assertEqual(columns(capture.table), columns(expected))
        self.assertEqual({c.name: str(c.sqltext) for c in capture.table.constraints if isinstance(c, CheckConstraint)},
                         {c.name: str(c.sqltext) for c in expected.constraints if isinstance(c, CheckConstraint)})
        self.assertEqual({fk.name: (fk.ondelete, tuple(e.target_fullname for e in fk.elements)) for fk in capture.table.foreign_key_constraints},
                         {fk.name: (fk.ondelete, tuple(e.target_fullname for e in fk.elements)) for fk in expected.foreign_key_constraints})
        self.assertEqual(capture.indexes, {i.name: tuple(c.name for c in i.columns) for i in expected.indexes})
        def keys(table):
            """UNIQUE/PK의 이름과 컬럼도 migration drift 비교에 포함합니다."""
            return {c.name: (type(c).__name__, tuple(column.name for column in c.columns))
                for c in table.constraints if isinstance(c, (PrimaryKeyConstraint, UniqueConstraint))}
        self.assertEqual(keys(capture.table), keys(expected))
        self.assertEqual(migration.down_revision, "20261006_0020")

    def test_offline_sql_upgrade_no_network(self):
        from alembic.config import Config
        from alembic import command
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        output = StringIO()
        config = Config(str(root / "alembic.ini"), output_buffer=output)
        config.set_main_option("script_location", str(root / "migrations"))
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql+psycopg://offline:offline@invalid/offline"}), redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            command.upgrade(config, "20261006_0020:head", sql=True)
        sql = output.getvalue()
        self.assertIn("CREATE TABLE activities", sql)
        self.assertIn("TIMESTAMP WITH TIME ZONE", sql)
        self.assertIn("UNIQUE (message_id, record_index)", sql)
        self.assertIn("ON DELETE RESTRICT", sql)
        self.assertNotIn("CREATE TABLE messages", sql)


if __name__ == "__main__":
    unittest.main()
