"""Object-only PostgreSQL runner. Default is read-only; never cleans up schemas."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager, redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from io import StringIO
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from threading import Event, local
import time
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from evals.run_activity_lifecycle_pg import (
    CONTAINER, DATABASE, HOST, PORT, USER, SafeParser, SafetyStop, check_container, check_url, docker_read,
)


BACKEND = Path(__file__).resolve().parents[1]
REVISION = "20261009_0022"
SCHEMA_PATTERN = re.compile(r"noie_object_pgtest_[0-9a-f]{32}\Z")
ACK = "NOIE_OBJECT_PG_WRITE_ACK"
SCHEMA_ENV = "NOIE_OBJECT_PG_SCHEMA"


def check_schema(schema):
    if not isinstance(schema, str) or not SCHEMA_PATTERN.fullmatch(schema):
        raise SafetyStop("SCHEMA_DENIED")
    return schema


def options(schema=None, *, readonly=False):
    return (("-c search_path=" + check_schema(schema) + " ") if schema else "") + (
        "-c statement_timeout=15000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=20000"
    ) + (" -c default_transaction_read_only=on" if readonly else "")


def child_environment(source, url, schema, writes):
    env = {key: value for key, value in source.items()
           if not key.startswith(("DATABASE_", "OPENAI_", "SUPABASE_", "NOIE_", "PG"))
           and key not in {"PYTHONPATH", "PYTHONHOME"}}
    scoped = url.update_query_dict({"options": options(schema)})
    env.update(PYTHON_DOTENV_DISABLED="1", PYTHONDONTWRITEBYTECODE="1", OPENAI_API_KEY="",
               DATABASE_URL=scoped.render_as_string(hide_password=False) if writes else "",
               NOIE_SECURITY_TEST_DATABASE_URL=url.render_as_string(hide_password=False),
               NOIE_OBJECT_PG_SCHEMA=check_schema(schema), NOIE_OBJECT_PG_WRITE_ACK="yes" if writes else "no",
               NOIE_ACTIVITY_RECORDER_ENABLED="true", NOIE_OBJECT_MENTION_ENABLED="true",
               NOIE_AUTH_ENABLED="true", NOIE_RATE_LIMIT_ENABLED="false",
               NOIE_LV4_SHADOW_ENABLED="false", NOIE_SCHEDULE_TIMEZONE="Asia/Seoul")
    return env


def test_engine(url, schema=None, *, readonly=False):
    return create_engine(url, poolclass=NullPool, isolation_level="READ COMMITTED",
                         connect_args={"connect_timeout": 5, "sslmode": "disable",
                                       "options": options(schema, readonly=readonly)})


def migration_config():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    config = Config()
    config.set_main_option("script_location", str(BACKEND / "evals" / "object_pg_migrations"))
    config.set_main_option("version_locations", str(BACKEND / "migrations" / "versions"))
    config.set_main_option("path_separator", "os")
    scripts = ScriptDirectory.from_config(config)
    revisions = list(scripts.walk_revisions())
    if (scripts.get_heads() != [REVISION] or len(revisions) != 22
            or scripts.get_revision(REVISION).down_revision != "20261008_0021"):
        raise SafetyStop("MIGRATION_GRAPH_CHANGED")
    return config


def preflight(url, schema):
    check_schema(schema)
    migration_config()
    container_id = check_container()
    fingerprint = docker_read("exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", CONTAINER,
        "psql", "-XAt", "--no-password", "-U", USER, "--dbname", DATABASE,
        "--command", "SELECT pg_postmaster_start_time()::text")
    engine = test_engine(url, readonly=True)
    try:
        with engine.connect() as db:
            row = db.execute(text("SELECT current_database(), current_user, pg_postmaster_start_time()::text, "
                "current_setting('transaction_read_only'), current_setting('server_version_num')::int, "
                "has_database_privilege(current_user, current_database(), 'CREATE'), "
                "to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL")).one()
            if (tuple(row[:4]) != (DATABASE, USER, fingerprint, "on") or row[4] < 130000
                    or not row[5] or not row[6]):
                raise SafetyStop("DATABASE_IDENTITY_DENIED")
            if db.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=:schema)"),
                         {"schema": schema}):
                raise SafetyStop("SCHEMA_ALREADY_EXISTS")
    finally:
        engine.dispose()
    if check_container() != container_id:
        raise SafetyStop("CONTAINER_CHANGED")
    return container_id


def migrate(url, schema, container_id):
    from alembic import command
    if os.environ.get(ACK) != "yes" or check_container() != container_id:
        raise SafetyStop("MIGRATION_GUARD_DENIED")
    config = migration_config()
    engine = test_engine(url, schema=check_schema(schema))
    try:
        with engine.begin() as connection:
            if connection.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=:schema)"),
                                 {"schema": schema}):
                raise SafetyStop("SCHEMA_ALREADY_EXISTS")
            connection.execute(text('CREATE SCHEMA "' + schema + '"'))
            config.attributes.update(connection=connection, test_schema=schema, container_id=container_id)
            command.upgrade(config, REVISION)
            require(connection.scalar(text('SELECT version_num FROM "' + schema + '".alembic_version')) == REVISION)
            # All FK targets must remain in this newly created schema.
            require(connection.scalar(text("SELECT count(*) FROM pg_constraint c "
                "JOIN pg_class a ON a.oid=c.conrelid JOIN pg_namespace n ON n.oid=a.relnamespace "
                "JOIN pg_class b ON b.oid=c.confrelid JOIN pg_namespace m ON m.oid=b.relnamespace "
                "WHERE c.contype='f' AND n.nspname=:schema AND m.nspname<>:schema"), {"schema": schema}) == 0)
    finally:
        engine.dispose()


def require(condition):
    if not condition:
        raise SafetyStop("SCENARIO_ASSERTION_FAILED")


def run_scenarios(url, schema):
    """Independent sessions plus pg_blocking_pids, not a Python serialization lock."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session
    from unittest.mock import patch
    from fastapi import HTTPException
    from auth_context import AuthPrincipal
    import account_lifecycle_service as lifecycle
    from agent import executor_service as common, record_daily_trace_executor as daily
    from agent import save_object_mention_executor as saving, object_mention_service as service
    from agent.action_schemas import ConfirmationRequest, PersistActionPlanRequest
    from agent.action_service import ActionConflictError, persist_action_plan, confirm_action
    from agent.executor_registry import ExecutorContext
    from agent.tool_gateway import create_tool_plan
    from agent.tool_schemas import GatewayAction, ToolPlanRequest
    from models.activity import Activity
    from models.agent_action import AgentAction
    from models.conversation import Conversation
    from models.message import Message
    from models.object_mention import ObjectMention
    from models.user import User

    engine = test_engine(url, schema=check_schema(schema))
    worker, pids, results = local(), {}, []

    @contextmanager
    def factory():
        with engine.connect() as connection:
            require(connection.scalar(text("SELECT current_schema()")) == schema)
            require(connection.scalar(text("SELECT current_schemas(false)")) == [schema])
            pid = connection.scalar(text("SELECT pg_backend_pid()"))
            connection.rollback()
            if getattr(worker, "name", None):
                pids[worker.name] = pid
            with Session(bind=connection, expire_on_commit=False) as db:
                yield db

    def seed():
        with factory() as db:
            user = User(name="synthetic-object-pgtest")
            db.add(user); db.flush()
            conversation = Conversation(user_id=user.id)
            db.add(conversation); db.flush()
            message = Message(user_id=user.id, conversation_id=conversation.id, role="user",
                              content="NOIE \uac1c\ubc1c\ud588\uc5b4")
            db.add(message); db.commit()
            ids = user.id, conversation.id, message.id
            plans = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(type="daily_life",
                intent="record_daily_trace", mode="record", reason="synthetic source fixture", confidence=.9,
                requires_confirmation=False, execution_order=1,
                arguments={"summary": "synthetic daily", "category": "activity"})])).plans
            action = persist_action_plan(db, PersistActionPlanRequest(user_id=user.id,
                conversation_id=conversation.id, message_id=message.id, plans=plans))[0]
        require(common.execute_action(action.action_id, ids[0]).action.status == "completed")
        with factory() as db:
            activity = db.scalar(select(Activity).where(Activity.message_id == ids[2], Activity.record_index == 0))
            require(activity is not None)
            return (*ids, activity.id)

    def plan(ids, *, action_id=None, kind="project"):
        owner, conversation, message, activity = ids
        plans = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(action_id=action_id or uuid4(),
            type="object", intent="save_object_mention", mode="execute", reason="synthetic approved source",
            confidence=.9, requires_confirmation=False, execution_order=1,
            arguments={"activity_id": activity, "kind": kind, "label": "NOIE",
                       "source_span": {"start": 0, "end": 4}})])).plans
        with factory() as db:
            action = persist_action_plan(db, PersistActionPlanRequest(user_id=owner,
                conversation_id=conversation, message_id=message, plans=plans))[0]
            if action.status == "pending_confirmation":
                action = confirm_action(db, action.action_id,
                    ConfirmationRequest(user_id=owner, confirmation_id=action.confirmation_id))
            return action

    def count(action):
        with factory() as db:
            return len(list(db.scalars(select(ObjectMention.id).where(ObjectMention.agent_action_id == action.id))))

    def originals(ids):
        with factory() as db:
            return tuple(tuple(db.execute(select(model.__table__).where(model.__table__.c.id == pk)).one())
                         for model, pk in ((Message, ids[2]), (Activity, ids[3])))

    def invoke(name, lease, hook=None, *, finalize=True):
        worker.name = name
        try:
            try:
                result = saving.save_object_mention_executor(ExecutorContext(str(lease.action_id),
                    str(lease.user_id), lease.tool_name, lease.attempt_count), before_commit=hook)
            except service.ObjectMentionError as error:
                if finalize:
                    common._finish_failure(lease, error)
                return "rejected"
            if not finalize:
                return result
            _, fenced = common._finish_success(lease, result)
            require(not fenced)
            return "reused" if result.data["reused"] else "saved"
        finally:
            worker.name = None

    def wait_blocked(name, blocker):
        with engine.connect() as monitor:
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                pid = pids.get(name)
                if pid is not None and pid != blocker:
                    if blocker in monitor.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": pid}):
                        return
                time.sleep(.02)
        raise SafetyStop("REAL_LOCK_WAIT_NOT_OBSERVED")

    def competing(*, rollback=False):
        ids = seed()
        before, action = originals(ids), plan(ids)
        _, lease = common._acquire_lease(action.action_id, ids[0])
        held, release = Event(), Event()
        pids.clear()
        def hook():
            held.set()
            require(release.wait(8))
            if rollback:
                raise RuntimeError("synthetic rollback")
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(invoke, "first", lease, hook, finalize=False)
            try:
                require(held.wait(6))
                second = pool.submit(invoke, "second", lease, finalize=False)
                wait_blocked("second", pids["first"])
            finally:
                release.set()
            returned = first.result(timeout=15), second.result(timeout=15)
            outcomes = tuple("rejected" if item == "rejected" else
                             "reused" if item.data["reused"] else "saved" for item in returned)
        # Both workers share one valid lease to exercise the persistence boundary directly.
        require(outcomes == (("rejected", "saved") if rollback else ("saved", "reused")))
        _, fenced = common._finish_success(lease, returned[1])
        require(not fenced)
        require(count(action) == 1 and originals(ids) == before)
        replay = common.execute_action(action.action_id, ids[0])
        require(replay.action.status == "completed" and not replay.executor_called and count(action) == 1)
        results.append({"scenario": "rollback_waiter_retry" if rollback else "same_action_concurrent_save",
                        "status": "PASS", "real_lock_wait": True})

    try:
        with ExitStack() as stack:
            for module in (common, saving, daily):
                stack.enter_context(patch.object(module, "SessionLocal", factory))
            ids = seed()
            before, action = originals(ids), plan(ids)
            first = common.execute_action(action.action_id, ids[0])
            again = common.execute_action(action.action_id, ids[0])
            require(first.action.status == "completed" and not again.executor_called)
            require(first.action.result == again.action.result and count(action) == 1 and originals(ids) == before)
            with factory() as db:
                require(len(service.read_object_mentions(db, AuthPrincipal(ids[0]))) == 1)
            results.append({"scenario": "approved_save_duplicate_sources_immutable", "status": "PASS"})
            try:
                plan(ids, action_id=action.action_id, kind="thing")
            except ActionConflictError:
                require(count(action) == 1)
            else:
                raise SafetyStop("SCENARIO_ASSERTION_FAILED")
            results.append({"scenario": "same_action_changed_arguments_denied", "status": "PASS"})
            competing()
            competing(rollback=True)

            retry_ids = seed()
            retry_before, retry_action = originals(retry_ids), plan(retry_ids)
            def rollback_executor(context):
                def fail():
                    raise RuntimeError("synthetic rollback")
                return saving.save_object_mention_executor(context, before_commit=fail)
            with patch.object(common, "get_executor", return_value=rollback_executor):
                failed = common.execute_action(retry_action.action_id, retry_ids[0])
            require(failed.action.status == "failed" and count(retry_action) == 0)
            retried = common.execute_action(retry_action.action_id, retry_ids[0])
            require(retried.action.status == "completed" and count(retry_action) == 1)
            require(retried.action.attempt_count == failed.action.attempt_count + 1)
            require(originals(retry_ids) == retry_before)
            results.append({"scenario": "rollback_then_new_attempt_retry", "status": "PASS"})

            stale_ids = seed()
            stale_action = plan(stale_ids)
            _, lease = common._acquire_lease(stale_action.action_id, stale_ids[0])
            with factory() as blocker:
                pid = blocker.scalar(text("SELECT pg_backend_pid()"))
                blocker.scalar(select(User).where(User.id == stale_ids[0]).with_for_update())
                row = blocker.scalar(select(AgentAction).where(AgentAction.id == stale_action.id).with_for_update())
                row.attempt_count += 1
                row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
                blocker.flush()
                pids.clear()
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(invoke, "stale", lease)
                    try:
                        wait_blocked("stale", pid)
                    finally:
                        blocker.commit()
                    require(future.result(timeout=15) == "rejected")
            require(count(stale_action) == 0)
            require(common.execute_action(stale_action.action_id, stale_ids[0]).action.status == "completed")
            require(count(stale_action) == 1)
            results.append({"scenario": "stale_attempt_then_current_retry", "status": "PASS", "real_lock_wait": True})

            for model, pk, field, constraint in (
                (Message, ids[2], "message_id", "fk_object_mentions_message_id_messages"),
                (Activity, ids[3], "activity_id", "fk_object_mentions_activity_id_activities"),
                (Conversation, ids[1], "conversation_id", "fk_object_mentions_conversation_id_conversations"),
            ):
                with factory() as db:
                    mention = db.scalar(select(ObjectMention).where(ObjectMention.agent_action_id == action.id))
                    setattr(mention, field, uuid4())
                    try:
                        db.commit()
                    except IntegrityError as error:
                        require(error.orig.diag.constraint_name == constraint)
                        db.rollback()
                    else:
                        raise SafetyStop("FK_INVALID_REFERENCE_ALLOWED")
                with factory() as db:
                    try:
                        db.delete(db.get(model, pk)); db.commit()
                    except IntegrityError:
                        db.rollback()
                    else:
                        raise SafetyStop("FK_RESTRICT_NOT_ENFORCED")
            require(originals(ids) == before and count(action) == 1)
            results.append({"scenario": "message_activity_conversation_fk_restrict", "status": "PASS"})

            other = seed()
            other_before = originals(other)
            with factory() as db:
                mention = db.scalar(select(ObjectMention).where(ObjectMention.agent_action_id == action.id))
                mention_id = mention.id
                require(service.read_object_mentions(db, AuthPrincipal(other[0])) == [])
                try:
                    service.read_object_mentions(db, AuthPrincipal(other[0]), mention_id=mention_id)
                except HTTPException as error:
                    require(error.status_code == 404)
                else:
                    raise SafetyStop("CROSS_ACCOUNT_READ_ALLOWED")
            try:
                common.execute_action(action.action_id, other[0])
            except common.ExecutorNotFoundError:
                pass
            else:
                raise SafetyStop("CROSS_ACCOUNT_EXECUTE_ALLOWED")
            results.append({"scenario": "cross_account_read_execute_denied", "status": "PASS"})

            with factory() as db:
                db.get(Activity, ids[3]).metadata_ = {}
                db.commit()
            with factory() as db:
                require(service.read_object_mentions(db, AuthPrincipal(ids[0])) == [])
            results.append({"scenario": "damaged_evidence_hidden", "status": "PASS"})

            purge_ids = seed()
            a, b = plan(purge_ids), plan(purge_ids)
            for item in (a, b):
                require(common.execute_action(item.action_id, purge_ids[0]).action.status == "completed")
            with factory() as db:
                old = db.scalar(select(ObjectMention).where(ObjectMention.agent_action_id == a.id))
                successor = db.scalar(select(ObjectMention).where(ObjectMention.agent_action_id == b.id))
                old.status, successor.supersedes_mention_id = "superseded", old.id
                db.get(User, purge_ids[0]).deleted_at = datetime.now(timezone.utc)
                db.commit()
                require(lifecycle.purge_deleted_account(db, purge_ids[0]) == "purged")
            with factory() as db:
                require(db.get(User, purge_ids[0]) is None)
                require(list(db.scalars(select(ObjectMention.id).where(ObjectMention.user_id == purge_ids[0]))) == [])
            require(originals(other) == other_before)
            results.append({"scenario": "account_purge_self_fk_other_account_preserved", "status": "PASS"})
    finally:
        engine.dispose()
    return results


def child_run(writes):
    url = check_url(os.environ.get("NOIE_SECURITY_TEST_DATABASE_URL"))
    schema = check_schema(os.environ.get(SCHEMA_ENV))
    expected = child_environment({}, url, schema, writes)
    if os.environ.get("DATABASE_URL", "") != expected["DATABASE_URL"]:
        raise SafetyStop("CHILD_DATABASE_SETTING_DENIED")
    if writes and os.environ.get(ACK) != "yes":
        raise SafetyStop("WRITE_ACK_REQUIRED")
    container_id = preflight(url, schema)
    if not writes:
        return {"verdict": "OBJECT_POSTGRES_TEST_READY", "mode": "read_only_preflight", "db_writes": 0,
                "migration_plan": "0001..0022", "schema_created": False}
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    import httpx
    def deny(*args, **kwargs):
        raise SafetyStop("EXTERNAL_HTTP_DENIED")
    async def deny_async(*args, **kwargs):
        raise SafetyStop("EXTERNAL_HTTP_DENIED")
    httpx.HTTPTransport.handle_request = deny
    httpx.AsyncHTTPTransport.handle_async_request = deny_async
    migrate(url, schema, container_id)
    results = run_scenarios(url, schema)
    return {"verdict": "OBJECT_POSTGRES_VERIFIED", "scenarios": results,
            "schema_retained": True, "test_schema": schema, "migration": REVISION}


def main(argv=None):
    parser = SafeParser(description="Local Docker Object PostgreSQL runner; default read-only")
    parser.add_argument("--run-writes", action="store_true")
    parser.add_argument("--ack-test-writes")
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    try:
        args = parser.parse_args(argv)
        if args.run_writes and args.ack_test_writes != CONTAINER:
            raise SafetyStop("WRITE_ACK_REQUIRED")
        url = check_url(os.environ.get("NOIE_SECURITY_TEST_DATABASE_URL"))
        if args.child:
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                report = child_run(args.run_writes)
        else:
            schema = "noie_object_pgtest_" + uuid4().hex
            env = child_environment(os.environ, url, schema, args.run_writes)
            command = [sys.executable, "-B", "-m", "evals.run_object_mention_pg", "--child"]
            if args.run_writes:
                command += ["--run-writes", "--ack-test-writes", CONTAINER]
            result = subprocess.run(command, cwd=BACKEND, env=env, capture_output=True, text=True, timeout=240)
            # Never forward child stdout/stderr: they may contain driver exception details.
            if result.returncode:
                raise SafetyStop("CHILD_CHECK_FAILED")
            report = json.loads(result.stdout)
            allowed = {"OBJECT_POSTGRES_TEST_READY", "OBJECT_POSTGRES_VERIFIED"}
            if not isinstance(report, dict) or report.get("verdict") not in allowed:
                raise SafetyStop("CHILD_RESULT_INVALID")
        print(json.dumps(report, ensure_ascii=True), flush=True)
        return 0
    except SafetyStop as error:
        allowed = {"TEST_URL_MISSING", "TEST_URL_INVALID", "TEST_TARGET_DENIED", "WRITE_ACK_REQUIRED",
                   "CLI_ARGUMENTS_INVALID", "CHILD_CHECK_FAILED", "REAL_LOCK_WAIT_NOT_OBSERVED"}
        reason = error.args[0] if error.args and error.args[0] in allowed else "SAFETY_CHECK_FAILED"
    except Exception:
        reason = "PREFLIGHT_FAILED"
    print(json.dumps({"verdict": "HOLD", "reason": reason}), flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
