"""설정 누락/오타 공격을 검사합니다. 실제 DB/provider/OpenAI 호출은 하지 않습니다."""

import os
import re
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

from fastapi.routing import APIRoute

import main
import auth_context as auth
from auth_ownership import require_core_principal
from evals import run_auth_access_tests as access


@contextmanager
def auth_config(value):
    """None은 환경변수 삭제를 뜻하며 검사 후 원래 환경을 보존합니다."""
    with patch.dict(os.environ):
        os.environ.pop("NOIE_AUTH_ENABLED", None)
        if value is not None:
            os.environ["NOIE_AUTH_ENABLED"] = value
        yield


class SecurityAuthFailClosedTests(unittest.TestCase):
    """기존 격리 fixture로 인증 전 업무 호출 차단과 개발 호환성을 검사합니다."""

    # DB/모델 호출은 mock이며 dependency override도 fixture 종료 때 보존됩니다.
    setUp = access.AuthAccessTests.setUp
    restore_overrides = access.AuthAccessTests.restore_overrides
    request = access.AuthAccessTests.request
    probe_request = access.AuthAccessTests.probe_request

    def assert_protected_routes_blocked(self, value):
        """실제 dependency 그래프에서 Core/Agent/chat 보호 경로를 모두 수집합니다."""
        def protected(dependant):
            return dependant.call in (auth.resolve_auth_principal, require_core_principal) or any(
                protected(child) for child in dependant.dependencies
            )

        routes = [route for route in main.app.routes
                  if isinstance(route, APIRoute) and protected(route.dependant)
                  and route.path != "/internal/background-probe"]
        paths = {route.path for route in routes}
        self.assertTrue({"/chat", "/orchestrate", "/agent/tool-plan", "/generate-title",
                         "/analyze-emotion", "/extract-daily-trace"} <= paths)
        self.assertIn("/memories", paths)
        self.assertIn("/agent/actions/plan", paths)
        with auth_config(value):
            self.assertTrue(auth.auth_enabled())
            for route in routes:
                # 유효 UUID 경로와 query만 전달합니다. 인증 차단은 업무/본문 처리보다 앞섭니다.
                path = re.sub(r"\{[^}]+\}", str(uuid4()), route.path)
                for method in route.methods:
                    with self.subTest(value=value, path=route.path, method=method):
                        response = self.client.request(method, path, json={},
                                                       params={"user_id": str(uuid4())})
                        self.assertEqual(response.status_code, 401)
            for business in self.business.values():
                business.assert_not_called()
            self.verify.assert_not_called()
            self.mapping.assert_not_called()
            self.db.execute.assert_not_called()

    def test_attack_config_001_typo_cannot_disable_auth(self):
        """ATTACK-CONFIG-001: fasle로 입력해도 보호 경로는 401입니다."""
        self.assert_protected_routes_blocked("fasle")

    def test_attack_config_002_missing_cannot_disable_auth(self):
        """ATTACK-CONFIG-002: 설정을 삭제해도 보호 경로는 401입니다."""
        self.assert_protected_routes_blocked(None)

    def test_empty_and_invalid_values_are_secure(self):
        """공백/오타/알 수 없는 문자열을 OFF로 해석하지 않습니다."""
        for value in ("", "   ", "true!", "enabled", "disable", "banana", "false!", "tru"):
            self.assert_protected_routes_blocked(value)

    def test_explicit_on_values_are_secure(self):
        """허용 ON 값과 대소문자/공백 변형은 모두 인증을 요구합니다."""
        for value in ("true", "1", "yes", "on", " TRUE ", " YeS ", " On "):
            self.assert_protected_routes_blocked(value)

    def test_explicit_off_preserves_dev_business(self):
        """네 가지 명시적 OFF만 기존 업무 응답을 허용합니다."""
        for value in ("false", "0", "no", "off", " FALSE ", " No ", " OFF "):
            with auth_config(value):
                self.assertFalse(auth.auth_enabled())
                self.assertIsNone(auth.resolve_auth_principal())
                for path in self.bodies:
                    self.assertEqual(self.request(path).status_code, 200)
        self.verify.assert_not_called()
        self.mapping.assert_not_called()

    def test_default_on_valid_identity_preserves_success(self):
        """누락/오타에서도 검증된 identity와 Principal은 기존 업무를 사용할 수 있습니다."""
        for value in (None, "", "fasle", "true"):
            with auth_config(value):
                for path in self.bodies:
                    response = self.request(path, {"Authorization": "Bearer test-token"})
                    self.assertEqual(response.status_code, 200)
        self.assertEqual(self.verify.call_count, 20)
        self.assertEqual(self.mapping.call_count, 20)

    def test_public_endpoints_and_bootstrap_contract(self):
        """health는 공개, bootstrap은 OFF 여부와 무관하게 JWT가 필요합니다."""
        for value in (None, "", "fasle", "true", "false", "0", "no", "off"):
            with auth_config(value):
                self.assertEqual(self.client.get("/").status_code, 200)
                self.assertEqual(self.client.get("/db-health").status_code, 200)
                self.assertEqual(str(self.db.execute.call_args.args[0]), "SELECT 1")
                self.assertEqual(self.client.post("/auth/bootstrap").status_code, 401)
        self.verify.assert_not_called()
        self.mapping.assert_not_called()

    def test_probe_policy_preserved(self):
        """비공개 probe의 OFF 404 우선 정책과 ON 인증 정책을 유지합니다."""
        for value in (None, "", "fasle", "true", "false"):
            with auth_config(value), patch.dict(os.environ, {"NOIE_BG_PROBE_ENDPOINT_ENABLED": "false"}):
                self.assertEqual(self.probe_request().status_code, 404)
        with patch.dict(os.environ, {"NOIE_BG_PROBE_ENDPOINT_ENABLED": "true"}):
            for value in (None, "", "fasle", "true"):
                with auth_config(value):
                    self.assertEqual(self.probe_request().status_code, 401)
            with auth_config("false"):
                self.assertEqual(self.probe_request().json(), {"status": "scheduled"})
        self.probe.assert_called_once()


if __name__ == "__main__":
    unittest.main()
