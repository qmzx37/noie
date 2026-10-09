"""지정된 로컬 Docker DB만 허용합니다. 기본 실행은 읽기 전용 사전 검사입니다."""

import argparse
from contextlib import ExitStack, contextmanager, redirect_stderr, redirect_stdout
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
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
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool


CONTAINER = "noie-lifecycle-pgtest"
HOST, PORT, DATABASE, USER = "127.0.0.1", 58704, "noie_lifecycle_test", "noie_test"
REVISION = "20261008_0021"
BACKEND = Path(__file__).resolve().parents[1]
SCHEMA_PATTERN = re.compile(r"noie_lifecycle_pgtest_[0-9a-f]{32}\Z")


class SafetyStop(Exception):
    """동적 오류 본문 대신 아래 고정 reason code만 출력합니다."""


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        # 잘못 입력한 CLI 인자에도 접속 문자열/비밀값이 있을 수 있습니다.
        raise SafetyStop("CLI_ARGUMENTS_INVALID")


def check_url(raw):
    if not raw:
        raise SafetyStop("TEST_URL_MISSING")
    try:
        url = make_url(raw)
        valid = (url.drivername in {"postgresql", "postgresql+psycopg"}
                 and (url.host, url.port, url.database, url.username) == (HOST, PORT, DATABASE, USER)
                 and bool(url.password) and not url.query)
    except Exception:
        raise SafetyStop("TEST_URL_INVALID") from None
    if not valid:
        raise SafetyStop("TEST_TARGET_DENIED")
    return url.set(drivername="postgresql+psycopg")


def docker_read(*args):
    override = os.environ.get("DOCKER_HOST", "")
    if override and not override.startswith(("npipe://", "unix://")):
        raise SafetyStop("REMOTE_DOCKER_DENIED")
    try:
        result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=15)
    except Exception:
        raise SafetyStop("DOCKER_UNAVAILABLE") from None
    if result.returncode:
        raise SafetyStop("DOCKER_CHECK_FAILED")
    return result.stdout.strip()


def check_container():
    # 원격 Docker daemon의 같은 이름 컨테이너를 localhost 검증 근거로 쓰지 않습니다.
    endpoint = json.loads(docker_read("context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"))
    if not isinstance(endpoint, str) or not endpoint.startswith(("npipe://", "unix://")):
        raise SafetyStop("REMOTE_DOCKER_DENIED")
    template = ('{"id":"{{.Id}}","name":"{{.Name}}","running":{{.State.Running}},'
                '"health":"{{if .State.Health}}{{.State.Health.Status}}{{end}}",'
                '"ports":{{json .NetworkSettings.Ports}}}')
    info = json.loads(docker_read("inspect", "--format", template, CONTAINER))
    if (info.get("name") != "/" + CONTAINER or info.get("running") is not True
            or info.get("health") != "healthy" or not re.fullmatch(r"[0-9a-f]{64}", info.get("id", ""))
            or info.get("ports", {}).get("5432/tcp") != [{"HostIp": HOST, "HostPort": str(PORT)}]):
        raise SafetyStop("CONTAINER_TARGET_DENIED")
    # 비밀번호 환경변수는 조회하지 않습니다.
    identity = docker_read("exec", CONTAINER, "printenv", "POSTGRES_USER", "POSTGRES_DB").splitlines()
    if identity != [USER, DATABASE]:
        raise SafetyStop("CONTAINER_IDENTITY_DENIED")
    return info["id"]


def check_schema(schema):
    if not isinstance(schema, str) or not SCHEMA_PATTERN.fullmatch(schema):
        raise SafetyStop("SCHEMA_DENIED")
    return schema


def child_environment(source, url, schema, writes):
    # 부모 DATABASE_URL/.env는 보존하고 자식 프로세스만 운영 설정과 분리합니다.
    env = {k: v for k, v in source.items()
           if not k.startswith(("DATABASE_", "OPENAI_", "SUPABASE_", "NOIE_", "PG"))
           and k not in {"PYTHONPATH", "PYTHONHOME"}}
    check_schema(schema)
    scoped_url = url.update_query_dict({"options": "-c search_path=" + schema
        + " -c statement_timeout=15000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=20000"})
    env.update(PYTHON_DOTENV_DISABLED="1", PYTHONDONTWRITEBYTECODE="1", OPENAI_API_KEY="",
               DATABASE_URL=scoped_url.render_as_string(hide_password=False) if writes else "",
               NOIE_SECURITY_TEST_DATABASE_URL=url.render_as_string(hide_password=False),
               NOIE_PG_TEST_SCHEMA=check_schema(schema), NOIE_PG_TEST_WRITE_ACK="yes" if writes else "no",
               NOIE_ACTIVITY_RECORDER_ENABLED="true", NOIE_SCHEDULE_TIMEZONE="Asia/Seoul",
               NOIE_AUTH_ENABLED="true", NOIE_RATE_LIMIT_ENABLED="false", NOIE_LV4_SHADOW_ENABLED="false")
    return env


def test_engine(url, *, schema=None, readonly=False):
    options = "-c statement_timeout=15000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=20000"
    if readonly:
        options += " -c default_transaction_read_only=on"
    if schema is not None:
        options += " -c search_path=" + check_schema(schema)
    return create_engine(url, poolclass=NullPool, isolation_level="READ COMMITTED",
                         connect_args={"connect_timeout": 5, "options": options, "sslmode": "disable"})


def preflight(url, schema):
    container_id = check_container()
    fingerprint = docker_read("exec", CONTAINER, "psql", "-XAt", "--no-password", "-U", USER,
                              "--dbname", DATABASE, "--command", "SELECT pg_postmaster_start_time()::text")
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
                         {"schema": check_schema(schema)}):
                raise SafetyStop("SCHEMA_ALREADY_EXISTS")
    finally:
        engine.dispose()
    if check_container() != container_id:
        raise SafetyStop("CONTAINER_CHANGED")
    return container_id


def check_write_ack(writes, ack):
    if writes and ack != "noie-lifecycle-pgtest":
        raise SafetyStop("WRITE_ACK_REQUIRED")


def migrate(url, schema, container_id):
    """기존 migration 파일을 전용 Alembic env에서 사용하며 public은 search_path에서 제외합니다."""
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    if os.environ.get("NOIE_PG_TEST_WRITE_ACK") != "yes" or check_container() != container_id:
        raise SafetyStop("MIGRATION_GUARD_DENIED")
    config = Config()
    config.set_main_option("script_location", str(BACKEND / "evals" / "lifecycle_pg_migrations"))
    config.set_main_option("version_locations", str(BACKEND / "migrations" / "versions"))
    scripts = ScriptDirectory.from_config(config)
    if scripts.get_heads() != [REVISION]:
        raise SafetyStop("MIGRATION_HEAD_CHANGED")
    engine = test_engine(url, schema=schema)
    try:
        with engine.begin() as connection:
            if connection.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=:schema)"),
                                 {"schema": schema}):
                raise SafetyStop("SCHEMA_ALREADY_EXISTS")
            connection.execute(text('CREATE SCHEMA "' + check_schema(schema) + '"'))
            if connection.scalar(text("SELECT current_schema()")) != schema:
                raise SafetyStop("SCHEMA_ISOLATION_FAILED")
            config.attributes.update(connection=connection, test_schema=schema, container_id=container_id)
            command.upgrade(config, REVISION)
            actual = connection.scalar(text('SELECT version_num FROM "' + schema + '".alembic_version'))
            if actual != REVISION:
                raise SafetyStop("MIGRATION_VERSION_MISMATCH")
    finally:
        engine.dispose()


@dataclass
class PgFixture:
    factory: object
    user_id: object
    conversation_id: object
    ongoing: object
    completion: object
    alternative: object

    def plan(self, completion=None):
        from agent.action_schemas import ConfirmationRequest, PersistActionPlanRequest
        from agent.action_service import confirm_action, persist_action_plan
        from agent.tool_gateway import create_tool_plan
        from agent.tool_schemas import GatewayAction, ToolPlanRequest
        completion = completion or self.completion
        plans = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(action_id=uuid4(), type="daily_life",
            intent="link_activity_completion", mode="execute", reason="synthetic lifecycle link",
            confidence=.9, requires_confirmation=False, execution_order=1,
            arguments={"ongoing_activity_id": self.ongoing.id, "completion_activity_id": completion.id})])).plans
        with self.factory() as db:
            action = persist_action_plan(db, PersistActionPlanRequest(user_id=self.user_id,
                conversation_id=self.conversation_id, message_id=completion.message_id, plans=plans))[0]
            return confirm_action(db, action.action_id, ConfirmationRequest(user_id=self.user_id,
                                                                          confirmation_id=action.confirmation_id))


def seed_fixture(factory):
    from sqlalchemy import select
    from agent.action_schemas import PersistActionPlanRequest
    from agent.action_service import persist_action_plan
    from agent.executor_service import execute_action
    from agent.tool_gateway import create_tool_plan
    from agent.tool_schemas import GatewayAction, ToolPlanRequest
    from models.activity import Activity
    from models.conversation import Conversation
    from models.message import Message
    from models.user import User
    with factory() as db:
        user = User(name="synthetic-lifecycle-pgtest")
        db.add(user); db.flush()
        conversation = Conversation(user_id=user.id)
        db.add(conversation); db.commit()
        owner, conversation_id = user.id, conversation.id
    activities = []
    for raw in ("지금 공부하고 있어", "공부 마쳤어", "공부 완료했어"):
        with factory() as db:
            message = Message(user_id=owner, conversation_id=conversation_id, role="user", content=raw)
            db.add(message); db.commit()
            plans = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(action_id=uuid4(), type="daily_life",
                intent="record_daily_trace", mode="record", reason="synthetic activity report", confidence=.9,
                requires_confirmation=False, execution_order=1,
                arguments={"summary": "synthetic daily", "category": "activity"})])).plans
            action = persist_action_plan(db, PersistActionPlanRequest(user_id=owner,
                conversation_id=conversation_id, message_id=message.id, plans=plans))[0]
        require(execute_action(action.action_id, owner).action.status == "completed")
        with factory() as db:
            activity = db.scalar(select(Activity).where(Activity.message_id == message.id))
            require(activity is not None)
            activities.append(activity)
    return PgFixture(factory, owner, conversation_id, *activities)


def require(condition):
    if not condition:
        raise SafetyStop("SCENARIO_ASSERTION_FAILED")


def run_scenarios(url, schema):
    """각 worker는 별도 PostgreSQL 연결을 씁니다. Python 직렬화 Lock은 사용하지 않습니다."""
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from unittest.mock import patch
    from agent import executor_service as common
    from agent import link_activity_completion_executor as linking
    from agent import record_daily_trace_executor as daily
    from agent.executor_registry import ExecutorContext
    from agent.activity_lifecycle_service import ActivityLinkError, LINK_KEY, _read_link
    from models.activity import Activity
    from models.agent_action import AgentAction
    from models.message import Message
    from models.user import User
    engine = test_engine(url, schema=schema)
    worker = local()
    pids, results = {}, []

    @contextmanager
    def factory():
        with engine.connect() as connection:
            require(connection.scalar(text("SELECT current_schema()")) == schema)
            require(connection.get_isolation_level() == "READ COMMITTED")
            pid = connection.scalar(text("SELECT pg_backend_pid()"))
            connection.rollback()
            if getattr(worker, "name", None):
                pids[worker.name] = pid
            with Session(bind=connection, expire_on_commit=False) as db:
                yield db

    def acquire(action):
        _, lease = common._acquire_lease(action.action_id, action.user_id)
        require(lease is not None)
        return lease

    def invoke(name, lease, hook=None):
        worker.name = name
        try:
            result = linking.link_activity_completion_executor(ExecutorContext(str(lease.action_id),
                str(lease.user_id), lease.tool_name, lease.attempt_count), before_commit=hook)
        except ActivityLinkError as error:
            common._finish_failure(lease, error)
            return "rejected"
        finally:
            worker.name = None
        _, fenced = common._finish_success(lease, result)
        require(not fenced)
        return "reused" if result.data["reused"] else "linked"

    def wait_blocked(name, blocker):
        deadline = time.monotonic() + 6
        with engine.connect() as monitor:
            while time.monotonic() < deadline:
                pid = pids.get(name)
                if pid is not None and pid != blocker:
                    if blocker in monitor.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": pid}):
                        return
                time.sleep(.02)
        raise SafetyStop("REAL_LOCK_WAIT_NOT_OBSERVED")

    def links(fixture):
        with factory() as db:
            rows = list(db.scalars(select(Activity).where(Activity.user_id == fixture.user_id)))
            require(len(rows) == 3)
            found = [row.metadata_[LINK_KEY] for row in rows if LINK_KEY in row.metadata_]
            for row in rows:
                if LINK_KEY in row.metadata_:
                    require(_read_link(db, row, fixture.user_id) is not None)
            for link in found:
                require(link["ongoing_activity_id"] == str(fixture.ongoing.id))
                require(link["basis"] == "user_confirmed")
            return found

    def originals(fixture):
        with factory() as db:
            rows = list(db.scalars(select(Activity).where(Activity.user_id == fixture.user_id).order_by(Activity.id)))
            return [(row.id, row.user_id, row.conversation_id, row.message_id, row.agent_action_id,
                     row.record_index, row.action, row.status, row.activity_date, row.start_time, row.end_time,
                     row.duration_minutes, row.observed_at, row.confidence, row.created_at,
                     {key: value for key, value in row.metadata_.items() if key != LINK_KEY},
                     db.get(Message, row.message_id).content) for row in rows]

    def competing(label, *, same_pair=False, rollback=False):
        fixture = seed_fixture(factory)
        before = originals(fixture)
        a, b = fixture.plan(), fixture.plan(fixture.completion if same_pair or rollback else fixture.alternative)
        leases = acquire(a), acquire(b)
        held, release = Event(), Event()
        pids.clear()
        def hook():
            held.set()
            require(release.wait(8))
            if rollback:
                raise RuntimeError("synthetic_rollback")
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(invoke, "first", leases[0], hook)
            try:
                require(held.wait(6))
                second = pool.submit(invoke, "second", leases[1])
                wait_blocked("second", pids["first"])
            finally:
                release.set()
            outcomes = first.result(timeout=15), second.result(timeout=15)
        expected = ("rejected", "linked") if rollback else ("linked", "reused" if same_pair else "rejected")
        require(outcomes == expected)
        found = links(fixture)
        require(len(found) == 1)
        require(originals(fixture) == before)
        if same_pair or rollback:
            retried = common.execute_action(a.action_id, fixture.user_id)
            require(retried.action.status == "completed")
            require(links(fixture) == found)
        results.append({"scenario": label, "status": "PASS", "real_lock_wait": True, "link_count": 1})

    try:
        with ExitStack() as stack:
            for module in (common, linking, daily):
                stack.enter_context(patch.object(module, "SessionLocal", factory))
            competing("same_ongoing_concurrent_conflict")
            competing("same_pair_concurrent_retry", same_pair=True)
            competing("rollback_then_waiter_retry", rollback=True)
            fixture = seed_fixture(factory)
            before = originals(fixture)
            action = fixture.plan()
            lease = acquire(action)
            pids.clear()
            with factory() as blocker:
                blocker_pid = blocker.scalar(text("SELECT pg_backend_pid()"))
                blocker.scalar(select(User).where(User.id == fixture.user_id).with_for_update())
                row = blocker.scalar(select(AgentAction).where(AgentAction.id == action.id).with_for_update())
                row.attempt_count += 1
                row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
                blocker.flush()
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(invoke, "stale", lease)
                    try:
                        wait_blocked("stale", blocker_pid)
                    finally:
                        blocker.commit()
                    require(future.result(timeout=15) == "rejected")
            require(links(fixture) == [])
            require(common.execute_action(action.action_id, fixture.user_id).action.status == "completed")
            require(len(links(fixture)) == 1 and originals(fixture) == before)
            results.append({"scenario": "stale_attempt_then_current_retry", "status": "PASS",
                            "real_lock_wait": True, "stale_link_count": 0, "final_link_count": 1})
    finally:
        engine.dispose()
    return results


def child_run(writes):
    url = check_url(os.environ.get("NOIE_SECURITY_TEST_DATABASE_URL"))
    schema = check_schema(os.environ.get("NOIE_PG_TEST_SCHEMA"))
    expected = child_environment({}, url, schema, writes)
    if os.environ.get("DATABASE_URL", "") != expected["DATABASE_URL"]:
        raise SafetyStop("CHILD_DATABASE_SETTING_DENIED")
    container_id = preflight(url, schema)
    if not writes:
        return {"verdict": "POSTGRES_LIFECYCLE_TEST_READY", "mode": "read_only_preflight", "db_writes": 0}
    if os.environ.get("NOIE_PG_TEST_WRITE_ACK") != "yes":
        raise SafetyStop("WRITE_ACK_REQUIRED")
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    # SDK의 합성 호출도 필요하지 않습니다. 잘못 추가된 외부 HTTP 요청은 중단합니다.
    import httpx
    def deny(*args, **kwargs):
        raise SafetyStop("EXTERNAL_HTTP_DENIED")
    async def deny_async(*args, **kwargs):
        raise SafetyStop("EXTERNAL_HTTP_DENIED")
    httpx.HTTPTransport.handle_request = deny
    httpx.AsyncHTTPTransport.handle_async_request = deny_async
    migrate(url, schema, container_id)
    results = run_scenarios(url, schema)
    return {"verdict": "POSTGRES_LIFECYCLE_VERIFIED", "scenarios": results,
            "schema_retained": True, "test_schema": schema, "migration": REVISION}


def main(argv=None):
    parser = SafeParser(description="Local Docker lifecycle PostgreSQL safety runner")
    parser.add_argument("--run-writes", action="store_true")
    parser.add_argument("--ack-test-writes")
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    reason = "PREFLIGHT_FAILED"
    try:
        args = parser.parse_args(argv)
        check_write_ack(args.run_writes, args.ack_test_writes)
        url = check_url(os.environ.get("NOIE_SECURITY_TEST_DATABASE_URL"))
        if args.child:
            # 실패 출력에 SDK/DB 예외와 원문 traceback이 섞이지 않도록 전체 자식 출력도 격리합니다.
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                report = child_run(args.run_writes)
        else:
            schema = "noie_lifecycle_pgtest_" + uuid4().hex
            env = child_environment(os.environ, url, schema, args.run_writes)
            command = [sys.executable, "-B", "-m", "evals.run_activity_lifecycle_pg", "--child"]
            if args.run_writes:
                command += ["--run-writes", "--ack-test-writes", CONTAINER]
            result = subprocess.run(command, cwd=BACKEND, env=env, capture_output=True, text=True, timeout=240)
            report = json.loads(result.stdout)
            if not isinstance(report, dict) or report.get("verdict") not in {
                    "POSTGRES_LIFECYCLE_TEST_READY", "POSTGRES_LIFECYCLE_VERIFIED", "POSTGRES_LIFECYCLE_TEST_HOLD"}:
                raise SafetyStop("CHILD_RESULT_INVALID")
            if result.returncode:
                report = {"verdict": "POSTGRES_LIFECYCLE_TEST_HOLD", "reason": "CHILD_CHECK_FAILED"}
        print(json.dumps(report, ensure_ascii=True), flush=True)
        return 1 if report["verdict"] == "POSTGRES_LIFECYCLE_TEST_HOLD" else 0
    except SafetyStop as error:
        # 이 예외는 고정 코드만 가집니다. 외부 예외는 아래 고정 이유로 바꿉니다.
        reason = error.args[0]
        allowed = {"TEST_URL_MISSING", "TEST_URL_INVALID", "TEST_TARGET_DENIED", "WRITE_ACK_REQUIRED", "CLI_ARGUMENTS_INVALID"}
        if reason not in allowed:
            reason = "SAFETY_CHECK_FAILED"
    except Exception:
        reason = "PREFLIGHT_FAILED"
    print(json.dumps({"verdict": "POSTGRES_LIFECYCLE_TEST_HOLD", "reason": reason}), flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
