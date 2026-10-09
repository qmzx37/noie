"""PostgreSQL/Docker 연결 없이 실행기의 fail-closed 경계만 검사합니다."""

from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
import json
import os
import unittest
from unittest.mock import MagicMock, Mock, patch

from evals import run_activity_lifecycle_pg as runner


URL = "postgresql+psycopg://noie_test:synthetic_only@127.0.0.1:58704/noie_lifecycle_test"
SCHEMA = "noie_lifecycle_pgtest_" + "a" * 32


class PgRunnerSafetyTests(unittest.TestCase):
    def test_missing_url_never_falls_back_to_database_url(self):
        output = StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": "synthetic-production-secret"}, clear=True), \
                patch.object(runner.subprocess, "run") as call, redirect_stdout(output):
            self.assertEqual(runner.main([]), 1)
        call.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["reason"], "TEST_URL_MISSING")
        self.assertNotIn("synthetic-production-secret", output.getvalue())

    def test_bad_cli_arguments_do_not_reflect_secret(self):
        output, error = StringIO(), StringIO()
        with redirect_stdout(output), redirect_stderr(error):
            self.assertEqual(runner.main(["--unexpected", "synthetic_password_token"]), 1)
        self.assertEqual(json.loads(output.getvalue())["reason"], "CLI_ARGUMENTS_INVALID")
        self.assertNotIn("synthetic_password_token", output.getvalue() + error.getvalue())

    def test_exact_target_is_accepted(self):
        url = runner.check_url(URL)
        self.assertEqual((url.host, url.port, url.database, url.username),
                         (runner.HOST, runner.PORT, runner.DATABASE, runner.USER))
        self.assertEqual(url.drivername, "postgresql+psycopg")

    def test_any_other_target_or_driver_is_denied(self):
        for invalid in (URL.replace("127.0.0.1", "localhost"), URL.replace("127.0.0.1", "example.invalid"),
                        URL.replace("58704", "5432"), URL.replace("noie_lifecycle_test", "postgres"),
                        URL.replace("noie_test:", "postgres:"), URL.replace("postgresql+psycopg", "sqlite")):
            with self.subTest(target="synthetic_invalid"), self.assertRaises(runner.SafetyStop):
                runner.check_url(invalid)

    def test_query_cannot_override_host_service_or_search_path(self):
        for query in ("host=example.invalid", "service=production", "options=-csearch_path=public",
                      "sslmode=disable"):
            with self.subTest(query="synthetic_invalid"), self.assertRaises(runner.SafetyStop):
                runner.check_url(URL + "?" + query)

    def test_blank_password_and_malformed_url_are_denied(self):
        for raw in ("broken", URL.replace("synthetic_only", ""), URL.replace("58704", "bad")):
            with self.assertRaises(runner.SafetyStop):
                runner.check_url(raw)

    def test_schema_must_be_random_test_only_identifier(self):
        self.assertEqual(runner.check_schema(SCHEMA), SCHEMA)
        for schema in ("public", "activities", "noie_lifecycle_pgtest_x", None, SCHEMA + '"; DROP SCHEMA public;'):
            with self.assertRaises(runner.SafetyStop):
                runner.check_schema(schema)

    def test_child_environment_preserves_parent_and_removes_production_settings(self):
        source = {"DATABASE_URL": "old", "PGSERVICE": "production", "OPENAI_API_KEY": "secret",
                  "NOIE_DEV_USER_ID": "private", "SUPABASE_URL": "old", "PATH": "keep"}
        old = source.copy()
        child = runner.child_environment(source, runner.check_url(URL), SCHEMA, False)
        self.assertEqual(source, old)
        self.assertEqual(child["DATABASE_URL"], "")
        self.assertEqual(child["OPENAI_API_KEY"], "")
        self.assertEqual(child["PYTHON_DOTENV_DISABLED"], "1")
        self.assertEqual(child["NOIE_PG_TEST_WRITE_ACK"], "no")
        self.assertNotIn("PGSERVICE", child)
        self.assertNotIn("NOIE_DEV_USER_ID", child)
        self.assertNotIn("SUPABASE_URL", child)

    def test_only_write_child_receives_verified_database_url(self):
        child = runner.child_environment({"DATABASE_URL": "old"}, runner.check_url(URL), SCHEMA, True)
        scoped = runner.make_url(child["DATABASE_URL"])
        self.assertEqual(scoped.set(query={}), runner.check_url(URL))
        self.assertIn("search_path=" + SCHEMA, scoped.query["options"])
        self.assertNotIn("public", scoped.query["options"])
        self.assertEqual(child["NOIE_PG_TEST_WRITE_ACK"], "yes")

    def test_explicit_write_ack_is_required(self):
        runner.check_write_ack(False, None)
        runner.check_write_ack(True, runner.CONTAINER)
        for ack in (None, "yes", "wrong-container"):
            with self.assertRaises(runner.SafetyStop):
                runner.check_write_ack(True, ack)

    def docker_answers(self, *, health="healthy", port="58704", user="noie_test", endpoint="npipe:////./pipe/dockerDesktopLinuxEngine"):
        return [json.dumps(endpoint), json.dumps({"id": "a" * 64, "name": "/" + runner.CONTAINER,
                "running": True, "health": health, "ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": port}]}}),
                user + "\nnoie_lifecycle_test"]

    def test_exact_healthy_local_container_is_required(self):
        with patch.object(runner, "docker_read", side_effect=self.docker_answers()):
            self.assertEqual(runner.check_container(), "a" * 64)

    def test_different_container_port_health_user_or_remote_daemon_is_denied(self):
        for options in ({"health": "unhealthy"}, {"port": "5432"}, {"user": "postgres"},
                        {"endpoint": "tcp://remote.invalid:2375"}):
            with patch.object(runner, "docker_read", side_effect=self.docker_answers(**options)), \
                    self.assertRaises(runner.SafetyStop):
                runner.check_container()

    def test_docker_failure_never_prints_stderr_or_exception(self):
        with patch.object(runner.subprocess, "run", side_effect=RuntimeError("synthetic_password_token")):
            with self.assertRaises(runner.SafetyStop) as caught:
                runner.docker_read("inspect", runner.CONTAINER)
        self.assertEqual(str(caught.exception), "DOCKER_UNAVAILABLE")

    def test_remote_docker_host_override_is_rejected_before_dispatch(self):
        with patch.dict(os.environ, {"DOCKER_HOST": "tcp://synthetic-private.invalid:2375"}), \
                patch.object(runner.subprocess, "run") as call, self.assertRaises(runner.SafetyStop):
            runner.docker_read("inspect", runner.CONTAINER)
        call.assert_not_called()

    def test_read_only_engine_options_and_schema_exclude_public(self):
        with patch.object(runner, "create_engine", return_value=Mock()) as create:
            runner.test_engine(runner.check_url(URL), schema=SCHEMA, readonly=True)
        options = create.call_args.kwargs["connect_args"]["options"]
        self.assertIn("default_transaction_read_only=on", options)
        self.assertIn("search_path=" + SCHEMA, options)
        self.assertNotIn("public", options)
        self.assertEqual(create.call_args.kwargs["isolation_level"], "READ COMMITTED")

    def preflight_fixture(self, row=None, exists=False):
        engine = MagicMock()
        connection = engine.connect.return_value.__enter__.return_value
        connection.execute.return_value.one.return_value = row or (
            runner.DATABASE, runner.USER, "synthetic-postmaster-time", "on", 160000, True, True)
        connection.scalar.return_value = exists
        return engine, connection

    def test_preflight_uses_only_select_and_disposes_engine(self):
        engine, connection = self.preflight_fixture()
        with patch.object(runner, "check_container", return_value="container-id"), \
                patch.object(runner, "docker_read", return_value="synthetic-postmaster-time"), \
                patch.object(runner, "test_engine", return_value=engine) as create:
            self.assertEqual(runner.preflight(runner.check_url(URL), SCHEMA), "container-id")
        self.assertTrue(create.call_args.kwargs["readonly"])
        for call in connection.execute.call_args_list + connection.scalar.call_args_list:
            self.assertTrue(str(call.args[0]).startswith("SELECT"))
        engine.dispose.assert_called_once()

    def test_preflight_denies_wrong_db_user_fingerprint_and_non_readonly(self):
        for index, value in ((0, "other_database"), (1, "other_user"), (2, "other_server"), (3, "off"),
                             (4, 120000), (5, False), (6, False)):
            row = [runner.DATABASE, runner.USER, "synthetic-postmaster-time", "on", 160000, True, True]
            row[index] = value
            engine, _ = self.preflight_fixture(row)
            with patch.object(runner, "check_container", return_value="container-id"), \
                    patch.object(runner, "docker_read", return_value="synthetic-postmaster-time"), \
                    patch.object(runner, "test_engine", return_value=engine), self.assertRaises(runner.SafetyStop):
                runner.preflight(runner.check_url(URL), SCHEMA)
            engine.dispose.assert_called_once()

    def test_preflight_never_reuses_existing_schema(self):
        engine, _ = self.preflight_fixture(exists=True)
        with patch.object(runner, "check_container", return_value="container-id"), \
                patch.object(runner, "docker_read", return_value="synthetic-postmaster-time"), \
                patch.object(runner, "test_engine", return_value=engine), self.assertRaises(runner.SafetyStop):
            runner.preflight(runner.check_url(URL), SCHEMA)

    def test_preflight_denies_container_replacement(self):
        engine, _ = self.preflight_fixture()
        with patch.object(runner, "check_container", side_effect=["old", "new"]), \
                patch.object(runner, "docker_read", return_value="synthetic-postmaster-time"), \
                patch.object(runner, "test_engine", return_value=engine), self.assertRaises(runner.SafetyStop):
            runner.preflight(runner.check_url(URL), SCHEMA)

    def test_migration_requires_child_write_ack_before_any_ddl(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(runner, "test_engine") as create, \
                self.assertRaises(runner.SafetyStop):
            runner.migrate(runner.check_url(URL), SCHEMA, "container-id")
        create.assert_not_called()

    def test_preflight_branch_does_not_migrate_or_seed(self):
        env = {"NOIE_SECURITY_TEST_DATABASE_URL": URL, "NOIE_PG_TEST_SCHEMA": SCHEMA}
        with patch.dict(os.environ, env, clear=True), patch.object(runner, "preflight", return_value="id"), \
                patch.object(runner, "migrate") as migrate, patch.object(runner, "run_scenarios") as scenarios:
            report = runner.child_run(False)
        self.assertEqual(report["db_writes"], 0)
        migrate.assert_not_called()
        scenarios.assert_not_called()

    def test_write_branch_requires_ack_before_migration(self):
        env = runner.child_environment({}, runner.check_url(URL), SCHEMA, True)
        env["NOIE_PG_TEST_WRITE_ACK"] = "no"
        with patch.dict(os.environ, env, clear=True), patch.object(runner, "preflight", return_value="id"), \
                patch.object(runner, "migrate") as migrate, self.assertRaises(runner.SafetyStop):
            runner.child_run(True)
        migrate.assert_not_called()

    def test_child_cannot_import_runtime_with_unscoped_or_production_database_setting(self):
        env = runner.child_environment({}, runner.check_url(URL), SCHEMA, True)
        env["DATABASE_URL"] = "synthetic-production-secret"
        with patch.dict(os.environ, env, clear=True), patch.object(runner, "preflight") as preflight, \
                patch.object(runner, "migrate") as migrate, self.assertRaises(runner.SafetyStop):
            runner.child_run(True)
        preflight.assert_not_called()
        migrate.assert_not_called()

    def test_default_cli_spawns_only_preflight_child_without_secret_arguments(self):
        output = StringIO()
        completed = Mock(returncode=0, stdout=json.dumps({"verdict": "POSTGRES_LIFECYCLE_TEST_READY"}))
        with patch.dict(os.environ, {"NOIE_SECURITY_TEST_DATABASE_URL": URL}, clear=True), \
                patch.object(runner.subprocess, "run", return_value=completed) as call, redirect_stdout(output):
            self.assertEqual(runner.main([]), 0)
        command = call.call_args.args[0]
        self.assertNotIn("--run-writes", command)
        self.assertNotIn(URL, str(command))
        self.assertNotIn("synthetic_only", output.getvalue())
        self.assertEqual(call.call_args.kwargs["env"]["DATABASE_URL"], "")

    def test_unexpected_error_and_child_stderr_are_not_reflected(self):
        output, error = StringIO(), StringIO()
        with patch.dict(os.environ, {"NOIE_SECURITY_TEST_DATABASE_URL": URL}, clear=True), \
                patch.object(runner.subprocess, "run", side_effect=RuntimeError("synthetic_private")), \
                redirect_stdout(output), redirect_stderr(error):
            self.assertEqual(runner.main([]), 1)
        self.assertNotIn("synthetic_private", output.getvalue() + error.getvalue())


if __name__ == "__main__":
    unittest.main()
