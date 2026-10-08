"""Project 예외 로그 회귀 검사입니다. 합성 정보와 mock만 사용하며 외부 요청은 없습니다."""

import unittest
from contextlib import ExitStack, contextmanager, redirect_stderr, redirect_stdout
from io import StringIO
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from chat_persistence_service import AuthenticatedOwnershipError
from evals.chat_test_fixture import chat_fixture


PRIVATE = "SYNTHETIC_USER_TEXT password=SYNTHETIC_PASSWORD token=SYNTHETIC_TOKEN Memory=SYNTHETIC_MEMORY"


@contextmanager
def project_fixture(*, error=None, fallback_error=None, source="rule_based"):
    """실제 HTTP/Project 분기를 실행하고 모델 및 저장 경계만 고정합니다."""
    with chat_fixture(enabled=False, persisted=False) as (context, mocks), ExitStack() as stack:
        stack.enter_context(patch.dict(main.os.environ, {
            "NOIE_AUTH_ENABLED": "false", "NOIE_LV4_PRODUCTION_ENABLED": "false",
        }))
        combined = stack.enter_context(patch.object(main, "generate_project_chat_reply_with_checkpoint_openai",
            return_value={"reply": "synthetic project reply", "checkpoint_draft": None}, side_effect=error))
        mocks["generate_chat_reply_with_openai"].side_effect = fallback_error
        mocks["generate_chat_reply_with_openai"].return_value = "synthetic fallback reply"
        fallback = stack.enter_context(patch.object(main, "fallback_chat_reply", return_value="synthetic rule reply"))
        analysis, _ = mocks["analyze_text"].return_value
        analysis["source"] = source
        mocks["analyze_text"].return_value = (analysis, source)
        yield context, mocks, combined, fallback


class ProjectLogPrivacyTests(unittest.TestCase):
    """HTTP 출력, 저장 인자, stdout/stderr와 기존 오류 응답을 함께 확인합니다."""

    def send(self, context):
        """TestClient 검증이며 실제 Render나 SDK 실행을 의미하지 않습니다."""
        return TestClient(main.app).post("/chat", json={
            "text": "synthetic project input", "is_project": True,
            "request_id": str(context.request_id),
        })

    def assert_private_absent(self, response, logs):
        """비밀 값, 원문 및 traceback이 응답/로그에 복제되지 않아야 합니다."""
        for marker in PRIVATE.split():
            self.assertNotIn(marker, response.text + logs)
        self.assertNotIn("Traceback", logs)

    def test_raw_exception_is_not_logged_or_returned_and_reply_is_saved_unchanged(self):
        with project_fixture(error=RuntimeError(PRIVATE)) as (context, mocks, combined, fallback), \
                redirect_stdout(StringIO()) as stdout, redirect_stderr(StringIO()) as stderr:
            response = self.send(context)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], "synthetic fallback reply")
        self.assertIsNone(response.json()["checkpoint_draft"])
        combined.assert_called_once()
        fallback.assert_not_called()
        self.assertEqual(mocks["complete_chat_request"].call_args.args[1:3],
            (response.json()["reply"], "openai"))
        self.assert_private_absent(response, stdout.getvalue() + stderr.getvalue())
        self.assertIn("reason=project_reply_error error_type=RuntimeError", stdout.getvalue())

    def test_only_allowlisted_exception_types_are_logged(self):
        for kind in (RuntimeError, ValueError, TypeError, TimeoutError):
            with self.subTest(kind=kind.__name__), project_fixture(error=kind(PRIVATE)) as (context, *_), \
                    redirect_stdout(StringIO()) as stdout, redirect_stderr(StringIO()) as stderr:
                response = self.send(context)
            self.assertEqual(response.status_code, 200)
            self.assert_private_absent(response, stdout.getvalue() + stderr.getvalue())
            self.assertIn("reason=project_reply_error error_type=" + kind.__name__, stdout.getvalue())

    def test_custom_exception_name_is_not_a_log_authority(self):
        """예외 클래스명에도 원문이 들어갈 수 있으므로 동적 이름을 기록하지 않습니다."""
        kind = type("SYNTHETIC_PRIVATE_CLASS_NAME", (RuntimeError,), {})
        with project_fixture(error=kind(PRIVATE)) as (context, *_), redirect_stdout(StringIO()) as logs:
            response = self.send(context)
        self.assertEqual(response.status_code, 200)
        self.assert_private_absent(response, logs.getvalue())
        self.assertNotIn(kind.__name__, logs.getvalue())
        self.assertIn("error_type=OtherError", logs.getvalue())

    def test_exception_string_is_never_evaluated(self):
        """관측을 위해 예외 __str__를 호출하지 않는지 직접 확인합니다."""
        class UnsafeStringError(Exception):
            def __str__(self):
                raise AssertionError("SYNTHETIC_EXCEPTION_STRING_EVALUATED")

        with project_fixture(error=UnsafeStringError()) as (context, *_), redirect_stdout(StringIO()) as logs:
            response = self.send(context)
        self.assertEqual(response.status_code, 200)
        self.assertIn("error_type=OtherError", logs.getvalue())

    def test_normal_project_keeps_reply_and_does_not_log_failure(self):
        with project_fixture() as (context, mocks, combined, fallback), redirect_stdout(StringIO()) as logs:
            response = self.send(context)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], "synthetic project reply")
        combined.assert_called_once()
        mocks["generate_chat_reply_with_openai"].assert_not_called()
        fallback.assert_not_called()
        self.assertEqual(mocks["complete_chat_request"].call_args.args[1:3],
            (response.json()["reply"], "project"))
        self.assertNotIn("project combined reply failed", logs.getvalue())

    def test_existing_double_failure_rule_and_fallback_sources_are_preserved(self):
        """새 fallback은 만들지 않고 기존 두 분석 source의 저장 계약을 검사합니다."""
        for source, expected in (("rule_based", "rule"), ("openai", "fallback")):
            with self.subTest(source=source), project_fixture(error=RuntimeError(PRIVATE),
                    fallback_error=RuntimeError(PRIVATE), source=source) as (context, mocks, _, fallback), \
                    redirect_stdout(StringIO()) as stdout, redirect_stderr(StringIO()) as stderr:
                response = self.send(context)
            self.assertEqual(response.status_code, 200)
            fallback.assert_called_once()
            self.assertEqual(response.json()["reply"], "synthetic rule reply")
            self.assertEqual(mocks["complete_chat_request"].call_args.args[1:3],
                (response.json()["reply"], expected))
            self.assert_private_absent(response, stdout.getvalue() + stderr.getvalue())

    def test_ownership_denial_stays_403_and_never_calls_project(self):
        with project_fixture() as (context, mocks, combined, _), redirect_stdout(StringIO()) as stdout, \
                redirect_stderr(StringIO()) as stderr:
            mocks["begin_chat_request"].side_effect = AuthenticatedOwnershipError(PRIVATE)
            response = self.send(context)
        self.assertEqual(response.status_code, 403)
        combined.assert_not_called()
        mocks["complete_chat_request"].assert_not_called()
        self.assert_private_absent(response, stdout.getvalue() + stderr.getvalue())

    def test_storage_denial_stays_403_after_project_fallback(self):
        with project_fixture(error=RuntimeError(PRIVATE)) as (context, mocks, _, _), \
                redirect_stdout(StringIO()) as stdout, redirect_stderr(StringIO()) as stderr:
            mocks["complete_chat_request"].side_effect = AuthenticatedOwnershipError(PRIVATE)
            response = self.send(context)
        self.assertEqual(response.status_code, 403)
        mocks["complete_chat_request"].assert_called_once()
        self.assert_private_absent(response, stdout.getvalue() + stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
