"""Safety contracts only: synthetic URLs, mocked Docker/SQL, no PostgreSQL writes."""

import ast
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock, Mock, patch

from evals import run_object_mention_pg as runner
from evals import run_activity_lifecycle_pg as activity_runner


URL = "postgresql+psycopg://noie_test:synthetic_only@127.0.0.1:58704/noie_lifecycle_test"
SCHEMA = "noie_object_pgtest_" + "a" * 32
FINGERPRINT = "synthetic-postmaster-start"


class ObjectPgRunnerSafetyTests(unittest.TestCase):
    def invoke_main(self, args, env=None):
        output = StringIO()
        with patch.dict(os.environ, env or {}, clear=True), redirect_stdout(output):
            result = runner.main(args)
        return result, json.loads(output.getvalue())

    def test_missing_url_never_uses_production_fallback(self):
        with patch.object(runner.subprocess, "run") as dispatch:
            result, report = self.invoke_main([], {"DATABASE_URL": "synthetic_production_password"})
        self.assertEqual(result, 1)
        self.assertEqual(report["reason"], "TEST_URL_MISSING")
        dispatch.assert_not_called()
        self.assertNotIn("synthetic_production_password", json.dumps(report))

    def test_only_exact_docker_target_allowed(self):
        url = runner.check_url(URL)
        self.assertEqual((url.host, url.port, url.database, url.username),
                         (runner.HOST, runner.PORT, runner.DATABASE, runner.USER))
        for invalid in (URL.replace("127.0.0.1", "localhost"), URL.replace("58704", "5432"),
                        URL.replace("noie_lifecycle_test", "postgres"), URL.replace("noie_test:", "postgres:")):
            with self.assertRaises(runner.SafetyStop):
                runner.check_url(invalid)

    def test_url_query_overrides_forbidden(self):
        for query in ("host=other.invalid", "service=production", "options=-csearch_path=public"):
            with self.assertRaises(runner.SafetyStop):
                runner.check_url(URL + "?" + query)

    def test_schema_excludes_activity_and_public(self):
        self.assertEqual(runner.check_schema(SCHEMA), SCHEMA)
        for invalid in ("public", "noie_lifecycle_pgtest_" + "a" * 32, None, SCHEMA + ';DROP'):
            with self.assertRaises(runner.SafetyStop):
                runner.check_schema(invalid)

    def test_existing_docker_guards_are_reused(self):
        self.assertIs(runner.check_container, activity_runner.check_container)
        self.assertIs(runner.check_url, activity_runner.check_url)

    def test_parent_environment_unchanged(self):
        source = {"DATABASE_URL": "production_secret", "OPENAI_API_KEY": "secret", "PGSERVICE": "production",
                  "PYTHONPATH": "dirty-tree", "NOIE_DEV_USER_ID": "private", "PATH": "keep"}
        original = source.copy()
        child = runner.child_environment(source, runner.check_url(URL), SCHEMA, False)
        self.assertEqual(source, original)
        self.assertEqual(child["DATABASE_URL"], "")
        self.assertEqual(child["OPENAI_API_KEY"], "")
        self.assertEqual(child["PYTHON_DOTENV_DISABLED"], "1")
        self.assertEqual(child[runner.ACK], "no")
        for name in ("PGSERVICE", "PYTHONPATH", "NOIE_DEV_USER_ID"):
            self.assertNotIn(name, child)

    def test_write_child_database_scoped_to_object_only(self):
        from sqlalchemy.engine import make_url
        child = runner.child_environment({}, runner.check_url(URL), SCHEMA, True)
        url = make_url(child["DATABASE_URL"])
        self.assertEqual(url.query["options"], runner.options(SCHEMA))
        self.assertNotIn("public", url.query["options"])
        self.assertEqual(child[runner.ACK], "yes")

    def test_engine_uses_nullpool_readonly_timeout(self):
        with patch.object(runner, "create_engine") as create:
            runner.test_engine(runner.check_url(URL), readonly=True)
        kwargs = create.call_args.kwargs
        self.assertIs(kwargs["poolclass"], runner.NullPool)
        self.assertEqual(kwargs["isolation_level"], "READ COMMITTED")
        self.assertIn("default_transaction_read_only=on", kwargs["connect_args"]["options"])
        self.assertIn("lock_timeout=10000", kwargs["connect_args"]["options"])

    def test_migration_graph_is_single_head_0022(self):
        from alembic.script import ScriptDirectory
        config = runner.migration_config()
        scripts = ScriptDirectory.from_config(config)
        self.assertEqual(scripts.get_heads(), ["20261009_0022"])
        self.assertEqual(scripts.get_revision(runner.REVISION).down_revision, "20261008_0021")
        self.assertEqual(len(list(scripts.walk_revisions())), 22)

    def preflight_mock(self, row=None, exists=False, ids=None):
        stack = self.enterContext(__import__("contextlib").ExitStack())
        stack.enter_context(patch.object(runner, "migration_config"))
        stack.enter_context(patch.object(runner, "check_container", side_effect=ids or ["a" * 64, "a" * 64]))
        docker = stack.enter_context(patch.object(runner, "docker_read", return_value=FINGERPRINT))
        engine = MagicMock()
        db = engine.connect.return_value.__enter__.return_value
        db.execute.return_value.one.return_value = row or (runner.DATABASE, runner.USER, FINGERPRINT, "on", 160000, True, True)
        db.scalar.return_value = exists
        create = stack.enter_context(patch.object(runner, "test_engine", return_value=engine))
        return engine, db, create, docker

    def test_preflight_only_select_and_readonly_engine(self):
        engine, db, create, docker = self.preflight_mock()
        self.assertEqual(runner.preflight(runner.check_url(URL), SCHEMA), "a" * 64)
        create.assert_called_once_with(runner.check_url(URL), readonly=True)
        for call in db.execute.call_args_list + db.scalar.call_args_list:
            self.assertTrue(str(call.args[0]).startswith("SELECT "))
        self.assertIn("PGOPTIONS=-c default_transaction_read_only=on", docker.call_args.args)
        engine.dispose.assert_called_once()

    def test_wrong_database_identity_fails_closed(self):
        self.preflight_mock(row=("production", runner.USER, FINGERPRINT, "on", 160000, True, True))
        with self.assertRaises(runner.SafetyStop):
            runner.preflight(runner.check_url(URL), SCHEMA)

    def test_non_readonly_session_fails_closed(self):
        self.preflight_mock(row=(runner.DATABASE, runner.USER, FINGERPRINT, "off", 160000, True, True))
        with self.assertRaises(runner.SafetyStop):
            runner.preflight(runner.check_url(URL), SCHEMA)

    def test_existing_schema_never_reused(self):
        self.preflight_mock(exists=True)
        with self.assertRaises(runner.SafetyStop):
            runner.preflight(runner.check_url(URL), SCHEMA)

    def test_container_restart_denied(self):
        self.preflight_mock(ids=["a" * 64, "b" * 64])
        with self.assertRaises(runner.SafetyStop):
            runner.preflight(runner.check_url(URL), SCHEMA)

    def test_migration_denied_before_ddl_without_ack(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(runner, "test_engine") as create:
            with self.assertRaises(runner.SafetyStop):
                runner.migrate(runner.check_url(URL), SCHEMA, "a" * 64)
        create.assert_not_called()

    def test_migration_env_no_fallback_no_public_version_table(self):
        source = (runner.BACKEND / "evals/object_pg_migrations/env.py").read_text(encoding="utf-8")
        self.assertIn("version_table_schema=schema", source)
        self.assertIn('config.attributes.get("connection")', source)
        self.assertIn('row[3] != [schema]', source)
        self.assertNotIn("create_engine", source)
        self.assertNotIn("load_dotenv", source)

    def test_readonly_branch_never_migrates_or_seeds(self):
        env = runner.child_environment({}, runner.check_url(URL), SCHEMA, False)
        with patch.dict(os.environ, env, clear=True), patch.object(runner, "preflight", return_value="a" * 64), \
                patch.object(runner, "migrate") as migrate, patch.object(runner, "run_scenarios") as scenarios:
            result = runner.child_run(False)
        self.assertEqual(result["db_writes"], 0)
        self.assertFalse(result["schema_created"])
        migrate.assert_not_called()
        scenarios.assert_not_called()

    def test_unscoped_child_database_denied_before_preflight(self):
        env = runner.child_environment({}, runner.check_url(URL), SCHEMA, False)
        env["DATABASE_URL"] = "production_secret"
        with patch.dict(os.environ, env, clear=True), patch.object(runner, "preflight") as preflight:
            with self.assertRaises(runner.SafetyStop):
                runner.child_run(False)
        preflight.assert_not_called()

    def test_write_child_requires_ack_before_preflight(self):
        env = runner.child_environment({}, runner.check_url(URL), SCHEMA, True)
        env[runner.ACK] = "no"
        with patch.dict(os.environ, env, clear=True), patch.object(runner, "preflight") as preflight:
            with self.assertRaises(runner.SafetyStop):
                runner.child_run(True)
        preflight.assert_not_called()

    def test_cli_write_flag_alone_cannot_dispatch(self):
        with patch.object(runner.subprocess, "run") as dispatch:
            result, report = self.invoke_main(["--run-writes"], {"NOIE_SECURITY_TEST_DATABASE_URL": URL})
        self.assertEqual(result, 1)
        self.assertEqual(report["reason"], "WRITE_ACK_REQUIRED")
        dispatch.assert_not_called()

    def test_cli_default_is_readonly_child_no_url_in_argv(self):
        output = json.dumps({"verdict": "OBJECT_POSTGRES_TEST_READY", "db_writes": 0})
        with patch.object(runner.subprocess, "run", return_value=Mock(returncode=0, stdout=output)) as call:
            result, report = self.invoke_main([], {"NOIE_SECURITY_TEST_DATABASE_URL": URL})
        self.assertEqual(result, 0)
        args = call.call_args.args[0]
        self.assertNotIn("--run-writes", args)
        self.assertNotIn(URL, " ".join(args))
        self.assertEqual(call.call_args.kwargs["env"]["DATABASE_URL"], "")
        self.assertEqual(report["db_writes"], 0)

    def test_child_errors_never_forwarded(self):
        with patch.object(runner.subprocess, "run", return_value=Mock(returncode=1,
                stdout="synthetic_password", stderr="synthetic_token")):
            result, report = self.invoke_main([], {"NOIE_SECURITY_TEST_DATABASE_URL": URL})
        self.assertEqual(result, 1)
        self.assertNotIn("synthetic_", json.dumps(report))

    def test_bad_cli_never_reflects_args(self):
        with redirect_stderr(StringIO()):
            result, report = self.invoke_main(["--unexpected", "synthetic_password"])
        self.assertEqual(result, 1)
        self.assertEqual(report["reason"], "CLI_ARGUMENTS_INVALID")
        self.assertNotIn("synthetic_password", json.dumps(report))

    def test_unexpected_failure_never_reflects_exception(self):
        with patch.object(runner.subprocess, "run", side_effect=RuntimeError("synthetic_password")):
            result, report = self.invoke_main([], {"NOIE_SECURITY_TEST_DATABASE_URL": URL})
        self.assertEqual(result, 1)
        self.assertEqual(report["reason"], "PREFLIGHT_FAILED")

    def test_real_lock_probe_without_python_lock_or_cleanup(self):
        source = Path(runner.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        self.assertIn("SELECT pg_blocking_pids(:pid)", source)
        self.assertIn("SELECT pg_backend_pid()", source)
        self.assertIn("ThreadPoolExecutor(max_workers=2)", source)
        self.assertNotIn("DROP SCHEMA", source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                self.assertNotIn(node.func.id, {"Lock", "RLock"})


if __name__ == "__main__":
    unittest.main()
