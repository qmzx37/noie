"""합성 데이터 공격 검사입니다. 방어 기대값을 취약한 동작에 맞춰 바꾸지 않습니다."""

import contextlib
import io
import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

# pytest/unittest를 직접 실행해 운영 .env가 import되는 실수를 방지합니다.
if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Run the isolated security adversarial verifier first")

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

import main
import chat_persistence_service as chat
import account_lifecycle_service as lifecycle
import security_rate_limit as rate
from auth_context import AuthPrincipal
from models.memory import Memory, MemoryEvidence
from models.message import Message
from models.user import User
from evals import run_security_account_deletion_tests as fixture


class OwnershipAttackTests(unittest.TestCase):
    """DB와 검증된 principal 전달만 대체합니다. 실제 ownership/서비스/라우터를 실행합니다."""

    setUp = fixture.AccountDeletionTests.setUp
    tearDown = fixture.AccountDeletionTests.tearDown
    count = fixture.AccountDeletionTests.count

    def test_memory_b_positive_a_denied_no_mutation(self):
        """존재하는 B 기억은 B에게 반환되고 A에게는 내용과 근거 모두 숨겨져야 합니다."""
        memory = Memory(user_id=self.bid, content="SYNTHETIC_B_PRIVATE", kind="goal")
        self.db.add(memory); self.db.flush()
        self.db.add(MemoryEvidence(memory_id=memory.id, message_id=self.mb.id)); self.db.commit()
        before = self.count("memories"), self.count("memory_evidence"), self.count("messages")
        self.principal = AuthPrincipal(self.bid)
        self.assertEqual(self.client.get(f"/memories/{memory.id}").status_code, 200)
        self.principal = AuthPrincipal(self.aid)
        response = self.client.get(f"/memories/{memory.id}")
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(memory.content, response.text)
        self.assertNotIn(self.mb.content, response.text)
        self.assertEqual(before, (self.count("memories"), self.count("memory_evidence"), self.count("messages")))
        self.background_mock.assert_not_called()

    def test_late_chat_finalize_after_deactivation_must_not_write(self):
        """Phase A가 끝난 후 늦게 반환된 AI 응답은 비활성 계정에 새 메시지를 쓰면 안 됩니다."""
        factory = sessionmaker(self.engine, expire_on_commit=False)
        with patch.object(chat, "SessionLocal", factory):
            start = chat.begin_chat_request("SYNTHETIC_LATE_USER", uuid4(), authenticated_user_id=self.aid)
            lifecycle.deactivate_account(self.db, AuthPrincipal(self.aid))
            before = self.count("messages")
            saved = chat.complete_chat_request(start.context, "SYNTHETIC_LATE_REPLY", "fallback", {"reply": "SYNTHETIC_LATE_REPLY"})
            self.assertFalse(saved, "Inactive account accepted late finalize")
            self.assertEqual(self.count("messages"), before)

    def test_invalid_role_does_not_reflect_synthetic_secret(self):
        """입력 검증 오류도 원문 비밀 값을 클라이언트에 복제하지 않아야 합니다."""
        secret = "SYNTHETIC_SECRET_NEVER_REAL_119"
        response = self.client.post(f"/conversations/{self.ca.id}/messages", json={"role": secret, "content": "fixture"})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text, "Validation response reflected synthetic secret")

    def test_deactivated_account_cannot_read_after_positive_control(self):
        """삭제 전 성공을 확인한 뒤 삭제 대기 상태의 동일 사용자를 거부해야 합니다."""
        self.assertEqual(self.client.get("/account").status_code, 200)
        lifecycle.deactivate_account(self.db, self.principal)
        self.assertNotEqual(self.client.get("/account").status_code, 200)

    def test_late_reinforce_after_deactivation_must_not_add_evidence(self):
        """이미 진행 중이던 REINFORCE도 비활성 사용자에 근거를 새로 연결하면 안 됩니다."""
        import memory_extraction_service as extraction
        import memory_reconciliation_service as reconciliation
        from memory_schemas import MemoryExtractionDecision, MemoryReconciliationDecision
        message = Message(conversation_id=self.ca.id, user_id=self.aid, role="user", content="나는 AI 개발 목표가 있다")
        self.db.add(message); self.db.commit()
        factory = sessionmaker(self.engine, expire_on_commit=False)
        with patch.object(extraction, "SessionLocal", factory), patch.object(reconciliation, "SessionLocal", factory):
            lease, acquired, _, _ = extraction._acquire_processing_lease(message.id, self.aid)
            self.assertTrue(acquired)
            lifecycle.deactivate_account(self.db, self.principal)
            before = self.count("memory_evidence")
            try:
                reconciliation.apply_reconciliation(lease.id, self.aid, message.id,
                    MemoryExtractionDecision(should_remember=True, reason="synthetic", content="나는 AI 개발 목표가 있다", kind="goal", importance=70, confidence=.9),
                    MemoryReconciliationDecision(action="reinforce", matched_memory_id=self.memory.id, reason="synthetic", confidence=.9),
                    [{"id": str(self.memory.id)}], lease.attempt_count)
            except reconciliation.MemoryReconciliationValidationError:
                pass
            self.assertEqual(self.count("memory_evidence"), before, "Inactive account accepted late evidence")

    def test_late_chat_after_purge_does_not_resurrect_account(self):
        """purge 후에는 기존 FK 부모가 없으므로 새 계정/메시지를 자동 재생성하면 안 됩니다."""
        factory = sessionmaker(self.engine, expire_on_commit=False)
        with patch.object(chat, "SessionLocal", factory):
            start = chat.begin_chat_request("synthetic", uuid4(), authenticated_user_id=self.aid)
            lifecycle.deactivate_account(self.db, self.principal)
            lifecycle.purge_deleted_account(self.db, self.aid)
            before = self.count("messages"), self.count("users")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(chat.complete_chat_request(start.context, "synthetic", "fallback", {"reply": "synthetic"}))
            self.assertEqual(before, (self.count("messages"), self.count("users")))

    def test_late_agent_finalize_after_deactivation_must_not_complete(self):
        """lease의 attempt 일치만으로 비활성 계정에 결과를 확정하면 안 됩니다."""
        from models.agent_action import AgentAction
        from agent import executor_service
        from agent.executor_registry import ExecutorResult
        row = AgentAction(user_id=self.aid, conversation_id=self.ca.id, message_id=self.ma.id,
            action_id=uuid4(), tool_name="synthetic119", action_type="record_daily_trace", intent="record",
            mode="record", status="ready", confidence=.9, requires_confirmation=False,
            execution_order=1, idempotency_key=uuid4().hex, confirmation_status="not_required")
        self.db.add(row); self.db.commit()
        with patch.object(executor_service, "SessionLocal", sessionmaker(self.engine, expire_on_commit=False)):
            _, lease = executor_service._acquire_lease(row.action_id, self.aid)
            lifecycle.deactivate_account(self.db, self.principal)
            result, _ = executor_service._finish_success(lease, ExecutorResult(outcome="synthetic"))
            self.assertNotEqual(result.status, "completed", "Inactive account accepted late Agent result")

    def test_project_service_exception_must_not_reflect_secret_to_log(self):
        """외부 서비스 예외만 합성으로 대체하며 실제 project fallback의 logging을 검사합니다."""
        from fastapi import BackgroundTasks
        secret = "SYNTHETIC_EXCEPTION_SECRET_119"
        analysis = main.build_response("synthetic", {
            "primary_axis": {"like": .1, "dislike": .1},
            "emotion_axis": {axis: .1 for axis in "FADJCGTR"}, "state_summary": "synthetic"}, "rule_based")
        with contextlib.ExitStack() as stack, contextlib.redirect_stdout(io.StringIO()) as logs:
            stack.enter_context(patch.object(main, "begin_chat_request", return_value=chat.ChatPersistenceStart(None)))
            stack.enter_context(patch.object(main, "analyze_text", return_value=(analysis, "rule_based")))
            stack.enter_context(patch.object(main, "generate_project_chat_reply_with_checkpoint_openai", side_effect=RuntimeError(secret)))
            stack.enter_context(patch.object(main, "generate_chat_reply_with_openai", return_value="synthetic reply"))
            stack.enter_context(patch.object(main, "prepare_chat_recommendation", return_value=(None, None)))
            stack.enter_context(patch.object(main, "complete_chat_request", return_value=False))
            result = main.chat(main.ChatRequest(text="synthetic", is_project=True), BackgroundTasks(), self.principal)
        self.assertEqual(result["reply"], "synthetic reply")
        self.assertNotIn(secret, logs.getvalue(), "Project fallback logged raw exception")


class PrivacyAttackTests(unittest.TestCase):
    """기본 양성/차단 대조군과 휴리스틱 우회 예를 분리합니다."""

    def test_standard_positive_secret_and_third_party_controls(self):
        from memory_privacy import automatic_memory_allowed
        self.assertTrue(automatic_memory_allowed("나는 AI 프로젝트를 만들고 싶다"))
        self.assertTrue(automatic_memory_allowed("친구랑 운동한다"))
        self.assertFalse(automatic_memory_allowed("내 비밀번호는 SYNTHETIC_ONLY_119"))
        self.assertFalse(automatic_memory_allowed("친구가 암 진단받았어"))

    def test_spaced_password_assignment_must_not_be_automatic_memory(self):
        """한 글자씩 띄운 credential label도 자동 Memory/RAG 승격 대상이 아니어야 합니다."""
        from memory_privacy import automatic_memory_allowed
        self.assertFalse(automatic_memory_allowed("내 비 밀 번 호 는 SYNTHETIC_ONLY_119"))


class BudgetAttackTests(unittest.TestCase):
    """통제된 시간과 최대 8개 thread로 limiter의 실제 원자적 처리만 검사합니다."""

    def test_concurrency_never_exceeds_budget(self):
        limiter = rate.InMemoryRateLimiter(clock=lambda: 0.0)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: limiter.consume("EXPENSIVE_AI", "synthetic", 3), range(24), timeout=5))
        self.assertEqual(sum(result is None for result in results), 3)

    def test_full_bucket_does_not_evict_active_budget(self):
        limiter = rate.InMemoryRateLimiter(clock=lambda: 0.0, max_buckets=1)
        self.assertIsNone(limiter.consume("EXPENSIVE_AI", "A", 1))
        self.assertIsNotNone(limiter.consume("EXPENSIVE_AI", "B", 1))
        self.assertIsNotNone(limiter.consume("EXPENSIVE_AI", "A", 1))

    def test_expensive_paths_share_group_and_header_spoof_cannot_change_peer(self):
        """비용 API 교차 호출과 위조 forwarded header는 같은 실제 identity 한도를 유지합니다."""
        from fastapi import Request
        for path in ("/chat", "/orchestrate", "/generate-title", "/messages/x/extract-memory", "/agent/actions/x/execute"):
            self.assertEqual(rate.request_group(path), "EXPENSIVE_AI")
        scope = {"type": "http", "method": "POST", "path": "/chat", "client": ("192.0.2.1", 123), "headers": []}
        first = rate._peer_identity(scope)
        scope["headers"] = [(b"x-forwarded-for", b"203.0.113.1"), (b"x-user-id", str(uuid4()).encode())]
        self.assertEqual(first, rate._peer_identity(scope))


class RouteCoverageAttackTests(unittest.TestCase):
    """유효한 route UUID로 전체 보호 경로의 미인증 차단을 확인합니다. DB 접근은 금지합니다."""

    def test_every_protected_route_blocks_missing_token_before_business(self):
        import re
        from fastapi.routing import APIRoute
        from fastapi.testclient import TestClient
        from database import get_db
        previous = dict(main.app.dependency_overrides)
        main.app.dependency_overrides.clear()
        db_calls = []

        def forbidden_db():
            db_calls.append(True)
            raise AssertionError("UNAUTHORIZED_DB_CALL")

        main.app.dependency_overrides[get_db] = forbidden_db
        try:
            with patch.dict(os.environ, {"NOIE_AUTH_ENABLED": "true", "NOIE_RATE_LIMIT_ENABLED": "false", "NOIE_BG_PROBE_ENDPOINT_ENABLED": "false"}), TestClient(main.app) as client:
                for route in main.app.routes:
                    if not isinstance(route, APIRoute) or route.path in {"/", "/db-health", "/internal/background-probe"}:
                        continue
                    path = re.sub(r"\{[^}]+\}", str(uuid4()), route.path)
                    for method in route.methods:
                        with self.subTest(route=route.path, method=method):
                            response = client.request(method, path, json={}, params={"user_id": str(uuid4())}, headers={"X-Admin": "true", "X-Role": "owner"})
                            self.assertEqual(response.status_code, 401)
                self.assertEqual(db_calls, [])
                self.assertEqual(client.get("/docs").status_code, 404)
                self.assertEqual(client.post("/internal/background-probe", params={"request_id": str(uuid4())}).status_code, 404)
        finally:
            main.app.dependency_overrides.clear()
            main.app.dependency_overrides.update(previous)


class SignedTokenAttackTests(unittest.TestCase):
    """SDK의 진짜 서명 검증을 유지하고 JWKS 조회만 합성 키로 대체합니다."""

    def test_real_sdk_valid_control_and_bad_signature_expiry_issuer_audience(self):
        import jwt
        import httpx
        from cryptography.hazmat.primitives.asymmetric import rsa
        from supabase import create_client, ClientOptions
        from supabase_auth_verifier import verify_supabase_token, TokenVerificationError
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
        jwk.update(kid="synthetic119", alg="RS256", use="sig")
        config = {"SUPABASE_URL": "https://synthetic119.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_synthetic119"}
        claims = dict(sub=str(uuid4()), exp=int(datetime.now(timezone.utc).timestamp()) + 3600,
                      aud="authenticated", iss=config["SUPABASE_URL"] + "/auth/v1", role="authenticated", is_anonymous=False)
        with httpx.Client() as transport:
            client = create_client(config["SUPABASE_URL"], config["SUPABASE_PUBLISHABLE_KEY"], options=ClientOptions(httpx_client=transport, persist_session=False, auto_refresh_token=False))
            actual = client.auth.get_claims
            with patch.dict(os.environ, config), patch("supabase.create_client", return_value=client), \
                    patch.object(client.auth, "get_claims", side_effect=lambda token: actual(token, jwks={"keys": [jwk]})), \
                    patch.object(httpx.Client, "send", side_effect=AssertionError("NO_EXTERNAL_HTTP")):
                token = lambda data, signing=key: jwt.encode(data, signing, algorithm="RS256", headers={"kid": "synthetic119"})
                self.assertEqual(verify_supabase_token(token(claims)).subject, claims["sub"])
                for bad in (token(claims, other_key), token({**claims, "exp": 1}), token({**claims, "iss": "https://wrong.invalid"}), token({**claims, "aud": "service_role"}), "not-a-jwt"):
                    with self.assertRaises(TokenVerificationError):
                        verify_supabase_token(bad)


if __name__ == "__main__":
    # 환경 차단은 별도 실행기를 먼저 거치도록 직접 실행을 허용하지 않습니다.
    raise SystemExit("Use run_security_adversarial_verification.py --backend-root ...")
