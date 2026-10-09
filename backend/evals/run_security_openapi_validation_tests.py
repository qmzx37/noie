"""등록된 합성 fixture로 422 HTTP/OpenAPI 정합성과 기존 권한 계약을 검증합니다."""

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

import main
from account_router import SafeAccountRoute
from admin_router import SafeAdminRoute
from auth_context import resolve_auth_principal
from database import get_db
from evals import run_security_account_deletion_tests as fixture
from evals.run_security_validation_privacy_tests import SECRET, SAFE_BODY, captured_logs
from validation_openapi import NoieValidationErrorBody, install_validation_openapi


class OpenApiValidationContractTests(unittest.TestCase):
    """앱 응답을 바꾸지 않고 문서만 실제 문자열 계약을 나타내는지 확인합니다."""

    setUp = fixture.AccountDeletionTests.setUp
    tearDown = fixture.AccountDeletionTests.tearDown
    count = fixture.AccountDeletionTests.count

    def documented_response(self, path, method="post"):
        """OpenAPI가 문서화한 body 모델과 실제 응답을 비교하기 위한 조회입니다."""
        document = main.app.openapi()
        response = document["paths"][path][method]["responses"]["422"]
        ref = response["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
        body = document["components"]["schemas"][ref]
        self.assertEqual(body["properties"]["detail"]["type"], "string")
        self.assertEqual(body["required"], ["detail"])
        self.assertFalse(body["additionalProperties"])
        return response

    def test_all_generated_validation_responses_use_string_not_array(self):
        document = main.app.openapi()
        checked = 0
        for route in main.app.routes:
            if not isinstance(route, APIRoute) or not route.include_in_schema:
                continue
            for method in route.methods:
                operation = document["paths"][route.path_format][method.lower()]
                if "422" not in operation["responses"]:
                    continue
                response = self.documented_response(route.path_format, method.lower())
                special = isinstance(route, (SafeAccountRoute, SafeAdminRoute))
                self.assertEqual("X-Noie-Error-Code" in response.get("headers", {}), not special)
                checked += 1
        self.assertGreater(checked, 40)

    def test_invalid_role_matches_document_and_redacts_input_and_logs(self):
        before = self.count("messages")
        with captured_logs() as logs:
            actual = self.client.post(f"/conversations/{self.ca.id}/messages",
                json={"role": SECRET, "content": "synthetic"})
        documented = self.documented_response("/conversations/{conversation_id}/messages")
        self.assertEqual(actual.status_code, 422)
        self.assertEqual(actual.json(), documented["content"]["application/json"]["example"])
        self.assertEqual(actual.json(), SAFE_BODY)
        NoieValidationErrorBody.model_validate(actual.json())
        allowed = documented["headers"]["X-Noie-Error-Code"]["schema"]["enum"]
        self.assertIn(actual.headers["X-Noie-Error-Code"], allowed)
        self.assertNotIn(SECRET, actual.text + "".join(s.getvalue() for s in logs))
        self.assertEqual(self.count("messages"), before)

    def test_account_contract_has_string_example_without_generic_header(self):
        actual = self.client.post("/account/delete", json={"confirmation": SECRET})
        documented = self.documented_response("/account/delete")
        self.assertEqual(actual.status_code, 422)
        self.assertEqual(actual.json(), documented["content"]["application/json"]["example"])
        self.assertNotIn("X-Noie-Error-Code", actual.headers)
        self.assertNotIn("X-Noie-Error-Code", documented.get("headers", {}))
        self.background_mock.assert_not_called()

    def test_admin_contract_has_string_example_without_generic_header(self):
        actual = self.client.post("/admin/break-glass", json={"target_user_id": str(self.bid),
            "scope": SECRET, "reason_code": "other", "ttl_seconds": 30})
        documented = self.documented_response("/admin/break-glass")
        self.assertEqual(actual.status_code, 422)
        self.assertEqual(actual.json(), documented["content"]["application/json"]["example"])
        self.assertNotIn("X-Noie-Error-Code", actual.headers)
        self.assertNotIn("X-Noie-Error-Code", documented.get("headers", {}))
        self.assertEqual(self.count("admin_break_glass_sessions"), 0)

    def test_valid_message_stays_201_and_original_content_is_unchanged(self):
        raw = "  synthetic original\nunchanged  "
        actual = self.client.post(f"/conversations/{self.ca.id}/messages", json={"role": "user", "content": raw})
        self.assertEqual(actual.status_code, 201)
        self.assertEqual(actual.json()["content"], raw)
        self.assertEqual(actual.json()["user_id"], str(self.aid))
        self.assertNotIn("X-Noie-Error-Code", actual.headers)

    def test_missing_auth_stays_401_before_db_access(self):
        main.app.dependency_overrides.pop(resolve_auth_principal)
        denied = Mock(side_effect=AssertionError("UNAUTHORIZED_DB_ACCESS"))
        main.app.dependency_overrides[get_db] = denied
        actual = self.client.post(f"/conversations/{self.ca.id}/messages", json={"role": SECRET, "content": "synthetic"})
        self.assertEqual(actual.status_code, 401)
        denied.assert_not_called()

    def test_foreign_user_and_conversation_stay_403_and_404(self):
        before = self.count("messages")
        self.assertEqual(self.client.post("/conversations", json={"user_id": str(self.bid)}).status_code, 403)
        actual = self.client.post(f"/conversations/{self.cb.id}/messages", json={"role": "user", "content": "synthetic"})
        self.assertEqual(actual.status_code, 404)
        self.assertEqual(self.count("messages"), before)

    def test_business_422_allows_string_without_validation_header(self):
        with patch("agent.behavior_router.analyze_owned_behavior",
                   side_effect=HTTPException(422, "분석 가능한 메시지 길이와 형식을 확인해 주세요.")):
            actual = self.client.get(f"/messages/{self.ma.id}/behavior")
        self.assertEqual(actual.status_code, 422)
        NoieValidationErrorBody.model_validate(actual.json())
        self.assertNotIn("X-Noie-Error-Code", actual.headers)
        header = self.documented_response("/messages/{message_id}/behavior", "get")["headers"]["X-Noie-Error-Code"]
        self.assertNotIn("required", header)
        self.assertIn("may omit", header["description"])

    def test_explicit_422_and_all_other_metadata_are_preserved(self):
        api = FastAPI(title="Synthetic contract", version="test")
        @api.get("/typed/{item}")
        def typed(item: int):
            return {"item": item}
        explicit = {"description": "Explicit synthetic response", "content": {"application/json": {"schema": {"type": "object"}}}}
        @api.get("/explicit/{item}", responses={422: explicit, 403: {"description": "Denied"}})
        def custom(item: int):
            return {"item": item}
        before = copy.deepcopy(api.openapi())
        install_validation_openapi(api)
        after = copy.deepcopy(api.openapi())
        self.assertEqual(after["paths"]["/explicit/{item}"], before["paths"]["/explicit/{item}"])
        after["paths"]["/typed/{item}"]["get"]["responses"]["422"] = before["paths"]["/typed/{item}"]["get"]["responses"]["422"]
        after["components"]["schemas"].pop("NoieValidationErrorBody")
        self.assertEqual(after, before)

    def test_openapi_cache_and_regeneration_are_consistent(self):
        first = main.app.openapi()
        self.assertIs(first, main.app.openapi())
        try:
            main.app.openapi_schema = None
            self.assertEqual(first, main.app.openapi())
        finally:
            main.app.openapi_schema = first

    def test_health_and_hidden_probe_do_not_gain_documented_422(self):
        document = main.app.openapi()
        self.assertNotIn("422", document["paths"]["/"]["get"]["responses"])
        self.assertNotIn("/internal/background-probe", document["paths"])

    def test_real_openapi_endpoint_respects_existing_startup_switch(self):
        """별도 Python에서 실제 main을 import해 startup 공개 설정을 바꾸지 않는지 검사합니다."""
        code = '''
import json, os
from evals.run_security_adversarial_verification import isolate
isolate(legacy_fixtures=True)
os.environ["NOIE_API_DOCS_ENABLED"] = os.environ["DOCS_TEST_SWITCH"]
import main
from fastapi.testclient import TestClient
response = TestClient(main.app).get("/openapi.json")
data = response.json() if response.status_code == 200 else {}
ref = data.get("paths", {}).get("/chat", {}).get("post", {}).get("responses", {}).get("422", {}).get("content", {}).get("application/json", {}).get("schema", {}).get("$ref")
print(json.dumps({"status": response.status_code, "ref": ref}))
'''
        for enabled, expected in (("true", 200), ("false", 404)):
            with self.subTest(enabled=enabled):
                env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
                env["DOCS_TEST_SWITCH"] = enabled
                result = subprocess.run([sys.executable, "-B", "-c", code], cwd=Path(__file__).resolve().parents[1],
                    env=env, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0)
                report = json.loads(result.stdout)
                self.assertEqual(report["status"], expected)
                if expected == 200:
                    self.assertEqual(report["ref"], "#/components/schemas/NoieValidationErrorBody")


if __name__ == "__main__":
    unittest.main()
