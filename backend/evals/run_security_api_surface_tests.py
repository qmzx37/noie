"""CORS/API surface 계약 검사입니다. 실제 DB/provider/OpenAI는 호출하지 않습니다."""

import os
import runpy
import unittest
from contextlib import contextmanager, redirect_stdout
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

import main
from database import get_db
from security_config import CORS_HEADERS, CORS_METHODS, api_docs_options, cors_allowed_origins


@contextmanager
def configured_app(origins=None, docs=None):
    """새 main namespace에서 startup 정책을 검사하고 다른 검사의 app은 변경하지 않습니다."""
    with patch.dict(os.environ, {"NOIE_AUTH_ENABLED": "true", "NOIE_BG_PROBE_ENDPOINT_ENABLED": "false"}):
        for key, value in (("NOIE_CORS_ALLOWED_ORIGINS", origins), ("NOIE_API_DOCS_ENABLED", docs)):
            os.environ.pop(key, None)
            if value is not None:
                os.environ[key] = value
        namespace = runpy.run_path(main.__file__)
        app = namespace["app"]
        db = Mock()

        def db_override():
            yield db

        app.dependency_overrides[get_db] = db_override
        with TestClient(app) as client:
            yield client, app, db, namespace


class SecurityAPISurfaceTests(unittest.TestCase):
    """CORS 승인은 인증이 아니며 허용되지 않은 HTTP도 여전히 인증으로 차단해야 합니다."""

    def preflight(self, client, origin, method="POST", headers="Authorization, Content-Type"):
        return client.options("/chat", headers={"Origin": origin, "Access-Control-Request-Method": method,
                                                "Access-Control-Request-Headers": headers})

    def test_missing_or_empty_cors_is_deny_by_default(self):
        for value in (None, "", " , , "):
            with self.subTest(value=value), configured_app(value) as (client, _, _, _):
                response = self.preflight(client, "https://app.example.com")
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("access-control-allow-origin", response.headers)
                self.assertNotIn("access-control-allow-origin", client.get("/", headers={"Origin": "https://app.example.com"}).headers)

    def test_explicit_origin_and_required_preflight(self):
        with configured_app(" https://app.example.com, ,https://app.example.com ") as (client, _, _, _):
            response = self.preflight(client, "https://app.example.com")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["access-control-allow-origin"], "https://app.example.com")
            self.assertEqual(response.headers["access-control-allow-methods"], "GET, POST")
            self.assertNotIn("access-control-allow-credentials", response.headers)
            self.assertIn("Origin", response.headers["vary"])
            self.assertEqual(client.get("/", headers={"Origin": "https://app.example.com"}).headers["access-control-allow-origin"], "https://app.example.com")
            self.assertEqual(cors_allowed_origins(), ["https://app.example.com"])

    def test_attack_cors_001_unknown_origin_still_requires_auth(self):
        with configured_app("https://app.example.com") as (client, _, db, _):
            response = self.preflight(client, "https://evil.example")
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("access-control-allow-origin", response.headers)
            # 요청 자체는 서버에 도달합니다. JWT 없는 호출을 막는 것은 인증입니다.
            response = client.post("/chat", json={"text": "fixture"}, headers={"Origin": "https://evil.example"})
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("access-control-allow-origin", response.headers)
            db.execute.assert_not_called()

    def test_allowed_origin_does_not_authorize_user(self):
        with configured_app("https://app.example.com") as (client, _, db, _):
            response = client.post("/chat", json={"text": "fixture"}, headers={"Origin": "https://app.example.com"})
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers["access-control-allow-origin"], "https://app.example.com")
            self.assertEqual(client.post("/auth/bootstrap").status_code, 401)
            db.execute.assert_not_called()

    def test_attack_cors_002_wildcard_disables_entire_list(self):
        for value in ("*", "https://app.example.com,*", "https://*.example.com"):
            with self.subTest(value=value), configured_app(value) as (client, _, _, _):
                self.assertEqual(cors_allowed_origins(), [])
                response = self.preflight(client, "https://app.example.com")
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("access-control-allow-origin", response.headers)

    def test_invalid_origins_never_enable_cors_or_leak_config(self):
        invalid = ("example.com", "ftp://app.example.com", "https://app.example.com/", "https://app.example.com/path",
                   "https://app.example.com?", "https://app.example.com?q=1", "https://app.example.com#", "https://user:PRIVATE@host",
                   "https://", "null", "https://bad host", "https://bad\\host", "https://bad_host", "https://host:",
                   "https://host:0", "https://host:65536", "https://host:abc", "https://[::1]garbage", "https://[::1",
                   "http://[fe80::1%25eth0]", "https://host\n.evil", "https://host\t.evil", "https://-bad.example", "https://127.999.0.1")
        for value in invalid:
            with self.subTest(value=value), patch.dict(os.environ, {"NOIE_CORS_ALLOWED_ORIGINS": f"https://app.example.com,{value}"}):
                with redirect_stdout(StringIO()) as logs:
                    self.assertEqual(cors_allowed_origins(), [])
                self.assertEqual(logs.getvalue(), "")

    def test_localhost_is_only_allowed_when_explicit(self):
        with configured_app("http://localhost:19006") as (client, _, _, _):
            self.assertEqual(self.preflight(client, "http://localhost:19006").status_code, 200)
            self.assertNotIn("access-control-allow-origin", self.preflight(client, "http://localhost:19001").headers)
            self.assertNotIn("access-control-allow-origin", self.preflight(client, "http://127.0.0.1:19006").headers)

    def test_canonical_origin_and_ipv6(self):
        with patch.dict(os.environ, {"NOIE_CORS_ALLOWED_ORIGINS": "HTTPS://APP.EXAMPLE.COM:443,http://[::1]:19006"}):
            self.assertEqual(cors_allowed_origins(), ["https://app.example.com", "http://[::1]:19006"])

    def test_unsupported_header_and_method_are_rejected(self):
        with configured_app("https://app.example.com") as (client, _, _, _):
            response = self.preflight(client, "https://app.example.com", headers="Authorization, X-Admin")
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("X-Admin", response.headers["access-control-allow-headers"])
            self.assertEqual(self.preflight(client, "https://app.example.com", method="DELETE").status_code, 400)
            self.assertEqual(set(CORS_HEADERS), {"Authorization", "Content-Type"})

    def test_attack_surface_001_docs_default_and_invalid_are_404(self):
        for value in (None, "", "false", "fasle", "enabled", "true!"):
            with self.subTest(value=value), configured_app(docs=value) as (client, _, _, _):
                for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
                    self.assertEqual(client.get(path).status_code, 404)
                self.assertEqual(api_docs_options(), {"docs_url": None, "redoc_url": None, "openapi_url": None})

    def test_explicit_docs_on_and_probe_schema_hidden(self):
        for value in ("1", "true", "yes", "on", " TRUE ", " YeS "):
            with self.subTest(value=value), configured_app(docs=value) as (client, _, _, _):
                self.assertEqual(client.get("/docs").status_code, 200)
                self.assertEqual(client.get("/redoc").status_code, 200)
                schema = client.get("/openapi.json")
                self.assertEqual(schema.status_code, 200)
                self.assertNotIn("/internal/background-probe", schema.json()["paths"])

    def test_attack_surface_002_probe_disabled_is_404(self):
        with configured_app(docs="true") as (client, _, db, _):
            response = client.post("/internal/background-probe", params={"request_id": str(uuid4())})
            self.assertEqual(response.status_code, 404)
            db.execute.assert_not_called()

    def test_enabled_probe_requires_mapped_principal(self):
        with configured_app() as (client, _, db, _), patch.dict(os.environ, {"NOIE_BG_PROBE_ENDPOINT_ENABLED": "true"}):
            self.assertEqual(client.post("/internal/background-probe", params={"request_id": str(uuid4())}).status_code, 401)
            db.execute.assert_not_called()

    def test_public_health_contract_and_safe_failure(self):
        with configured_app() as (client, _, db, _):
            self.assertEqual(client.get("/").json(), {"status": "ok", "service": "noie"})
            self.assertEqual(client.get("/db-health").json(), {"status": "ok", "database": "postgresql"})
            self.assertEqual(str(db.execute.call_args.args[0]), "SELECT 1")
            db.execute.side_effect = SQLAlchemyError("PRIVATE_DB_URL_HOST_SECRET_SQL")
            with redirect_stdout(StringIO()) as logs:
                response = client.get("/db-health")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {"detail": "Database connection failed."})
            self.assertNotIn("PRIVATE", response.text + logs.getvalue())

    def test_route_methods_are_covered_and_no_new_business_route(self):
        with configured_app() as (_, app, _, _):
            routes = [route for route in app.routes if isinstance(route, APIRoute)]
            self.assertEqual({method for route in routes for method in route.methods}, set(CORS_METHODS))
            self.assertEqual({(route.path, tuple(sorted(route.methods))) for route in routes},
                             {(route.path, tuple(sorted(route.methods))) for route in main.app.routes if isinstance(route, APIRoute)})


if __name__ == "__main__":
    unittest.main()
