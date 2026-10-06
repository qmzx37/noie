"""비용 제한/identity/race를 로컬 mock으로 검사합니다. 실제 DB/provider/API 호출은 없습니다."""

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, redirect_stdout
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

import main
import auth_context as auth
import security_rate_limit as rate
from database import get_db
from security_config import rate_limit_enabled, rate_limit_number
from supabase_auth_verifier import TokenVerificationError
from auth_identity_service import IdentityMappingError
from evals.run_lv4_shadow_mode_tests import chat_fixture
from evals.run_security_api_surface_tests import configured_app


class Clock:
    """sleep 대신 통제된 monotonic 시간으로 만료를 검사합니다."""
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class RateLimitTests(unittest.TestCase):
    """실제 FastAPI 요청 경계는 사용하고 업무/인증 외부 호출은 고정합니다."""

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {
            "NOIE_AUTH_ENABLED": "true", "NOIE_RATE_LIMIT_ENABLED": "true",
            "NOIE_RATE_LIMIT_EXPENSIVE_PER_MINUTE": "2", "NOIE_RATE_LIMIT_STANDARD_PER_MINUTE": "2",
            "NOIE_RATE_LIMIT_PRE_AUTH_PER_MINUTE": "1000", "NOIE_RATE_LIMIT_BOOTSTRAP_PER_MINUTE": "2",
            "NOIE_RATE_LIMIT_PRE_AUTH_BOOTSTRAP_PER_MINUTE": "1000", "NOIE_RATE_LIMIT_HEALTH_PER_MINUTE": "600",
            "NOIE_RATE_LIMIT_INTERNAL_PER_MINUTE": "2", "NOIE_BG_PROBE_ENDPOINT_ENABLED": "false",
        }))
        self.clock = Clock()
        self.buckets = rate.InMemoryRateLimiter(clock=self.clock)
        self.stack.enter_context(patch.object(rate, "limiter", self.buckets))
        self.a, self.b = auth.AuthPrincipal(uuid4()), auth.AuthPrincipal(uuid4())
        self.identity = auth.VerifiedAuthIdentity("supabase", str(uuid4()))
        self.verify = self.stack.enter_context(patch("supabase_auth_verifier.verify_supabase_token", return_value=self.identity))
        self.mapping = self.stack.enter_context(patch("auth_identity_service.resolve_identity_principal", return_value=self.a))
        self.title = self.stack.enter_context(patch.object(main, "generate_title_with_openai", return_value="합성 제목"))
        self.db = Mock()
        previous = dict(main.app.dependency_overrides)
        self.stack.callback(lambda: (main.app.dependency_overrides.clear(), main.app.dependency_overrides.update(previous)))
        main.app.dependency_overrides.clear()

        def db_override():
            yield self.db

        main.app.dependency_overrides[get_db] = db_override
        self.client = self.stack.enter_context(TestClient(main.app))

    def call_title(self, token="synthetic-token", **kwargs):
        return self.client.post("/generate-title", json={"text": "fixture"},
                                headers={"Authorization": f"Bearer {token}"}, **kwargs)

    def test_flag_default_invalid_and_explicit_off(self):
        for value in (None, "", " ", "fasle", "unlimited", "true", "1", "yes", "on"):
            with patch.dict(os.environ):
                os.environ.pop("NOIE_RATE_LIMIT_ENABLED", None)
                if value is not None:
                    os.environ["NOIE_RATE_LIMIT_ENABLED"] = value
                self.assertTrue(rate_limit_enabled())
        for value in ("false", "0", "no", "off", " FALSE ", " No "):
            with patch.dict(os.environ, {"NOIE_RATE_LIMIT_ENABLED": value}):
                self.assertFalse(rate_limit_enabled())
                for _ in range(4):
                    self.assertEqual(self.call_title().status_code, 200)
        self.assertEqual(len(self.buckets._buckets), 0)

    def test_invalid_numbers_keep_safe_defaults(self):
        for name, default in rate.LIMITS.values():
            for value in ("", "zero", "0", "-1", "999999999999", "10001", "1.5", "NaN", "inf"):
                with self.subTest(name=name, value=value), patch.dict(os.environ, {name: value}):
                    self.assertEqual(rate_limit_number(name, default), default)
            with patch.dict(os.environ, {name: " 25 "}):
                self.assertEqual(rate_limit_number(name, default), 25)
        with patch.dict(os.environ, {"NOIE_RATE_LIMIT_MAX_BUCKETS": "99999"}):
            self.assertEqual(rate_limit_number("NOIE_RATE_LIMIT_MAX_BUCKETS", 10000, 50000), 10000)

    def test_missing_empty_invalid_flag_still_limits_real_http(self):
        for value in (None, "", "fasle"):
            with patch.dict(os.environ), patch.object(rate, "limiter", rate.InMemoryRateLimiter(clock=self.clock)):
                os.environ.pop("NOIE_RATE_LIMIT_ENABLED", None)
                if value is not None:
                    os.environ["NOIE_RATE_LIMIT_ENABLED"] = value
                for index in range(3):
                    self.assertEqual(self.call_title().status_code, 200 if index < 2 else 429)

    def test_n_and_n_plus_one_retry_after_safe_response(self):
        self.assertEqual(self.call_title().status_code, 200)
        self.assertEqual(self.call_title().status_code, 200)
        response = self.call_title()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json(), {"detail": rate.RATE_LIMIT_MESSAGE})
        self.assertEqual(response.headers["retry-after"], "60")
        self.assertNotIn(str(self.a.user_id), response.text + str(response.headers))
        self.assertEqual(self.title.call_count, 2)

    def test_attack_rate_001_chat_blocks_before_all_business(self):
        with chat_fixture(enabled=False) as (_, mocks), redirect_stdout(StringIO()):
            body = {"text": "fixture", "request_id": str(uuid4())}
            for _ in range(2):
                self.assertEqual(self.client.post("/chat", json=body, headers={"Authorization": "Bearer fixture"}).status_code, 200)
            for work in mocks.values():
                work.reset_mock()
            response = self.client.post("/chat", json=body, headers={"Authorization": "Bearer fixture"})
            self.assertEqual(response.status_code, 429)
            for work in mocks.values():
                work.assert_not_called()

    def test_attack_rate_002_account_b_is_not_limited_by_a(self):
        self.call_title()
        self.call_title()
        self.assertEqual(self.call_title().status_code, 429)
        self.mapping.return_value = self.b
        self.assertEqual(self.call_title().status_code, 200)

    def test_attack_rate_003_refreshed_token_keeps_principal_bucket(self):
        self.assertEqual(self.call_title("old-token").status_code, 200)
        self.assertEqual(self.call_title("new-token").status_code, 200)
        self.assertEqual(self.call_title("another-token").status_code, 429)

    def test_attack_rate_004_body_query_headers_cannot_select_bucket(self):
        for supplied in (self.a.user_id, self.b.user_id):
            self.assertEqual(self.client.post("/generate-title", json={"text": "fixture", "user_id": str(supplied)},
                params={"user_id": str(supplied)}, headers={"Authorization": "Bearer fixture", "user_id": str(supplied)}).status_code, 200)
        self.assertEqual(self.call_title().status_code, 429)
        self.assertEqual(self.mapping.call_count, 3)

    def test_shared_expensive_bucket_prevents_endpoint_hopping(self):
        self.call_title()
        self.call_title()
        with patch.object(main, "analyze_text") as business:
            response = self.client.post("/analyze-emotion", json={"text": "fixture"}, headers={"Authorization": "Bearer fixture"})
            self.assertEqual(response.status_code, 429)
            business.assert_not_called()
        self.assertEqual(rate.request_group("/messages/fixture/extract-memory"), "EXPENSIVE_AI")
        self.assertEqual(rate.request_group("/agent/actions/fixture/execute"), "EXPENSIVE_AI")

    def test_attack_rate_005_concurrent_chat_business_never_exceeds_limit(self):
        os.environ["NOIE_RATE_LIMIT_EXPENSIVE_PER_MINUTE"] = "5"
        with chat_fixture(enabled=False) as (_, mocks), redirect_stdout(StringIO()):
            def call(_):
                return self.client.post("/chat", json={"text": "fixture", "request_id": str(uuid4())},
                                        headers={"Authorization": "Bearer fixture"}).status_code
            with ThreadPoolExecutor(max_workers=12) as pool:
                statuses = list(pool.map(call, range(24)))
            self.assertEqual(statuses.count(200), 5)
            self.assertEqual(statuses.count(429), 19)
            self.assertEqual(mocks["begin_chat_request"].call_count, 5)
            self.assertEqual(mocks["generate_chat_reply_with_openai"].call_count, 5)
            self.assertEqual(mocks["complete_chat_request"].call_count, 5)

    def test_atomic_counter_under_thread_burst(self):
        with ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(lambda _: self.buckets.consume("test", "digest", 10), range(100)))
        self.assertEqual(results.count(None), 10)
        self.assertEqual(len([result for result in results if result is not None]), 90)

    def test_expiry_and_monotonic_retry_after(self):
        self.call_title()
        self.call_title()
        self.clock.now = 59.2
        self.assertEqual(self.call_title().headers["retry-after"], "1")
        self.clock.now = 60
        self.assertEqual(self.call_title().status_code, 200)

    def test_stale_bucket_cleanup_and_bounded_capacity(self):
        bounded = rate.InMemoryRateLimiter(clock=self.clock, max_buckets=2)
        self.assertIsNone(bounded.consume("test", "one", 2))
        self.assertIsNone(bounded.consume("test", "two", 2))
        self.assertEqual(bounded.consume("test", "three", 2), 60)
        self.assertIsNone(bounded.consume("test", "one", 2))
        self.assertEqual(bounded.consume("test", "one", 2), 60)
        self.assertEqual(len(bounded._buckets), 2)
        self.clock.now = 60
        self.assertIsNone(bounded.consume("test", "three", 2))
        self.assertEqual(len(bounded._buckets), 1)

    def test_auth_errors_remain_401_and_403_before_user_limit(self):
        self.call_title()
        self.call_title()
        self.assertEqual(self.client.post("/generate-title", json={"text": "fixture"}).status_code, 401)
        self.assertEqual(self.client.post("/generate-title", json={"text": "fixture"}, headers={"Authorization": "wrong"}).status_code, 401)
        self.verify.side_effect = TokenVerificationError("PRIVATE_TOKEN_ERROR")
        self.assertEqual(self.call_title().status_code, 401)
        self.verify.side_effect = None
        self.mapping.side_effect = IdentityMappingError("PRIVATE_MAPPING_ERROR")
        self.assertEqual(self.call_title().status_code, 403)

    def test_pre_auth_blocks_verifier_and_ignores_forwarded_headers(self):
        os.environ["NOIE_RATE_LIMIT_PRE_AUTH_PER_MINUTE"] = "2"
        self.verify.side_effect = TokenVerificationError("PRIVATE_TOKEN_ERROR")
        for index in range(3):
            response = self.client.post("/generate-title", json={"text": "fixture"}, headers={
                "Authorization": "Bearer fixture", "X-Forwarded-For": f"spoof-{index}", "Forwarded": f"for=spoof-{index}"})
            self.assertEqual(response.status_code, 401 if index < 2 else 429)
        self.assertEqual(self.verify.call_count, 2)
        self.mapping.assert_not_called()

    def test_public_health_uses_separate_generous_budget(self):
        os.environ["NOIE_RATE_LIMIT_PRE_AUTH_PER_MINUTE"] = "1"
        self.call_title()
        self.assertEqual(self.call_title().status_code, 429)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/db-health").status_code, 200)
        self.assertEqual(str(self.db.execute.call_args.args[0]), "SELECT 1")

    def test_health_limit_prevents_db_query_when_exceeded(self):
        os.environ["NOIE_RATE_LIMIT_HEALTH_PER_MINUTE"] = "1"
        self.assertEqual(self.client.get("/db-health").status_code, 200)
        self.db.execute.reset_mock()
        self.assertEqual(self.client.get("/db-health").status_code, 429)
        self.db.execute.assert_not_called()

    def test_probe_off_stays_404_even_when_peer_limit_exceeded(self):
        os.environ["NOIE_RATE_LIMIT_PRE_AUTH_PER_MINUTE"] = "1"
        self.call_title()
        self.assertEqual(self.call_title().status_code, 429)
        with patch.object(main, "run_background_probe") as probe:
            self.assertEqual(self.client.post("/internal/background-probe", params={"request_id": str(uuid4())}).status_code, 404)
            probe.assert_not_called()

    def test_probe_on_limits_before_background_scheduling(self):
        os.environ["NOIE_BG_PROBE_ENDPOINT_ENABLED"] = "true"
        with patch.object(main, "run_background_probe") as probe:
            for index in range(3):
                response = self.client.post("/internal/background-probe", params={"request_id": str(uuid4())},
                                            headers={"Authorization": "Bearer fixture"})
                self.assertEqual(response.status_code, 200 if index < 2 else 429)
            self.assertEqual(probe.call_count, 2)

    def test_bootstrap_jwt_required_and_verified_identity_limit_before_write(self):
        with patch("auth_bootstrap_router.verify_supabase_token", return_value=self.identity), \
                patch("auth_bootstrap_router.bootstrap_auth_identity") as bootstrap:
            self.assertEqual(self.client.post("/auth/bootstrap").status_code, 401)
            for index in range(3):
                response = self.client.post("/auth/bootstrap", headers={"Authorization": f"Bearer rotated-{index}"})
                self.assertEqual(response.status_code, 200 if index < 2 else 429)
            self.assertEqual(bootstrap.call_count, 2)

    def test_normal_crud_is_limited_before_business(self):
        with patch("chat_storage_router.list_user_conversations", return_value=[]) as business:
            for index in range(3):
                response = self.client.get(f"/users/{self.a.user_id}/conversations", headers={"Authorization": "Bearer fixture"})
                self.assertEqual(response.status_code, 200 if index < 2 else 429)
            self.assertEqual(business.call_count, 2)

    def test_off_development_http_remains_peer_limited_unless_explicitly_disabled(self):
        os.environ["NOIE_AUTH_ENABLED"] = "false"
        for index in range(3):
            self.assertEqual(self.call_title().status_code, 200 if index < 2 else 429)
        self.verify.assert_not_called()
        self.mapping.assert_not_called()

    def test_bucket_and_errors_contain_no_raw_identity_token_or_logs(self):
        with redirect_stdout(StringIO()) as logs:
            self.call_title("PRIVATE_ACCESS_TOKEN")
            self.call_title("PRIVATE_ACCESS_TOKEN")
            response = self.call_title("PRIVATE_ACCESS_TOKEN")
        serialized = str(self.buckets._buckets) + response.text + str(response.headers) + logs.getvalue()
        for secret in (str(self.a.user_id), self.identity.subject, "PRIVATE_ACCESS_TOKEN", "testclient"):
            self.assertNotIn(secret, serialized)
        self.assertEqual(logs.getvalue(), "")

    def test_pre_auth_429_preserves_cors_and_docs_policy(self):
        os.environ["NOIE_RATE_LIMIT_PRE_AUTH_PER_MINUTE"] = "1"
        with configured_app("https://app.example.com") as (client, _, _, _):
            headers = {"Origin": "https://app.example.com"}
            self.assertEqual(client.post("/chat", json={"text": "fixture"}, headers=headers).status_code, 401)
            response = client.post("/chat", json={"text": "fixture"}, headers=headers)
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["access-control-allow-origin"], "https://app.example.com")
            self.assertEqual(client.get("/docs").status_code, 404)
            preflight = client.options("/chat", headers={**headers, "Access-Control-Request-Method": "POST",
                                                        "Access-Control-Request-Headers": "Authorization, Content-Type"})
            self.assertEqual(preflight.status_code, 200)


if __name__ == "__main__":
    unittest.main()
