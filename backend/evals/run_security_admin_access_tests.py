"""관리자 경계는 격리 SQLite/합성 계정/mock으로 검증합니다. 운영 DB/AI는 호출하지 않습니다."""

import importlib
import json
import os
import unittest
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timedelta, timezone
from io import StringIO
from unittest.mock import patch
from uuid import UUID, uuid4

from sqlalchemy import JSON, DefaultClause, MetaData, func, select, text, CheckConstraint, ForeignKeyConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import SQLAlchemyError

import admin_access_service as service
import auth_context as auth
import main
from evals import run_auth_surface_tests as ownership
from models.admin_grant import AdminGrant
from models.admin_break_glass_session import AdminBreakGlassSession
from models.admin_audit_log import AdminAuditLog
from models.memory import Memory, MemoryEvidence
from models.user import User
from models.conversation import Conversation
from models.message import Message
from models.agent_action import AgentAction


class AdminAccessTests(unittest.TestCase):
    """기존 ownership fixture를 조합하고 테스트용 복사 스키마에 새 테이블만 추가합니다."""

    def setUp(self):
        ownership.AuthSurfaceTests.setUp(self)
        self.limits = patch.dict(os.environ, {"NOIE_RATE_LIMIT_ENABLED": "false"})
        self.limits.start()
        schema = MetaData()
        User.__table__.to_metadata(schema)
        for model in (AdminGrant, AdminBreakGlassSession, AdminAuditLog):
            table = model.__table__.to_metadata(schema)
            for column in table.columns:
                if column.server_default is not None:
                    value = str(column.server_default.arg)
                    if "gen_random_uuid" in value:
                        column.server_default = None
                    elif value == "now()":
                        column.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
        schema.create_all(self.engine, tables=[schema.tables[m.__tablename__] for m in (AdminGrant, AdminBreakGlassSession, AdminAuditLog)])

    def tearDown(self):
        self.limits.stop()
        ownership.AuthSurfaceTests.tearDown(self)

    def grant(self, role="security_admin", user=None):
        """실제 operator service로 합성 계정 grant와 audit를 같이 commit합니다."""
        return service.provision_admin_grant(self.db, user_id=user or self.a.id, role=role, reason_code="security_incident")

    def session(self, scope="memory_read", **extra):
        return self.client.post("/admin/break-glass", json={"target_user_id": str(self.a.id),
            "scope": scope, "reason_code": "security_incident", **extra})

    def memory_path(self, sid, user=None, memory=None):
        return f"/admin/break-glass/{sid}/users/{user or self.a.id}/memories/{memory or self.memory.id}"

    def messages_path(self, sid, user=None, conversation=None):
        return f"/admin/break-glass/{sid}/users/{user or self.a.id}/conversations/{conversation or self.ca.id}/messages"

    def logs(self):
        return self.db.scalars(select(AdminAuditLog).order_by(AdminAuditLog.created_at, AdminAuditLog.id)).all()

    def test_normal_user_spoofed_headers_query_body_no_promotion(self):
        response = self.client.get(f"/admin/users/{self.a.id}/summary?role=owner", headers={"X-Admin": "true", "X-Role": "owner"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.logs()[-1].outcome, "denied")
        response = self.session(role="owner")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(AdminGrant)), 0)

    def test_support_summary_has_only_minimal_state_and_counts(self):
        self.grant("support_admin")
        response = self.client.get(f"/admin/users/{self.a.id}/summary")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"user_id", "status", "created_at", "conversation_count", "memory_count"})
        self.assertEqual(response.json()["conversation_count"], 1)
        self.assertNotIn(self.memory.content, response.text)
        self.assertNotIn(self.ma.content, response.text)

    def test_support_cannot_create_or_read_private_or_audits(self):
        self.grant("support_admin")
        self.assertEqual(self.session().status_code, 403)
        self.assertEqual(self.client.get(self.memory_path(uuid4())).status_code, 403)
        self.assertEqual(self.client.get("/admin/audit-logs").status_code, 403)

    def test_security_and_owner_create_session(self):
        for role in ("security_admin", "owner"):
            self.grant(role)
            response = self.session()
            self.assertEqual(response.status_code, 201)
            row = self.db.get(AdminBreakGlassSession, UUID(response.json()["id"]))
            self.assertEqual(row.admin_user_id, self.a.id)
            self.assertEqual((row.expires_at - row.created_at).total_seconds(), 600)

    def test_missing_reason_invalid_scope_ttl_and_private_case_rejected(self):
        self.grant()
        for updates in ({"reason_code": None}, {"scope": "all_private_data"}, {"ttl_seconds": 901},
                        {"ttl_seconds": 0}, {"ttl_seconds": True}, {"case_reference": "PRIVATE TOKEN EMAIL"}):
            response = self.session(**updates)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("PRIVATE TOKEN EMAIL", response.text)
        response = self.client.post("/admin/break-glass", json={"target_user_id": str(self.a.id), "scope": "memory_read"})
        self.assertEqual(response.status_code, 422)

    def test_expired_and_revoked_sessions_denied_and_audited(self):
        self.grant()
        for expired in (True, False):
            sid = self.session().json()["id"]
            row = self.db.get(AdminBreakGlassSession, UUID(sid))
            if expired:
                row.created_at = datetime.now(timezone.utc) - timedelta(hours=1)
                row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            else:
                row.revoked_at = datetime.now(timezone.utc)
            self.db.commit()
            self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 403)
            self.assertEqual(self.logs()[-1].outcome, "denied")

    def test_scope_and_target_and_foreign_resource_isolation(self):
        self.grant()
        sid = self.session().json()["id"]
        self.assertEqual(self.client.get(self.messages_path(sid)).status_code, 403)
        for mid in (uuid4(),):
            self.assertEqual(self.client.get(self.memory_path(sid, memory=mid)).status_code, 404)
        self.assertEqual(self.client.get(self.memory_path(sid, user=self.b.id)).status_code, 404)
        foreign = Memory(user_id=self.b.id, content="B synthetic private memory", kind="goal")
        self.db.add(foreign)
        self.db.commit()
        self.assertEqual(self.client.get(self.memory_path(sid, memory=foreign.id)).status_code, 404)
        self.assertEqual(self.client.get(self.memory_path(sid, user=self.b.id, memory=foreign.id)).status_code, 404)

    def test_successful_memory_read_requires_audit_without_content(self):
        self.grant()
        sid = self.session(case_reference="CASE-123").json()["id"]
        response = self.client.get(self.memory_path(sid))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], self.memory.content)
        self.assertEqual(response.json()["evidence"][0]["message"]["content"], self.ma.content)
        rows = self.logs()
        self.assertTrue(any(row.action == "memory.break_glass_read" and row.outcome == "success" for row in rows))
        encoded = json.dumps([{column.name: str(getattr(row, column.name)) for column in AdminAuditLog.__table__.columns} for row in rows])
        for secret in (self.memory.content, self.ma.content, self.a.name):
            self.assertNotIn(secret, encoded)
        before = len(self.logs())
        # HTTP schema를 우회한 내부 caller도 감사 필드에 임의 원문을 넣을 수 없습니다.
        for extra in ({"case_reference": "SYNTHETIC_SECRET"}, {"reason_code": "SYNTHETIC_SECRET"},
                      {"resource_type": "SYNTHETIC_SECRET"}):
            with self.assertRaises(service.AdminAccessError):
                service._append_audit(self.db, actor_user_id=self.a.id, actor_kind="user",
                    target_user_id=self.a.id, action="memory.break_glass_read", outcome="success", **extra)
        self.assertEqual(len(self.logs()), before)

    def test_successful_conversation_read_audited_and_wrong_owner_hidden(self):
        self.grant()
        sid = self.session(scope="conversation_read").json()["id"]
        response = self.client.get(self.messages_path(sid))
        self.assertEqual(response.status_code, 200)
        # 같은 created_at을 가진 fixture는 UUID 순서가 tie-breaker이며 role 순서를 가정하지 않습니다.
        self.assertEqual({item["content"] for item in response.json()}, {self.ma.content, self.assistant.content})
        self.assertEqual(response.json(), sorted(response.json(), key=lambda item: (item["created_at"], item["id"])))
        self.assertEqual(self.client.get(self.messages_path(sid, conversation=self.cb.id)).status_code, 404)
        self.assertTrue(any(row.action == "conversation.break_glass_read" and row.outcome == "success" for row in self.logs()))

    def test_audit_insert_failure_returns_no_sensitive_payload_and_rollback(self):
        self.grant()
        sid = self.session().json()["id"]
        with patch.object(service, "_append_audit", side_effect=SQLAlchemyError("SYNTHETIC SQL TOKEN SECRET")), \
                patch.object(self.db, "rollback", wraps=self.db.rollback) as rollback:
            response = self.client.get(self.memory_path(sid))
            self.assertEqual(response.status_code, 503)
            self.assertGreaterEqual(rollback.call_count, 1)
        for secret in (self.memory.content, self.ma.content, "SYNTHETIC SQL TOKEN SECRET"):
            self.assertNotIn(secret, response.text)

    def test_audit_commit_failure_returns_no_sensitive_payload(self):
        self.grant()
        sid = self.session().json()["id"]
        before = len(self.logs())
        with patch.object(self.db, "commit", side_effect=SQLAlchemyError("SYNTHETIC DB URL")):
            response = self.client.get(self.memory_path(sid))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(self.memory.content, response.text)
        self.assertEqual(len(self.logs()), before)

    def test_role_revoke_disables_existing_session_immediately(self):
        self.grant()
        sid = self.session().json()["id"]
        service.provision_admin_grant(self.db, user_id=self.a.id, role="security_admin", reason_code="security_incident", revoke=True)
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 403)

    def test_revocation_refreshes_even_a_reused_session_identity_map(self):
        """별도 DB writer의 철회를 ORM identity-map의 이전 값으로 우회하지 못합니다."""
        from sqlalchemy import update
        self.grant()
        sid = self.session().json()["id"]
        cached = self.db.get(AdminBreakGlassSession, UUID(sid))
        with self.engine.begin() as connection:
            connection.execute(update(AdminBreakGlassSession).where(AdminBreakGlassSession.id == UUID(sid))
                .values(revoked_at=datetime.now(timezone.utc)))
        self.assertIsNone(cached.revoked_at)
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 403)

    def test_admin_does_not_bypass_normal_memory_and_conversation_ownership(self):
        self.grant("owner", user=self.b.id)
        self.principal = auth.AuthPrincipal(self.b.id)
        self.assertEqual(self.client.get(f"/memories/{self.memory.id}").status_code, 404)
        self.assertEqual(self.client.get(f"/conversations/{self.ca.id}/messages").status_code, 404)

    def test_audit_pagination_and_read_event_and_maximum(self):
        self.grant()
        response = self.client.get("/admin/audit-logs?limit=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertTrue(any(row.action == "audit_log.read" for row in self.logs()))
        self.assertEqual(self.client.get("/admin/audit-logs?limit=101").status_code, 422)
        self.assertEqual(self.client.get("/admin/audit-logs?offset=-1").status_code, 422)

    def test_session_revoke_idempotent_and_bound_to_issuing_admin(self):
        self.grant()
        sid = self.session().json()["id"]
        self.grant(user=self.b.id)
        self.principal = auth.AuthPrincipal(self.b.id)
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 404)
        self.assertEqual(self.client.post(f"/admin/break-glass/{sid}/revoke").status_code, 404)
        self.principal = auth.AuthPrincipal(self.a.id)
        for _ in range(2):
            self.assertEqual(self.client.post(f"/admin/break-glass/{sid}/revoke").status_code, 200)
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 403)

    def test_deleted_target_and_resources_excluded(self):
        self.grant()
        sid = self.session().json()["id"]
        self.memory.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 404)
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 403)

    def test_active_admin_cannot_create_or_read_deleted_other_target(self):
        self.grant(user=self.b.id)
        self.principal = auth.AuthPrincipal(self.b.id)
        response = self.session()
        sid = response.json()["id"]
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.session().status_code, 404)
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 404)

    def test_bad_legacy_evidence_never_exposes_other_users_original(self):
        self.grant()
        sid = self.session().json()["id"]
        self.db.add(MemoryEvidence(memory_id=self.memory.id, message_id=self.mb.id))
        self.db.commit()
        response = self.client.get(self.memory_path(sid))
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(self.mb.content, response.text)

    def test_operator_provision_idempotent_and_no_auto_user_creation(self):
        for _ in range(2):
            self.grant("owner")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(AdminGrant)), 1)
        with self.assertRaises(service.AdminAccessError):
            self.grant(user=uuid4())
        for role in ("superuser", "OWNER", ""):
            with self.assertRaises(service.AdminAccessError):
                self.grant(role)
        self.assertTrue(all(row.actor_kind == "operator" for row in self.logs()))

    def test_provision_audit_failure_rolls_back_grant(self):
        with patch.object(service, "_append_audit", side_effect=SQLAlchemyError("synthetic")):
            with self.assertRaises(Exception):
                self.grant("owner")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(AdminGrant)), 0)

    def test_no_public_provisioning_or_audit_mutation_or_enumeration(self):
        for path in ("/admin/grants", "/admin/users", "/admin/audit-logs", "/admin/promote"):
            self.assertIn(self.client.post(path, json={"role": "owner"}).status_code, (404, 405))
        self.assertEqual(self.client.delete("/admin/audit-logs").status_code, 405)
        self.assertEqual(self.client.patch("/admin/audit-logs", json={}).status_code, 405)

    def test_no_principal_is_401_even_development_auth_off(self):
        self.principal = None
        with patch.dict(os.environ, {"NOIE_AUTH_ENABLED": "false"}):
            self.assertEqual(self.client.get(f"/admin/users/{self.a.id}/summary").status_code, 401)
        self.assertEqual(len(self.logs()), 0)

    def test_db_errors_are_fixed_response_and_failed_audit(self):
        self.grant()
        with patch.object(service, "user_summary", side_effect=SQLAlchemyError("SYNTHETIC SQL URL TOKEN")):
            response = self.client.get(f"/admin/users/{self.a.id}/summary")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("SYNTHETIC", response.text)
        events = [row for row in self.logs() if row.action == "admin_summary.read"]
        self.assertEqual(events[-1].outcome, "failed")

    def test_rate_limit_infrastructure_covers_admin(self):
        from security_rate_limit import request_group
        for path in ("/admin/break-glass", "/admin/audit-logs", self.memory_path(uuid4())):
            self.assertEqual(request_group(path), "PROTECTED_STANDARD")

    def test_client_metadata_is_not_admin_authority(self):
        self.a.metadata_ = {"role": "owner", "is_admin": True, "email": "synthetic@example.invalid"}
        self.db.commit()
        self.assertEqual(self.client.get(f"/admin/users/{self.a.id}/summary").status_code, 403)

    def test_missing_auth_token_does_not_create_audit_or_access_db(self):
        main.app.dependency_overrides.pop(auth.resolve_auth_principal)
        response = self.client.get(f"/admin/users/{self.a.id}/summary")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(len(self.logs()), 0)

    def test_http_rate_limit_429_uses_verified_identity_before_admin_db(self):
        from security_rate_limit import InMemoryRateLimiter
        import security_rate_limit as limits
        self.grant("support_admin")
        main.app.dependency_overrides.pop(auth.resolve_auth_principal)
        from auth_context import VerifiedAuthIdentity
        with patch.dict(os.environ, {"NOIE_RATE_LIMIT_ENABLED": "true", "NOIE_RATE_LIMIT_STANDARD_PER_MINUTE": "1"}), \
                patch.object(limits, "limiter", InMemoryRateLimiter()), \
                patch("supabase_auth_verifier.verify_supabase_token", return_value=VerifiedAuthIdentity("supabase", str(uuid4()))), \
                patch("auth_identity_service.resolve_identity_principal", return_value=self.principal):
            headers = {"Authorization": "Bearer SYNTHETIC_TOKEN"}
            self.assertEqual(self.client.get(f"/admin/users/{self.a.id}/summary", headers=headers).status_code, 200)
            before = len(self.logs())
            self.assertEqual(self.client.get(f"/admin/users/{self.a.id}/summary", headers=headers).status_code, 429)
            self.assertEqual(len(self.logs()), before)

    def test_operator_cli_is_explicit_and_output_contains_no_uuid_or_secret(self):
        from scripts import grant_admin_role as cli
        from sqlalchemy.orm import Session
        with patch.object(cli, "SessionLocal", lambda: Session(self.engine)), redirect_stdout(StringIO()) as output:
            code = cli.main(["--user-id", str(self.a.id), "--role", "owner", "--reason-code", "security_incident"])
        self.assertEqual(code, 0)
        self.assertNotIn(str(self.a.id), output.getvalue())
        self.assertEqual(self.db.scalar(select(func.count()).select_from(AdminGrant)), 1)
        with redirect_stderr(StringIO()) as errors:
            with self.assertRaises(SystemExit):
                cli.main(["--user-id", "SYNTHETIC_SECRET", "--role", "owner", "--reason-code", "other"])
        self.assertNotIn("SYNTHETIC_SECRET", errors.getvalue())

    def test_soft_deleted_conversation_and_non_active_memory_are_hidden(self):
        self.grant()
        msid = self.session().json()["id"]
        csid = self.session(scope="conversation_read").json()["id"]
        self.memory.status = "superseded"
        self.db.commit()
        self.assertEqual(self.client.get(self.memory_path(msid)).status_code, 404)
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.client.get(self.messages_path(csid)).status_code, 404)

    def test_grant_unique_and_role_db_constraints(self):
        from sqlalchemy.exc import IntegrityError
        self.grant()
        for row in (AdminGrant(user_id=self.a.id, role="security_admin", is_active=True),
                    AdminGrant(user_id=self.a.id, role="invalid_role", is_active=True)):
            self.db.add(row)
            with self.assertRaises(IntegrityError):
                self.db.commit()
            self.db.rollback()

    def test_break_glass_db_scope_reason_and_expiry_constraints(self):
        from sqlalchemy.exc import IntegrityError
        now = datetime.now(timezone.utc)
        for values in ({"scope": "all_private_data"}, {"reason_code": "arbitrary"}, {"expires_at": now}):
            data = dict(admin_user_id=self.a.id, target_user_id=self.a.id, scope="memory_read",
                        reason_code="other", created_at=now, expires_at=now + timedelta(minutes=1))
            self.db.add(AdminBreakGlassSession(**{**data, **values}))
            with self.assertRaises(IntegrityError):
                self.db.commit()
            self.db.rollback()

    def test_migration_model_columns_constraints_indexes_and_downgrade_match(self):
        """migration의 실제 create_table 인자로 스키마를 만들어 PostgreSQL 모델과 비교합니다."""
        from sqlalchemy import Table
        from sqlalchemy.dialects.postgresql import dialect
        from unittest.mock import Mock
        migration = importlib.import_module("migrations.versions.20261006_0019_add_admin_access")
        schema = MetaData()
        User.__table__.to_metadata(schema)
        op = Mock()
        op.create_table.side_effect = lambda name, *args: Table(name, schema, *args)
        with patch.object(migration, "op", op):
            migration.upgrade()
        self.assertEqual(migration.down_revision, "20261005_0018")
        models = (AdminGrant, AdminBreakGlassSession, AdminAuditLog)
        def columns(table):
            return [(c.name, str(c.type.compile(dialect=dialect())), c.nullable,
                     str(c.server_default.arg) if c.server_default else None) for c in table.columns]
        def constraints(table):
            result = set()
            for c in table.constraints:
                detail = str(c.sqltext) if isinstance(c, CheckConstraint) else tuple(column.name for column in c.columns)
                if isinstance(c, ForeignKeyConstraint):
                    detail = (detail, tuple((e.target_fullname, e.ondelete) for e in c.elements))
                result.add((type(c).__name__, c.name, detail))
            return result
        for model in models:
            self.assertEqual(columns(model.__table__), columns(schema.tables[model.__tablename__]))
            self.assertEqual(constraints(model.__table__), constraints(schema.tables[model.__tablename__]))
        expected = {(i.name, m.__tablename__, tuple(c.name for c in i.columns)) for m in models for i in m.__table__.indexes}
        actual = {(c.args[0], c.args[1], tuple(c.args[2])) for c in op.create_index.call_args_list}
        self.assertEqual(actual, expected)
        op.reset_mock()
        with patch.object(migration, "op", op):
            migration.downgrade()
        self.assertEqual([c.args[0] for c in op.drop_table.call_args_list],
                         ["admin_audit_logs", "admin_break_glass_sessions", "admin_grants"])

    def foreign_memory(self):
        """실제 사용자 데이터 대신 B 합성 Memory/evidence만 생성합니다."""
        row = Memory(user_id=self.b.id, content="B synthetic long term memory", kind="goal")
        self.db.add(row)
        self.db.flush()
        self.db.add(MemoryEvidence(memory_id=row.id, message_id=self.mb.id))
        self.db.commit()
        return row

    def owner_memory_path(self, user=None, memory=None):
        return f"/admin/users/{user or self.b.id}/memories/{memory or self.memory.id}"

    def owner_messages_path(self, user=None, conversation=None):
        return f"/admin/users/{user or self.b.id}/conversations/{conversation or self.cb.id}/messages"

    def test_owner_cross_user_memory_without_break_glass_audited(self):
        self.grant("owner")
        row = self.foreign_memory()
        response = self.client.get(self.owner_memory_path(memory=row.id))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], row.content)
        self.assertEqual(response.json()["evidence"][0]["message"]["content"], self.mb.content)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(AdminBreakGlassSession)), 0)
        audit = [e for e in self.logs() if e.action == "owner.memory.read"][-1]
        self.assertEqual((audit.actor_user_id, audit.target_user_id, audit.resource_id, audit.outcome),
                         (self.a.id, self.b.id, row.id, "success"))

    def test_owner_audit_insert_and_commit_failure_no_foreign_content(self):
        self.grant("owner")
        row = self.foreign_memory()
        for target, name in ((service, "_append_audit"), (self.db, "commit")):
            before = len(self.logs())
            with patch.object(target, name, side_effect=SQLAlchemyError("SYNTHETIC_SECRET")):
                response = self.client.get(self.owner_memory_path(memory=row.id))
            self.assertEqual(response.status_code, 503)
            for private in (row.content, self.mb.content, "SYNTHETIC_SECRET"):
                self.assertNotIn(private, response.text)
            self.assertEqual(len(self.logs()), before)

    def test_owner_cross_user_conversation_and_raw_messages_audited(self):
        self.grant("owner")
        self.cb.metadata_ = {"pipeline": "orchestrator-create-schedule", "token": "SYNTHETIC_SECRET"}
        self.db.commit()
        response = self.client.get(self.owner_messages_path())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["content"], self.mb.content)
        info = self.client.get(f"/admin/users/{self.b.id}/conversations/{self.cb.id}")
        self.assertEqual(info.status_code, 200)
        self.assertEqual(info.json()["title"], self.cb.title)
        self.assertEqual(info.json()["metadata"], {"pipeline": "orchestrator-create-schedule"})
        self.assertNotIn("SYNTHETIC_SECRET", info.text)
        self.assertEqual(len([e for e in self.logs() if e.action == "owner.conversation.read" and e.outcome == "success"]), 2)

    def test_owner_wrong_target_resource_and_absent_same_safe_404(self):
        self.grant("owner")
        for path in (self.owner_memory_path(), self.owner_memory_path(memory=uuid4()),
                     self.owner_messages_path(conversation=self.ca.id), self.owner_messages_path(conversation=uuid4())):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404)
            self.assertNotIn(self.memory.content, response.text)
            self.assertNotIn(self.ma.content, response.text)

    def test_owner_ordinary_user_api_ownership_still_closed(self):
        self.grant("owner")
        row = self.foreign_memory()
        self.assertEqual(self.client.get(f"/memories/{row.id}").status_code, 404)
        self.assertEqual(self.client.get(f"/conversations/{self.cb.id}/messages").status_code, 404)
        self.assertEqual(self.client.get(f"/users/{self.b.id}/memories").status_code, 403)

    def test_security_and_support_direct_read_denied_security_break_glass_allowed(self):
        for role in ("security_admin", "support_admin"):
            self.grant(role)
            for path in (self.owner_memory_path(user=self.a.id), self.owner_messages_path(user=self.a.id, conversation=self.ca.id),
                         f"/admin/users/{self.a.id}/records/daily"):
                self.assertEqual(self.client.get(path).status_code, 403)
        sid = self.session().json()["id"]
        self.assertEqual(self.client.get(self.memory_path(sid)).status_code, 200)

    def test_owner_revoked_direct_read_denied_even_with_other_admin_role(self):
        self.grant("owner")
        self.grant("security_admin")
        row = self.foreign_memory()
        service.provision_admin_grant(self.db, user_id=self.a.id, role="owner", reason_code="other", revoke=True)
        self.assertEqual(self.client.get(self.owner_memory_path(memory=row.id)).status_code, 403)

    def test_owner_read_paths_have_no_write_delete_execute_or_enumeration(self):
        self.grant("owner")
        row = self.foreign_memory()
        before = (self.memory.content, row.content, self.mb.content)
        paths = (self.owner_memory_path(memory=row.id), self.owner_messages_path(),
                 f"/admin/users/{self.b.id}/conversations/{self.cb.id}", f"/admin/users/{self.b.id}/records/daily")
        for path in paths:
            for method in ("POST", "PUT", "PATCH", "DELETE"):
                self.assertEqual(self.client.request(method, path, json={"content": "override"}).status_code, 405)
        self.assertEqual(self.client.get("/admin/users").status_code, 404)
        self.assertEqual(self.client.post("/admin/execute", json={}).status_code, 404)
        self.assertEqual(before, (self.memory.content, row.content, self.mb.content))

    def domain_fixture(self):
        """기존 domain 모델을 복사하며 운영 DB/Agent/Executor를 호출하지 않습니다."""
        schema = MetaData()
        domains = [model for model, response in service.OWNER_RECORDS.values()]
        for model in (User, Conversation, Message, AgentAction, *domains):
            table = model.__table__.to_metadata(schema)
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
                    column.server_default = None
                elif column.server_default is not None and "gen_random_uuid" in str(column.server_default.arg):
                    column.server_default = None
                elif column.server_default is not None and str(column.server_default.arg) == "now()":
                    column.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
        schema.create_all(self.engine, tables=[schema.tables[m.__tablename__] for m in (AgentAction, *domains)])

    def domain_action(self, user, conversation, message):
        row = AgentAction(user_id=user.id, conversation_id=conversation.id, message_id=message.id,
            action_id=uuid4(), action_type="daily_life", intent="synthetic record", mode="record", status="completed",
            confidence=.9, requires_confirmation=False, execution_order=0, idempotency_key=uuid4().hex,
            confirmation_status="not_required")
        self.db.add(row)
        self.db.flush()
        return row

    def test_owner_domain_records_paginated_scoped_and_metadata_whitelisted(self):
        self.domain_fixture()
        self.grant("owner")
        from models.daily_life_event import DailyLifeEvent
        from models.dream_goal import DreamGoal
        for user, conversation, message in ((self.a, self.ca, self.ma), (self.b, self.cb, self.mb)):
            action = self.domain_action(user, conversation, message)
            self.db.add(DailyLifeEvent(user_id=user.id, conversation_id=conversation.id, message_id=message.id,
                agent_action_id=action.id, summary="synthetic daily", source="orchestrator",
                metadata_={"extractor_version": "daily-life-v1", "token": "SYNTHETIC_SECRET"}))
        action = self.domain_action(self.b, self.cb, self.mb)
        self.db.add(DreamGoal(user_id=self.b.id, conversation_id=self.cb.id, message_id=self.mb.id,
            agent_action_id=action.id, statement="synthetic project goal", kind="goal", source="orchestrator"))
        self.db.commit()
        counts = (self.db.scalar(select(func.count()).select_from(AgentAction)),
                  self.db.scalar(select(func.count()).select_from(DailyLifeEvent)))
        for kind in service.OWNER_RECORDS:
            response = self.client.get(f"/admin/users/{self.b.id}/records/{kind}?limit=1")
            self.assertEqual(response.status_code, 200, kind)
            self.assertTrue(all(item["user_id"] == str(self.b.id) for item in response.json()))
            self.assertNotIn("SYNTHETIC_SECRET", response.text)
            if kind == "daily":
                self.assertEqual(response.json()[0]["metadata"], {"extractor_version": "daily-life-v1"})
        self.assertEqual(self.client.get(f"/admin/users/{self.b.id}/records/auth_identities").status_code, 404)
        self.assertEqual(self.client.get(f"/admin/users/{self.b.id}/records/daily?limit=101").status_code, 422)
        self.assertEqual(counts, (self.db.scalar(select(func.count()).select_from(AgentAction)),
                                 self.db.scalar(select(func.count()).select_from(DailyLifeEvent))))
        self.assertEqual(len([e for e in self.logs() if e.action == "owner.record.read" and e.outcome == "success"]), 9)

    def test_owner_domain_legacy_foreign_evidence_is_safe_404(self):
        self.domain_fixture()
        self.grant("owner")
        from models.daily_life_event import DailyLifeEvent
        action = self.domain_action(self.b, self.cb, self.mb)
        self.db.add(DailyLifeEvent(user_id=self.b.id, conversation_id=self.ca.id, message_id=self.ma.id,
            agent_action_id=action.id, summary="synthetic inconsistent reference", source="orchestrator"))
        self.db.commit()
        response = self.client.get(f"/admin/users/{self.b.id}/records/daily")
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("synthetic inconsistent reference", response.text)

    def test_owner_deleted_target_or_evidence_stays_excluded(self):
        self.grant("owner")
        row = self.foreign_memory()
        self.cb.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.client.get(self.owner_memory_path(memory=row.id)).status_code, 404)
        self.assertEqual(self.client.get(self.owner_messages_path()).status_code, 404)
        self.b.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.client.get(self.owner_memory_path(memory=row.id)).status_code, 404)


if __name__ == "__main__":
    unittest.main()
