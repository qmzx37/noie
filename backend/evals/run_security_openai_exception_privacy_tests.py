"""OpenAI 예외 로그만 검증하며 합성 SDK와 기존 격리 실행기를 사용합니다."""

import contextlib
import io
import json
import logging
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

# 운영 .env나 외부 서비스가 연결된 상태에서는 실행하지 않습니다.
if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Run with the isolated security adversarial verifier")

import main
import openai_analyzer
from pydantic import BaseModel, ValidationError


SECRET = "SYNTHETIC_PASSWORD_TOKEN_USER_TEXT"


@contextlib.contextmanager
def captured_output():
    """실제 stdout/stderr/logger를 캡처하되 예외 문자열을 출력하지 않습니다."""
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    logging.getLogger().addHandler(handler)
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            yield output
    finally:
        logging.getLogger().removeHandler(handler)
        handler.close()


class OpenAIExceptionPrivacyTests(unittest.TestCase):
    """본문 보호, 고정 분류, 기존 재전파/fallback/정상 분석을 확인합니다."""

    def safe_output(self, error):
        """공통 검사에서도 비밀 원문을 출력하거나 예외를 문자열화하지 않습니다."""
        with captured_output() as output:
            openai_analyzer.print_openai_error(error)
        value = output.getvalue()
        self.assertNotIn(SECRET, value)
        return value

    def test_sdk_body_and_exception_formatting_are_never_read(self):
        """SDK 문자열/body/response 접근을 실패시켜 상태 기반 분류만 허용합니다."""
        class SDKError(RuntimeError):
            def __str__(self):
                """원문 문자열화가 시도되면 검사에 실패합니다."""
                raise AssertionError("EXCEPTION_STRING_READ")

            def __repr__(self):
                """원문 repr이 시도되면 검사에 실패합니다."""
                raise AssertionError("EXCEPTION_REPR_READ")

            @property
            def body(self):
                """SDK 응답 본문은 진단 목적으로도 읽지 않습니다."""
                raise AssertionError("SDK_BODY_READ")

            @property
            def response(self):
                """SDK 응답 객체는 로그 분류에 사용하지 않습니다."""
                raise AssertionError("SDK_RESPONSE_READ")

        for status, reason in ((None, "openai_error"), (401, "authentication_error"),
                               (429, "rate_limit_error"), (400, "request_configuration_error"),
                               (404, "request_configuration_error")):
            with self.subTest(status=status):
                error = SDKError(SECRET)
                error.status_code = status
                self.assertIn("reason=" + reason, self.safe_output(error))

    def test_json_document_and_message_are_private(self):
        """잘못된 JSON의 문서와 오류 메시지는 기록하지 않습니다."""
        output = self.safe_output(json.JSONDecodeError(SECRET, SECRET, 0))
        self.assertIn("JSON 파싱 문제: JSONDecodeError", output)
        self.assertIn("reason=json_parse_error", output)

    def test_validation_input_and_context_are_private(self):
        """Pydantic 입력값과 context 대신 고정 검증 오류를 기록합니다."""
        class SyntheticModel(BaseModel):
            """합성 비밀값으로 타입 오류만 발생시킵니다."""
            value: int

        with self.assertRaises(ValidationError) as raised:
            SyntheticModel(value=SECRET)
        self.assertIn("ValidationError reason=validation_error", self.safe_output(raised.exception))

    def test_custom_exception_name_is_not_logged(self):
        """사용자 값이 클래스명에 있어도 허용 목록 외에는 OtherError입니다."""
        kind = type(SECRET, (RuntimeError,), {})
        self.assertIn("OtherError reason=openai_error", self.safe_output(kind(SECRET)))

    def test_non_integer_status_is_not_compared_or_formatted(self):
        """임의 상태 객체를 숫자로 변환하거나 문자열화하지 않습니다."""
        class PrivateStatus:
            def __eq__(self, other):
                """잘못된 상태 객체의 비교를 감지합니다."""
                raise AssertionError("STATUS_COMPARED")

            def __str__(self):
                """상태 객체의 원문 출력 시도를 감지합니다."""
                raise AssertionError("STATUS_FORMATTED")

        error = RuntimeError(SECRET)
        error.status_code = PrivateStatus()
        self.assertIn("reason=openai_error", self.safe_output(error))

    def test_known_connection_and_timeout_categories_are_fixed(self):
        """연결/시간 초과 오류도 본문 없이 정해진 reason만 남깁니다."""
        for kind, reason in ((ConnectionError, "connection_error"), (TimeoutError, "timeout_error")):
            with self.subTest(kind=kind.__name__):
                self.assertIn("reason=" + reason, self.safe_output(kind(SECRET)))

    def test_sdk_failure_still_reraises_original_exception(self):
        """로그 보호가 기존 SDK 예외 재전파를 성공 응답으로 바꾸지 않습니다."""
        client = Mock()
        error = RuntimeError(SECRET)
        client.responses.create.side_effect = error
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-only"}), \
                patch("openai.OpenAI", return_value=client), captured_output() as output:
            with self.assertRaises(RuntimeError) as raised:
                openai_analyzer.analyze_with_openai("synthetic input")
        self.assertIs(raised.exception, error)
        self.assertNotIn(SECRET, output.getvalue())
        client.responses.create.assert_called_once()

    def test_sdk_failure_keeps_rule_based_fallback(self):
        """실제 분석 진입점의 SDK 실패 뒤 기존 규칙 기반 응답을 유지합니다."""
        client = Mock()
        client.responses.create.side_effect = RuntimeError(SECRET)
        # 저장 제안은 별도 SDK 흐름이므로 이번 분석 fallback 검사에서는 분리합니다.
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-only"}), \
                patch("openai.OpenAI", return_value=client), \
                patch.object(main, "build_save_decision", return_value={
                    "subjectScope": "self", "selfRelevance": "direct", "shouldStore": False}), \
                captured_output() as output:
            result, source = main.analyze_text("안녕 나 좀 신나")
        self.assertEqual(source, "rule_based")
        self.assertEqual(result["source"], "rule_based")
        self.assertIn("user_view", result)
        self.assertIn("admin_view", result)
        self.assertNotIn(SECRET, output.getvalue() + json.dumps(result))
        client.responses.create.assert_called_once()

    def test_successful_sdk_analysis_is_unchanged(self):
        """합성 SDK 정상 JSON은 기존 분석 결과와 openai 출처를 유지합니다."""
        payload = {"primary_axis": {"like": .8, "dislike": .1},
                   "emotion_axis": {axis: .2 for axis in "FADJCGTR"},
                   "state_summary": "synthetic summary"}
        client = Mock()
        client.responses.create.return_value = SimpleNamespace(output_text=json.dumps(payload))
        # 정상 분석 결과도 저장 제안용 응답 형식과 혼합하지 않습니다.
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-only"}), \
                patch("openai.OpenAI", return_value=client), \
                patch.object(main, "build_save_decision", return_value={
                    "subjectScope": "self", "selfRelevance": "direct", "shouldStore": False}), \
                captured_output() as output:
            result, source = main.analyze_text("synthetic input")
        self.assertEqual(source, "openai")
        self.assertEqual(result["admin_view"]["primary_axis"], payload["primary_axis"])
        self.assertEqual(result["user_view"]["state_summary"], payload["state_summary"])
        self.assertEqual(output.getvalue(), "")
        client.responses.create.assert_called_once()


if __name__ == "__main__":
    raise SystemExit("Use the isolated security adversarial verifier")
