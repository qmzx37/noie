"""삭제 테스트는 합성 계정과 FK 활성 SQLite만 사용합니다. 운영 데이터는 삭제하지 않습니다."""

import importlib
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import JSON, DefaultClause, MetaData, Table, Column, Integer, create_engine, event, func, insert, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import main
import account_lifecycle_service as service
from auth_context import AuthPrincipal, VerifiedAuthIdentity, resolve_auth_principal
from auth_bootstrap_service import bootstrap_auth_identity, BootstrapError
from auth_identity_service import resolve_identity_principal, IdentityMappingError
from database import Base, get_db
from models.user import User
from models.conversation import Conversation
from models.message import Message
from models.memory import Memory, MemoryEvidence
from models.auth_identity import AuthIdentity
from models.admin_grant import AdminGrant
from models.admin_audit_log import AdminAuditLog
from models.admin_break_glass_session import AdminBreakGlassSession
from models.agent_action import AgentAction


def seed_domain_records(db, user_id, conversation_id, message_id):
    """9개 실제 모델의 제약을 지키는 합성 행입니다. 실행기나 OpenAI는 호출하지 않습니다."""
    from models.emotion_event import EmotionEvent
    from models.body_state_event import BodyStateEvent
    from models.cognitive_state_event import CognitiveStateEvent
    from models.daily_life_event import DailyLifeEvent
    from models.dream_goal import DreamGoal
    from models.schedule import Schedule
    from models.place_event import PlaceEvent
    from models.recommendation import Recommendation
    from models.relationship_event import RelationshipEvent
    specs = [
        (EmotionEvent, dict(f=.1,a=.1,d=.1,j=.1,c=.1,g=.1,t=.1,r=.1,confidence=.8)),
        (BodyStateEvent, dict(fatigue=.3,confidence=.8)),
        (CognitiveStateEvent, dict(focus=.3,confidence=.8)),
        (DailyLifeEvent, dict(summary="synthetic daily")),
        (DreamGoal, dict(statement="synthetic goal",kind="goal")),
        (Schedule, dict(title="synthetic schedule",start_at=datetime.now(timezone.utc))),
        (PlaceEvent, dict(place_name="synthetic place",kind="visit")),
        (Recommendation, dict(primary_action="synthetic choice",rationale="synthetic rationale",recommendation_kind="direct",confidence=.8)),
        (RelationshipEvent, dict(record_index=0,person_label="synthetic person",identity_kind="named",record_kind="social_relation",relationship_type="friend",relationship_statement="synthetic relationship",temporal_scope="current",confidence=.8)),
    ]
    for model, fields in specs:
        action = AgentAction(user_id=user_id, conversation_id=conversation_id, message_id=message_id,
            action_id=uuid4(), action_type="record_daily_trace", intent="record", mode="record", status="completed",
            confidence=.8, requires_confirmation=False, execution_order=0,
            idempotency_key=uuid4().hex, confirmation_status="not_required")
        db.add(action); db.flush()
        db.add(model(user_id=user_id, conversation_id=conversation_id, message_id=message_id,
            agent_action_id=action.id, **fields))
    db.commit()


class AccountDeletionTests(unittest.TestCase):
    """기존 모델을 복사하며 production JSONB/UUID/default 정책 자체를 바꾸지 않습니다."""

    def setUp(self):
        self.env = patch.dict(os.environ, {"NOIE_AUTH_ENABLED": "true", "NOIE_RATE_LIMIT_ENABLED": "false"})
        self.env.start()
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        @event.listens_for(self.engine, "connect")
        def foreign_keys(connection, record):
            connection.execute("PRAGMA foreign_keys=ON")
        schema = MetaData()
        for original in Base.metadata.sorted_tables:
            table = original.to_metadata(schema)
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON(); column.server_default = None
                elif column.server_default is not None:
                    value = str(column.server_default.arg)
                    if "gen_random_uuid" in value: column.server_default = None
                    elif value == "now()": column.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
        schema.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.a, self.b = User(name="deletion-fixture-a"), User(name="deletion-fixture-b")
        self.db.add_all([self.a, self.b]); self.db.flush()
        self.aid, self.bid = self.a.id, self.b.id
        self.ca, self.cb = Conversation(user_id=self.aid), Conversation(user_id=self.bid)
        self.db.add_all([self.ca, self.cb]); self.db.flush()
        self.ma = Message(conversation_id=self.ca.id, user_id=self.aid, role="user", content="synthetic private A")
        self.mb = Message(conversation_id=self.cb.id, user_id=self.bid, role="user", content="synthetic private B")
        self.db.add_all([self.ma, self.mb]); self.db.flush()
        self.memory = Memory(user_id=self.aid, content="synthetic interpretation", kind="goal")
        self.db.add(self.memory); self.db.flush()
        self.db.add(MemoryEvidence(memory_id=self.memory.id, message_id=self.ma.id))
        self.identity = VerifiedAuthIdentity("supabase", str(uuid4()))
        self.db.add(AuthIdentity(user_id=self.aid, provider="supabase", subject=self.identity.subject))
        self.db.commit()
        self.principal = AuthPrincipal(self.aid)
        self.overrides = dict(main.app.dependency_overrides)
        main.app.dependency_overrides[get_db] = lambda: self.db
        main.app.dependency_overrides[resolve_auth_principal] = lambda: self.principal
        self.client = TestClient(main.app)
        self.background = patch("account_router.run_account_purge")
        self.background_mock = self.background.start()

    def tearDown(self):
        self.background.stop(); self.client.close()
        main.app.dependency_overrides.clear(); main.app.dependency_overrides.update(self.overrides)
        self.db.close(); self.engine.dispose(); self.env.stop()

    def request(self, **kwargs):
        return self.client.post("/account/delete", json={"confirmation": "DELETE_MY_NOIE_ACCOUNT", **kwargs})

    def count(self, name):
        return self.db.scalar(select(func.count()).select_from(Base.metadata.tables[name]))

    def test_confirmation_and_extra_fields_have_no_writes(self):
        for body in ({}, {"confirmation": "wrong"}, {"confirmation": "DELETE_MY_NOIE_ACCOUNT", "user_id": str(self.bid)}):
            result = self.client.post("/account/delete", json=body)
            self.assertEqual(result.status_code, 422)
        self.assertEqual(self.count("admin_audit_logs"), 0)
        self.assertIsNone(self.db.get(User, self.aid).deleted_at)
        self.background_mock.assert_not_called()

    def test_auth_off_none_never_deletes_dev_user(self):
        self.principal = None
        self.assertEqual(self.request().status_code, 401)
        self.assertIsNone(self.db.get(User, self.aid).deleted_at)

    def test_header_user_cannot_select_target_query_is_rejected(self):
        result = self.client.post("/account/delete?user_id=" + str(self.bid), json={"confirmation": "DELETE_MY_NOIE_ACCOUNT"})
        self.assertEqual(result.status_code, 400)
        result = self.client.post("/account/delete", json={"confirmation": "DELETE_MY_NOIE_ACCOUNT"}, headers={"X-User-ID": str(self.bid)})
        self.assertEqual(result.status_code, 202)
        self.assertIsNotNone(self.db.get(User, self.aid).deleted_at)
        self.assertIsNone(self.db.get(User, self.bid).deleted_at)

    def test_deactivation_committed_before_background_and_mapping_preserved(self):
        result = self.request()
        self.assertEqual(result.status_code, 202)
        self.assertEqual(result.json(), {"status": "deletion_requested"})
        self.assertIsNotNone(self.db.get(User, self.aid).deleted_at)
        self.assertEqual(self.count("auth_identities"), 1)
        self.assertEqual(self.count("messages"), 2)
        self.background_mock.assert_called_once_with(self.aid)

    def test_old_verified_identity_and_bootstrap_blocked_while_pending(self):
        service.deactivate_account(self.db, self.principal)
        with patch("auth_identity_service.SessionLocal", sessionmaker(self.engine)):
            with self.assertRaises(IdentityMappingError): resolve_identity_principal(self.identity)
        with self.assertRaises(BootstrapError): bootstrap_auth_identity(self.db, self.identity)
        self.assertEqual(self.count("users"), 2)

    def test_last_owner_blocked_then_other_owner_allows(self):
        self.db.add(AdminGrant(user_id=self.aid, role="owner", is_active=True)); self.db.commit()
        self.assertEqual(self.request().status_code, 409)
        self.assertIsNone(self.db.get(User, self.aid).deleted_at)
        self.db.add(AdminGrant(user_id=self.bid, role="owner", is_active=True)); self.db.commit()
        self.assertEqual(self.request().status_code, 202)
        self.assertFalse(self.db.scalar(select(AdminGrant).where(AdminGrant.user_id == self.aid)).is_active)

    def test_inactive_other_owner_does_not_count(self):
        self.b.deleted_at = datetime.now(timezone.utc)
        self.db.add_all([AdminGrant(user_id=self.aid, role="owner", is_active=True), AdminGrant(user_id=self.bid, role="owner", is_active=True)])
        self.db.commit()
        self.assertEqual(self.request().status_code, 409)

    def test_admin_grants_sessions_revoked_and_raw_reads_denied(self):
        now = datetime.now(timezone.utc)
        self.db.add(AdminGrant(user_id=self.aid, role="support_admin", is_active=True))
        self.db.add(AdminGrant(user_id=self.bid, role="owner", is_active=True))
        session = AdminBreakGlassSession(admin_user_id=self.bid, target_user_id=self.aid, scope="memory_read", reason_code="security_incident", created_at=now, expires_at=now+timedelta(minutes=5))
        self.db.add(session); self.db.commit()
        service.deactivate_account(self.db, self.principal)
        self.assertIsNotNone(self.db.get(AdminBreakGlassSession, session.id).revoked_at)
        self.principal = AuthPrincipal(self.bid)
        self.assertEqual(self.client.get(f"/admin/users/{self.aid}/memories/{self.memory.id}").status_code, 404)

    def test_deactivation_audit_or_commit_failure_rolls_back(self):
        for target, name in ((service, "_audit"), (self.db, "commit")):
            with patch.object(target, name, side_effect=RuntimeError("PRIVATE_SECRET")):
                response = self.request()
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("PRIVATE_SECRET", response.text)
            self.assertIsNone(self.db.get(User, self.aid).deleted_at)

    def test_purge_active_forbidden(self):
        with self.assertRaises(service.AccountLifecycleError): service.purge_deleted_account(self.db, self.aid)
        self.assertEqual(self.count("users"), 2)

    def test_purge_all_rows_and_history_retained_retry_noop(self):
        service.deactivate_account(self.db, self.principal)
        self.assertEqual(service.purge_deleted_account(self.db, self.aid), "purged")
        self.assertIsNone(self.db.get(User, self.aid))
        self.assertEqual(self.count("messages"), 1)
        self.assertEqual(self.db.get(Message, self.mb.id).content, "synthetic private B")
        self.assertEqual(self.count("auth_identities"), 0)
        self.assertEqual(self.count("memories"), 0)
        self.assertEqual(self.count("memory_evidence"), 0)
        self.assertEqual(self.count("admin_audit_logs"), 2)
        self.assertEqual(service.purge_deleted_account(self.db, self.aid), "already_absent")

    def test_failure_after_deletes_rolls_back_phase_b_only_then_retry(self):
        service.deactivate_account(self.db, self.principal)
        with patch.object(service, "_audit", side_effect=RuntimeError("private failure")):
            with self.assertRaises(service.AccountLifecycleError): service.purge_deleted_account(self.db, self.aid)
        self.assertIsNotNone(self.db.get(User, self.aid).deleted_at)
        self.assertEqual(self.count("messages"), 2)
        self.assertEqual(self.count("memory_evidence"), 1)
        self.assertEqual(service.purge_deleted_account(self.db, self.aid), "purged")

    def test_cross_account_evidence_blocks_purge_preserves_b(self):
        other = Memory(user_id=self.bid, content="B memory", kind="goal")
        self.db.add(other); self.db.flush()
        self.db.add(MemoryEvidence(memory_id=other.id, message_id=self.ma.id)); self.db.commit()
        service.deactivate_account(self.db, self.principal)
        with self.assertRaises(service.AccountLifecycleError): service.purge_deleted_account(self.db, self.aid)
        self.assertEqual(self.count("memory_evidence"), 2)
        self.assertEqual(self.db.get(Memory, other.id).content, "B memory")

    def test_memory_supersession_chain_purges_without_cascade(self):
        successor = Memory(user_id=self.aid, content="successor", kind="goal", supersedes_memory_id=self.memory.id)
        self.db.add(successor); self.db.commit()
        service.deactivate_account(self.db, self.principal)
        self.assertEqual(service.purge_deleted_account(self.db, self.aid), "purged")
        self.assertEqual(self.count("memories"), 0)

    def test_inventory_rejects_unreviewed_table(self):
        unexpected = Table("unexpected_fixture", Base.metadata, Column("id", Integer, primary_key=True))
        try:
            with self.assertRaises(service.AccountLifecycleError): service.deactivate_account(self.db, self.principal)
            self.assertIsNone(self.db.get(User, self.aid).deleted_at)
        finally: Base.metadata.remove(unexpected)

    def test_self_account_identity_active_only(self):
        response = self.client.get("/account")
        self.assertEqual(response.json(), {"user_id": str(self.aid)})
        service.deactivate_account(self.db, self.principal)
        self.assertEqual(self.client.get("/account").status_code, 403)

    def test_rejoin_only_after_purge_is_new_local_user(self):
        service.deactivate_account(self.db, self.principal)
        service.purge_deleted_account(self.db, self.aid)
        new_id = bootstrap_auth_identity(self.db, self.identity)
        self.assertNotEqual(new_id, self.aid)
        self.assertEqual(self.count("conversations"), 1)  # B만 보존. 옛 A data는 되살리지 않습니다.

    def test_background_failure_safe_and_retryable(self):
        service.deactivate_account(self.db, self.principal)
        from contextlib import redirect_stdout
        from io import StringIO
        output = StringIO()
        with patch.object(service, "SessionLocal", None), redirect_stdout(output): service.run_account_purge(self.aid)
        self.assertNotIn(str(self.aid), output.getvalue())
        self.assertIsNotNone(self.db.get(User, self.aid).deleted_at)

    def test_all_nine_domains_requests_extractions_purged_b_preserved(self):
        from models.chat_request import ChatRequestRecord
        from models.memory_extraction import MemoryExtraction
        seed_domain_records(self.db, self.aid, self.ca.id, self.ma.id)
        seed_domain_records(self.db, self.bid, self.cb.id, self.mb.id)
        self.db.add(ChatRequestRecord(request_id=uuid4(),conversation_id=self.ca.id,
            request_hash="0"*64,user_message_id=self.ma.id,status="completed",response={"reply":"synthetic"}))
        self.db.add(MemoryExtraction(message_id=self.ma.id,memory_id=self.memory.id,
            matched_memory_id=self.memory.id,extractor_version="test",status="completed"))
        self.db.commit()
        service.deactivate_account(self.db, self.principal)
        service.purge_deleted_account(self.db, self.aid)
        for name in ("emotion_events","body_state_events","cognitive_state_events","daily_life_events",
                     "dream_goals","schedules","place_events","recommendations","relationship_events"):
            self.assertEqual(self.count(name),1,name)
            self.assertEqual(self.db.scalar(select(Base.metadata.tables[name].c.user_id)),self.bid)
        self.assertEqual(self.count("agent_actions"),9)
        self.assertEqual(self.count("chat_requests"),0)
        self.assertEqual(self.count("memory_extractions"),0)

    def test_purge_commit_failure_keeps_deactivated_data(self):
        service.deactivate_account(self.db, self.principal)
        with patch.object(self.db,"commit",side_effect=RuntimeError("synthetic commit failure")):
            with self.assertRaises(service.AccountLifecycleError): service.purge_deleted_account(self.db,self.aid)
        self.assertEqual(self.count("messages"),2)
        self.assertIsNotNone(self.db.get(User,self.aid).deleted_at)


def run_postgres_isolated():
    """명시적 옵션에서만 임시 schema를 사용합니다. 운영 schema migration/계정 삭제는 하지 않습니다."""
    from sqlalchemy.schema import CreateSchema
    from sqlalchemy.exc import IntegrityError
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from alembic.autogenerate import compare_metadata
    from database import engine
    schema = "noie_delete_validation_" + uuid4().hex
    m19 = importlib.import_module("migrations.versions.20261006_0019_add_admin_access")
    m20 = importlib.import_module("migrations.versions.20261006_0020_add_account_deletion_audit")
    try:
        if engine is None or engine.dialect.name != "postgresql":
            raise RuntimeError
        with engine.connect() as conn:
            tx = conn.begin()
            try:
                print("Existing DB revision:", conn.scalar(text("SELECT version_num FROM public.alembic_version")))
                conn.execute(CreateSchema(schema))
                conn.execute(text("SET LOCAL search_path TO " + conn.dialect.identifier_preparer.quote(schema)))
                # column-level unique=True의 복사도 같은 constraint 이름을 생성해야 합니다.
                meta = MetaData(naming_convention=Base.metadata.naming_convention)
                for table in Base.metadata.sorted_tables:
                    if table.name not in {"admin_grants", "admin_break_glass_sessions", "admin_audit_logs"}:
                        table.to_metadata(meta)
                meta.create_all(conn)
                context = MigrationContext.configure(conn, opts={"compare_type": True, "compare_server_default": True})
                with patch.object(m19, "op", Operations(context)): m19.upgrade()
                with patch.object(m20, "op", Operations(context)):
                    m20.upgrade(); m20.downgrade(); m20.upgrade()
                assert not compare_metadata(context, Base.metadata), "Model/migration drift"
                print("Isolated PostgreSQL upgrade/downgrade/model comparison: PASS")
                # service commitはSAVEPOINTだけを確定し、外側のtransactionは最後に全てrollbackします。
                with Session(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint") as db:
                    a, b = User(name="synthetic-delete-validation-a"), User(name="synthetic-delete-validation-b")
                    db.add_all([a, b]); db.flush(); aid, bid = a.id, b.id
                    ca, cb = Conversation(user_id=aid), Conversation(user_id=bid)
                    db.add_all([ca, cb]); db.flush()
                    ma = Message(conversation_id=ca.id, user_id=aid, role="user", content="synthetic A")
                    mb = Message(conversation_id=cb.id, user_id=bid, role="user", content="synthetic B")
                    db.add_all([ma, mb]); db.flush(); maid, mbid = ma.id, mb.id
                    memory = Memory(user_id=aid, content="synthetic memory", kind="goal")
                    db.add(memory); db.flush()
                    db.add(MemoryEvidence(memory_id=memory.id, message_id=maid))
                    from models.memory_extraction import MemoryExtraction
                    from models.chat_request import ChatRequestRecord
                    db.add(MemoryExtraction(message_id=maid, memory_id=memory.id, matched_memory_id=memory.id,
                        extractor_version="synthetic", status="completed"))
                    db.add(AuthIdentity(user_id=aid, provider="supabase", subject=str(uuid4())))
                    db.add(ChatRequestRecord(request_id=uuid4(), conversation_id=ca.id, user_message_id=maid,
                        request_hash="0" * 64, status="completed"))
                    db.add(AdminGrant(user_id=aid, role="owner", is_active=True)); db.commit()
                    try:
                        service.deactivate_account(db, AuthPrincipal(aid))
                        raise AssertionError("Last OWNER not blocked")
                    except service.AccountLifecycleError as error:
                        assert error.code == "LAST_OWNER"
                    db.add(AdminGrant(user_id=bid, role="owner", is_active=True)); db.commit()
                    seed_domain_records(db, aid, ca.id, maid); seed_domain_records(db, bid, cb.id, mbid)
                    service.deactivate_account(db, AuthPrincipal(aid))
                    with patch.object(service, "_audit", side_effect=RuntimeError("synthetic audit failure")):
                        try:
                            service.purge_deleted_account(db, aid)
                            raise AssertionError("Failure not rolled back")
                        except service.AccountLifecycleError: pass
                    assert db.get(User, aid).deleted_at is not None and db.get(Message, maid) is not None
                    assert service.purge_deleted_account(db, aid) == "purged"
                    assert service.purge_deleted_account(db, aid) == "already_absent"
                    assert db.get(User, aid) is None and db.get(Message, mbid).content == "synthetic B"
                    for name in ("emotion_events", "body_state_events", "cognitive_state_events", "daily_life_events",
                                 "dream_goals", "schedules", "place_events", "recommendations", "relationship_events"):
                        assert list(db.scalars(select(Base.metadata.tables[name].c.user_id))) == [bid]
                    for name in ("memory_evidence", "memory_extractions", "chat_requests", "auth_identities", "memories"):
                        assert not list(db.execute(select(Base.metadata.tables[name])))
                    assert len(list(db.execute(select(Base.metadata.tables["admin_audit_logs"])))) == 2
                    db.rollback()
                try:
                    with conn.begin_nested():
                        with patch.object(m20, "op", Operations(context)): m20.downgrade()
                except IntegrityError:
                    print("Downgrade with deletion audit safely rejected: PASS")
                else: raise AssertionError("Deletion audit not protected")
                print("Isolated PostgreSQL last OWNER/9 domains/rollback/retry/isolation/audit: PASS")
            finally:
                tx.rollback()
            assert conn.scalar(text("SELECT count(*) FROM pg_namespace WHERE nspname=:name"), {"name": schema}) == 0
            print("Temporary schema absent; all synthetic DDL/data rolled back; production unchanged")
        return 0
    except Exception as error:
        print("Isolated validation failed:", type(error).__name__)
        return 1


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["--postgres-isolated"]:
        raise SystemExit(run_postgres_isolated())
    unittest.main()
