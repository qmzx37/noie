"""Behavior API의 account isolation과 read-only 계약을 합성 SQLite에서 검증합니다."""

from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timezone
from io import StringIO
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

import main
from auth_context import AuthPrincipal
from database import Base
from models.message import Message
from agent.behavior_service import analyze_owned_behavior
from evals import run_security_account_deletion_tests as fixtures


class BehaviorOwnershipTests(unittest.TestCase):
    """기존 테스트 fixture만 재사용하며 실제 PostgreSQL에는 접근하지 않습니다."""

    def setUp(self):
        """서로 다른 계정 두 개를 격리된 메모리 DB에 준비합니다."""
        fixtures.AccountDeletionTests.setUp(self)
        self.ma.content = "오늘 운동했어"
        self.mb.content = "지금 개발하고 있어"
        self.db.commit()

    def tearDown(self):
        """테스트 DB와 dependency override만 정리합니다."""
        fixtures.AccountDeletionTests.tearDown(self)

    def get(self, message_id=None, **kwargs):
        """기본 요청은 계정 A의 명시적 원문을 해석합니다."""
        return self.client.get(f"/messages/{message_id or self.ma.id}/behavior", **kwargs)

    def fingerprint(self):
        """행 수뿐 아니라 모든 테이블의 모든 컬럼 값을 비교합니다."""
        return {table.name: sorted(repr(tuple(row)) for row in self.db.execute(select(table)))
                for table in Base.metadata.sorted_tables}

    def test_owned_message_and_evidence(self):
        result = self.get()
        self.assertEqual(result.status_code, 200)
        payload = result.json()
        self.assertEqual(payload["source_message_id"], str(self.ma.id))
        self.assertEqual(payload["behaviors"][0]["status"], "performed")
        self.assertEqual(payload["behaviors"][0]["evidence"]["summary"], self.ma.content)

    def test_cross_user_and_nonexistent_same_404(self):
        self.assertEqual(self.get(self.mb.id).status_code, 404)
        self.assertEqual(self.get(uuid4()).status_code, 404)

    def test_principal_switch_reads_only_own_message(self):
        self.principal = AuthPrincipal(self.bid)
        self.assertEqual(self.get().status_code, 404)
        self.assertEqual(self.get(self.mb.id).status_code, 200)

    def test_headers_cannot_change_owner(self):
        self.assertEqual(self.get(self.mb.id, headers={"X-User-ID": str(self.bid)}).status_code, 404)

    def test_auth_on_anonymous_rejected(self):
        self.principal = None
        self.assertEqual(self.get().status_code, 401)

    def test_auth_off_no_dev_fallback_or_db_lookup(self):
        self.principal = None
        with patch.dict(os.environ, {"NOIE_AUTH_ENABLED": "false"}), patch("agent.behavior_router.analyze_owned_behavior") as analyze:
            self.assertEqual(self.get().status_code, 401)
            analyze.assert_not_called()

    def test_deleted_user_blocked(self):
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.get().status_code, 404)

    def test_deleted_conversation_blocked(self):
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.get().status_code, 404)

    def test_inconsistent_message_author_blocked(self):
        self.ma.user_id = self.bid
        self.db.commit()
        self.assertEqual(self.get().status_code, 404)

    def test_assistant_and_system_never_user_evidence(self):
        for role in ("assistant", "system"):
            message = Message(conversation_id=self.ca.id, role=role, user_id=None, content="운동했어")
            self.db.add(message)
            self.db.commit()
            with self.subTest(role=role):
                self.assertEqual(self.get(message.id).status_code, 404)

    def test_invalid_uuid(self):
        self.assertEqual(self.client.get("/messages/not-a-uuid/behavior").status_code, 422)

    def test_success_repeat_and_rejection_do_not_write(self):
        before = self.fingerprint()
        with patch.object(self.db, "commit", side_effect=AssertionError("UNEXPECTED_WRITE")), patch.object(self.db, "flush", side_effect=AssertionError("UNEXPECTED_WRITE")):
            self.assertEqual(self.get().status_code, 200)
            self.assertEqual(self.get().status_code, 200)
            self.assertEqual(self.get(self.mb.id).status_code, 404)
        self.assertEqual(self.fingerprint(), before)
        self.assertEqual(self.db.get(Message, self.ma.id).content, "오늘 운동했어")

    def test_privacy_blocks_output_without_changing_message(self):
        self.ma.content = "운동했어. password=SuperSecret987"
        self.db.commit()
        before = self.fingerprint()
        result = self.get()
        self.assertEqual(result.json()["reason"], "privacy_restricted")
        self.assertNotIn("SuperSecret987", result.text)
        self.assertEqual(self.fingerprint(), before)

    def test_oversized_source_safe_error_without_source_echo(self):
        self.ma.content = "PRIVATE_SENTINEL" * 700
        self.db.commit()
        response = self.get()
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("PRIVATE_SENTINEL", response.text)

    def test_db_error_rollback_no_exception_leak(self):
        logs = StringIO()
        with patch.object(self.db, "scalar", side_effect=SQLAlchemyError("PRIVATE_DATABASE_SECRET")), patch.object(self.db, "rollback", wraps=self.db.rollback) as rollback, redirect_stdout(logs), redirect_stderr(logs):
            response = self.get()
        self.assertEqual(response.status_code, 503)
        rollback.assert_called_once()
        self.assertNotIn("PRIVATE_DATABASE_SECRET", response.text + logs.getvalue())

    def test_service_rejects_missing_principal(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as caught:
            analyze_owned_behavior(self.db, self.ma.id, None)
        self.assertEqual(caught.exception.status_code, 401)

    def test_read_api_standard_budget_and_no_body_user_id(self):
        from security_rate_limit import request_group
        self.assertEqual(request_group("/messages/uuid/behavior"), "PROTECTED_STANDARD")
        route = next(route for route in main.app.routes if getattr(route, "path", "") == "/messages/{message_id}/behavior")
        self.assertEqual(route.methods, {"GET"})
        self.assertEqual(route.dependant.body_params, [])


if __name__ == "__main__":
    unittest.main()
