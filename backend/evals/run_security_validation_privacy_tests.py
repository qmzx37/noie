"""422 개인정보 회귀 검사입니다. 등록된 합성 SQLite fixture만 사용합니다."""

import asyncio
import json
import logging
import unittest
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from io import StringIO
from unittest.mock import Mock
from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError

import main
from auth_context import resolve_auth_principal
from database import get_db
from evals import run_security_account_deletion_tests as fixture


SECRET = "SYNTHETIC_VALIDATION_PASSWORD_TOKEN_ONLY"
SAFE_BODY = {"detail": "요청 형식이 올바르지 않습니다."}
SAFE_CODE = "request_validation_error"


@contextmanager
def captured_logs():
    """print와 경고 로그를 직접 수집하며 logger를 무음 mock으로 바꾸지 않습니다."""
    out, err, warnings = StringIO(), StringIO(), StringIO()
    handler = logging.StreamHandler(warnings)
    handler.setLevel(logging.WARNING)
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        with redirect_stdout(out), redirect_stderr(err):
            yield out, err, warnings
    finally:
        root.removeHandler(handler)
        handler.close()


class ValidationPrivacyTests(unittest.TestCase):
    """실제 FastAPI validation/인증/소유권/원문 저장 경계를 검증합니다."""

    setUp = fixture.AccountDeletionTests.setUp
    tearDown = fixture.AccountDeletionTests.tearDown
    count = fixture.AccountDeletionTests.count

    def assert_safe(self, response):
        """입력, 자유 형식 msg, ctx, 사용자 기반 loc을 전혀 반환하지 않습니다."""
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json(), SAFE_BODY)
        self.assertEqual(response.headers.get("X-Noie-Error-Code"), SAFE_CODE)
        self.assertNotIn(SECRET, response.text)
        self.assertFalse(set(response.json()) & {"input", "ctx", "msg", "loc", "body"})

    def test_invalid_role_is_redacted_and_no_message_is_created(self):
        before = self.count("messages")
        with captured_logs() as logs:
            response = self.client.post(f"/conversations/{self.ca.id}/messages",
                json={"role": SECRET, "content": "synthetic"})
        self.assert_safe(response)
        self.assertEqual(self.count("messages"), before)
        self.assertNotIn(SECRET, "".join(stream.getvalue() for stream in logs))

    def test_nested_invalid_value_does_not_reflect_password_or_token(self):
        response = self.client.post(f"/conversations/{self.ca.id}/messages",
            json={"role": "user", "content": {"password": SECRET, "token": SECRET}})
        self.assert_safe(response)

    def test_required_field_missing_stays_422(self):
        response = self.client.post(f"/conversations/{self.ca.id}/messages", json={"role": "user"})
        self.assert_safe(response)

    def test_wrong_type_stays_422(self):
        response = self.client.post(f"/conversations/{self.ca.id}/messages",
            json={"role": [SECRET], "content": 123})
        self.assert_safe(response)

    def test_forbidden_field_name_and_value_are_not_reflected(self):
        response = self.client.post(f"/agent/actions/{uuid4()}/execute",
            json={"user_id": str(self.aid), SECRET: SECRET})
        self.assert_safe(response)
        self.assertEqual(self.count("agent_actions"), 0)

    def test_malformed_json_stays_safe_422(self):
        with captured_logs() as logs:
            response = self.client.post(f"/conversations/{self.ca.id}/messages",
                content='{"content":"' + SECRET, headers={"Content-Type": "application/json"})
        self.assert_safe(response)
        self.assertNotIn(SECRET, "".join(stream.getvalue() for stream in logs))

    def test_invalid_path_uuid_stays_safe_422(self):
        self.assert_safe(self.client.get(f"/conversations/{SECRET}/messages"))

    def test_valid_roles_preserve_original_content_and_owner(self):
        raw = "  synthetic original\nunchanged  "
        for role, owner in (("user", str(self.aid)), ("assistant", None), ("system", None)):
            with self.subTest(role=role):
                response = self.client.post(f"/conversations/{self.ca.id}/messages",
                    json={"role": role, "content": raw})
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json()["content"], raw)
                self.assertEqual(response.json()["role"], role)
                self.assertEqual(response.json()["user_id"], owner)
                self.assertNotIn("X-Noie-Error-Code", response.headers)

    def test_missing_auth_stays_401_without_db_access(self):
        main.app.dependency_overrides.pop(resolve_auth_principal)
        denied = Mock(side_effect=AssertionError("UNAUTHORIZED_DB_ACCESS"))
        main.app.dependency_overrides[get_db] = denied
        response = self.client.post(f"/conversations/{self.ca.id}/messages",
            json={"role": SECRET, "content": "synthetic"})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn(SECRET, response.text)
        denied.assert_not_called()

    def test_cross_user_stays_403_and_conversation_not_created(self):
        before = self.count("conversations")
        response = self.client.post("/conversations", json={"user_id": str(self.bid), "title": "synthetic"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.count("conversations"), before)

    def test_foreign_conversation_stays_404_and_no_message_write(self):
        before = self.count("messages")
        response = self.client.post(f"/conversations/{self.cb.id}/messages",
            json={"role": "user", "content": "synthetic"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.count("messages"), before)
        self.assertNotIn(self.mb.content, response.text)

    def test_exception_input_message_context_and_location_are_not_read(self):
        """오류 객체를 읽지 않아 직렬화 예외와 custom validator 비밀 반사를 막습니다."""
        class UnsafeValidationError(RequestValidationError):
            def errors(self):
                raise AssertionError("VALIDATION_ERRORS_MUST_NOT_BE_READ")

            def __str__(self):
                raise AssertionError("VALIDATION_EXCEPTION_MUST_NOT_BE_FORMATTED")

        error = UnsafeValidationError([{"type": "value_error", "loc": ("body", SECRET),
            "msg": SECRET, "input": SECRET, "ctx": {"error": ValueError(SECRET)}}], body=SECRET)
        request = Request({"type": "http", "method": "POST", "path": "/chat", "headers": []})
        handler = main.app.exception_handlers.get(RequestValidationError)
        self.assertIsNotNone(handler)
        with captured_logs() as logs:
            response = asyncio.run(handler(request, error))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(json.loads(response.body), SAFE_BODY)
        self.assertEqual(response.headers.get("X-Noie-Error-Code"), SAFE_CODE)
        self.assertNotIn(SECRET, "".join(stream.getvalue() for stream in logs))

    def test_account_validation_keeps_own_safe_contract(self):
        response = self.client.post("/account/delete", json={"confirmation": SECRET})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json(), {"detail": "계정 요청 형식이 올바르지 않습니다."})
        self.assertEqual(self.count("admin_audit_logs"), 0)
        self.background_mock.assert_not_called()

    def test_admin_validation_keeps_own_safe_contract(self):
        response = self.client.post("/admin/break-glass", json={"target_user_id": str(self.bid),
            "scope": SECRET, "reason_code": "other", "ttl_seconds": 30})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json(), {"detail": "관리자 요청 형식이 올바르지 않습니다."})
        self.assertEqual(self.count("admin_break_glass_sessions"), 0)


if __name__ == "__main__":
    unittest.main()
