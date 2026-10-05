"""Core Data 소유권 검사: 격리된 메모리 SQLite와 mock만 사용하며 외부 DB/AI는 호출하지 않습니다."""

import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import JSON, DefaultClause, MetaData, create_engine, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import main
import auth_context as auth
import memory_extraction_service as extraction
import memory_retriever as retrieval
from database import get_db
from models.user import User
from models.conversation import Conversation
from models.message import Message
from models.memory import Memory, MemoryEvidence
from models.memory_extraction import MemoryExtraction
from memory_extractor import EXTRACTOR_VERSION


class AuthSurfaceTests(unittest.TestCase):
    """AUTH ON에서 HTTP UUID만으로 다른 사용자의 데이터에 접근할 수 없습니다."""

    def setUp(self):
        # PostgreSQL 모델은 변경하지 않고 테스트용 복사 테이블의 타입/기본값만 SQLite에 맞춥니다.
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        schema = MetaData()
        for model in (User, Conversation, Message, Memory, MemoryEvidence, MemoryExtraction):
            table = model.__table__.to_metadata(schema)
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
                    column.server_default = None
                elif column.server_default is not None and "gen_random_uuid" in str(column.server_default.arg):
                    column.server_default = None
                elif column.server_default is not None and str(column.server_default.arg) == "now()":
                    column.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
        schema.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.a, self.b = User(name="fixture-a"), User(name="fixture-b")
        self.db.add_all([self.a, self.b])
        self.db.flush()
        self.ca, self.cb = Conversation(user_id=self.a.id, title="a"), Conversation(user_id=self.b.id, title="b")
        self.db.add_all([self.ca, self.cb])
        self.db.flush()
        self.ma = Message(conversation_id=self.ca.id, user_id=self.a.id, role="user", content="A private original")
        self.mb = Message(conversation_id=self.cb.id, user_id=self.b.id, role="user", content="B private original")
        self.assistant = Message(conversation_id=self.ca.id, user_id=None, role="assistant", content="A assistant")
        self.db.add_all([self.ma, self.mb, self.assistant])
        self.db.flush()
        self.memory = Memory(user_id=self.a.id, content="A private memory", kind="goal")
        self.db.add(self.memory)
        self.db.flush()
        self.db.add(MemoryEvidence(memory_id=self.memory.id, message_id=self.ma.id))
        self.db.commit()
        self.principal = auth.AuthPrincipal(self.a.id)
        self.old_overrides = dict(main.app.dependency_overrides)
        def db_override():
            yield self.db
        main.app.dependency_overrides[get_db] = db_override
        main.app.dependency_overrides[auth.resolve_auth_principal] = lambda: self.principal
        self.env = patch.dict(os.environ, {"NOIE_AUTH_ENABLED": "true"})
        self.env.start()
        self.client = TestClient(main.app)
        # 예상 밖 외부 호출은 테스트를 즉시 실패시킵니다.
        self.guards = [patch("memory_extractor.OpenAI", side_effect=AssertionError("Unexpected OpenAI")),
                       patch("memory_retriever.OpenAI", side_effect=AssertionError("Unexpected OpenAI"))]
        for guard in self.guards:
            guard.start()

    def tearDown(self):
        for guard in reversed(self.guards):
            guard.stop()
        self.client.close()
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(self.old_overrides)
        self.env.stop()
        self.db.close()
        self.engine.dispose()

    def memory_body(self, user_id=None, evidence=None):
        return {"user_id": str(user_id or self.a.id), "content": "unchanged interpretation", "kind": "goal",
                "evidence_message_ids": [str(evidence or self.ma.id)]}

    def endpoints(self):
        # 모든 보호 surface를 나열하여 하나라도 인증 dependency가 빠지면 발견합니다.
        return [
            ("POST", "/users", {"name": "dev"}),
            ("POST", "/conversations", {"user_id": str(self.a.id)}),
            ("GET", f"/users/{self.a.id}/conversations", None),
            ("POST", f"/conversations/{self.ca.id}/messages", {"role": "user", "content": "raw"}),
            ("GET", f"/conversations/{self.ca.id}/messages", None),
            ("POST", "/memories", self.memory_body()),
            ("GET", f"/users/{self.a.id}/memories", None),
            ("GET", f"/memories/{self.memory.id}", None),
            ("POST", f"/messages/{self.ma.id}/extract-memory", {"user_id": str(self.a.id)}),
            ("GET", f"/messages/{self.ma.id}/memory-extraction?user_id={self.a.id}", None),
            ("POST", "/memory-retrieval/preview", {"user_id": str(self.a.id), "query": "goal"}),
        ]

    def test_all_core_endpoints_missing_token_401(self):
        main.app.dependency_overrides.pop(auth.resolve_auth_principal)
        for method, url, body in self.endpoints():
            with self.subTest(url=url):
                result = self.client.request(method, url, json=body)
                self.assertEqual(result.status_code, 401)

    def test_all_core_endpoints_invalid_token_401(self):
        main.app.dependency_overrides.pop(auth.resolve_auth_principal)
        from supabase_auth_verifier import TokenVerificationError
        with patch("supabase_auth_verifier.verify_supabase_token", side_effect=TokenVerificationError("private")):
            for method, url, body in self.endpoints():
                with self.subTest(url=url):
                    result = self.client.request(method, url, json=body, headers={"Authorization": "Bearer invalid"})
                    self.assertEqual(result.status_code, 401)
                    self.assertNotIn("private", result.text)

    def test_auth_on_none_override_is_fail_closed_on_every_endpoint(self):
        self.principal = None
        for method, url, body in self.endpoints():
            with self.subTest(url=url):
                self.assertEqual(self.client.request(method, url, json=body).status_code, 401)

    def test_explicit_uuid_is_consistency_check_not_authority(self):
        # Authenticated principal is the authority; client-supplied user_id is only a consistency check.
        cases = [
            ("POST", "/conversations", {"user_id": str(self.b.id)}),
            ("GET", f"/users/{self.b.id}/conversations", None),
            ("POST", "/memories", self.memory_body(self.b.id, self.mb.id)),
            ("GET", f"/users/{self.b.id}/memories", None),
            ("POST", f"/messages/{self.mb.id}/extract-memory", {"user_id": str(self.b.id)}),
            ("GET", f"/messages/{self.mb.id}/memory-extraction?user_id={self.b.id}", None),
            ("POST", "/memory-retrieval/preview", {"user_id": str(self.b.id), "query": "goal"}),
        ]
        for method, url, body in cases:
            with self.subTest(url=url):
                result = self.client.request(method, url, json=body)
                self.assertEqual(result.status_code, 403)
                self.assertNotIn(str(self.b.id), result.text)

    def test_authenticated_user_creation_closed_404_without_write(self):
        with patch("chat_storage_router.create_user") as create:
            self.assertEqual(self.client.post("/users", json={"name": "arbitrary"}).status_code, 404)
            create.assert_not_called()

    def test_authenticated_user_creation_closed_before_database_dependency(self):
        def unavailable():
            raise AssertionError("Auth ON must close before DB session")
        main.app.dependency_overrides[get_db] = unavailable
        self.assertEqual(self.client.post("/users", json={"name": "arbitrary"}).status_code, 404)

    def test_resource_lookup_database_error_is_safe_and_rolls_back(self):
        from sqlalchemy.exc import SQLAlchemyError
        secret = "PRIVATE SQL connection secret"
        with patch.object(self.db, "scalar", side_effect=SQLAlchemyError(secret)), \
             patch.object(self.db, "rollback") as rollback:
            result = self.client.get(f"/conversations/{self.ca.id}/messages")
            self.assertEqual(result.status_code, 500)
            self.assertNotIn(secret, result.text)
            rollback.assert_called_once()

    def test_own_assistant_message_extraction_role_policy_unchanged(self):
        with patch.object(extraction, "SessionLocal", lambda: Session(self.engine)):
            result = self.client.post(f"/messages/{self.assistant.id}/extract-memory", json={"user_id": str(self.a.id)})
            self.assertEqual(result.status_code, 400)

    def test_own_conversation_and_original_message_roundtrip(self):
        result = self.client.post("/conversations", json={"user_id": str(self.a.id), "title": "new"})
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json()["user_id"], str(self.a.id))
        cid = result.json()["id"]
        raw = "  preserve original\n "
        saved = self.client.post(f"/conversations/{cid}/messages", json={"role": "user", "content": raw})
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.json()["content"], raw)
        self.assertEqual(saved.json()["user_id"], str(self.a.id))
        self.assertEqual(self.client.get(f"/conversations/{cid}/messages").json()[0]["content"], raw)
        listed = self.client.get(f"/users/{self.a.id}/conversations")
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(all(row["user_id"] == str(self.a.id) for row in listed.json()))

    def test_other_conversation_and_missing_id_same_404_no_message_write(self):
        for cid in (self.cb.id, uuid4()):
            with self.subTest(cid=cid):
                result = self.client.get(f"/conversations/{cid}/messages")
                self.assertEqual(result.status_code, 404)
                self.assertNotIn(str(self.b.id), result.text)
                with patch("chat_storage_router.create_message") as create:
                    saved = self.client.post(f"/conversations/{cid}/messages", json={"role": "user", "content": "forged"})
                    self.assertEqual(saved.status_code, 404)
                    create.assert_not_called()

    def test_assistant_system_nullable_user_id_policy_unchanged(self):
        for role in ("assistant", "system"):
            result = self.client.post(f"/conversations/{self.ca.id}/messages", json={"role": role, "content": "original"})
            self.assertEqual(result.status_code, 201)
            self.assertIsNone(result.json()["user_id"])
        self.assertEqual(self.client.post(f"/conversations/{self.ca.id}/messages",
            json={"role": "user", "content": "  "}).status_code, 422)

    def test_own_memory_and_evidence_roundtrip(self):
        result = self.client.post("/memories", json=self.memory_body())
        self.assertEqual(result.status_code, 201)
        memory_id = result.json()["id"]
        detail = self.client.get(f"/memories/{memory_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["user_id"], str(self.a.id))
        self.assertEqual(detail.json()["evidence"][0]["message"]["content"], self.ma.content)
        listed = self.client.get(f"/users/{self.a.id}/memories")
        self.assertTrue(all(row["user_id"] == str(self.a.id) for row in listed.json()))

    def test_other_memory_and_unknown_id_same_404_no_evidence_load(self):
        self.principal = auth.AuthPrincipal(self.b.id)
        for mid in (self.memory.id, uuid4()):
            with patch("memory_router.get_memory") as get:
                result = self.client.get(f"/memories/{mid}")
                self.assertEqual(result.status_code, 404)
                self.assertNotIn(self.memory.content, result.text)
                get.assert_not_called()

    def test_other_evidence_rejected_by_existing_validation_without_memory_write(self):
        count = len(self.db.scalars(select(Memory)).all())
        result = self.client.post("/memories", json=self.memory_body(evidence=self.mb.id))
        self.assertEqual(result.status_code, 400)
        self.assertEqual(len(self.db.scalars(select(Memory)).all()), count)
        self.assertNotIn(self.mb.content, result.text)

    def test_other_message_extraction_404_before_openai_or_lease(self):
        # 실제 서비스의 최초 소유권 조회를 사용하되 세션만 격리 SQLite로 바꿉니다.
        with patch.object(extraction, "SessionLocal", lambda: Session(self.engine)), \
             patch.object(extraction, "extract_memory_with_openai") as analyze:
            for mid in (self.mb.id, uuid4()):
                with self.subTest(mid=mid):
                    result = self.client.post(f"/messages/{mid}/extract-memory", json={"user_id": str(self.a.id)})
                    self.assertEqual(result.status_code, 404)
                    status = self.client.get(f"/messages/{mid}/memory-extraction?user_id={self.a.id}")
                    self.assertEqual(status.status_code, 404)
            analyze.assert_not_called()

    def test_extraction_uses_principal_uuid_for_both_paths(self):
        # 하위 서비스에 전달한 UUID를 검사합니다. 실제 추출/OpenAI는 실행하지 않습니다.
        for method, path, name in [("POST", f"/messages/{self.ma.id}/extract-memory", "extract_memory_for_message"),
                                  ("GET", f"/messages/{self.ma.id}/memory-extraction?user_id={self.a.id}", "get_memory_extraction")]:
            with patch(f"memory_router.{name}", side_effect=extraction.MemoryExtractionNotFoundError) as called:
                result = self.client.request(method, path, json={"user_id": str(self.a.id)} if method == "POST" else None)
                self.assertEqual(result.status_code, 404)
                called.assert_called_once_with(self.ma.id, self.principal.user_id)

    def test_own_completed_extraction_roundtrip_reuses_result_without_openai(self):
        # 완료된 상태의 재조회/재호출은 실제 기존 서비스를 통해 검사합니다.
        saved = MemoryExtraction(message_id=self.ma.id, extractor_version=EXTRACTOR_VERSION,
            status="completed", should_remember=False, reason="fixture", attempt_count=1,
            completed_at=datetime.now(timezone.utc))
        self.db.add(saved)
        self.db.commit()
        with patch.object(extraction, "SessionLocal", lambda: Session(self.engine)), \
             patch.object(extraction, "extract_memory_with_openai") as analyze:
            for _ in range(2):
                result = self.client.post(f"/messages/{self.ma.id}/extract-memory", json={"user_id": str(self.a.id)})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()["id"], str(saved.id))
            result = self.client.get(f"/messages/{self.ma.id}/memory-extraction?user_id={self.a.id}")
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["status"], "completed")
            analyze.assert_not_called()

    def test_retrieval_sql_filters_principal_owner_and_never_returns_other_memory(self):
        self.principal = auth.AuthPrincipal(self.b.id)
        with patch.object(retrieval, "SessionLocal", lambda: Session(self.engine)):
            result = self.client.post("/memory-retrieval/preview", json={"user_id": str(self.b.id), "query": "goal"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["candidates"], [])
        self.assertNotIn(self.memory.content, result.text)
        with patch("memory_router.retrieve_relevant_memories", return_value=([], [])) as called:
            self.client.post("/memory-retrieval/preview", json={"user_id": str(self.b.id), "query": "goal"})
            called.assert_called_once_with(self.principal.user_id, "goal")

    def test_soft_deleted_conversation_and_memory_hidden(self):
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.memory.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.client.get(f"/conversations/{self.ca.id}/messages").status_code, 404)
        self.assertEqual(self.client.get(f"/memories/{self.memory.id}").status_code, 404)

    def test_auth_off_keeps_dev_user_and_cross_identity_legacy_contract(self):
        self.principal = None
        os.environ["NOIE_AUTH_ENABLED"] = "false"
        self.assertEqual(self.client.post("/users", json={"name": "legacy"}).status_code, 201)
        created = self.client.post("/conversations", json={"user_id": str(self.b.id)})
        self.assertEqual(created.status_code, 201)
        cid = created.json()["id"]
        self.assertEqual(self.client.post(f"/conversations/{cid}/messages",
            json={"role": "assistant", "content": "legacy"}).status_code, 201)
        self.assertEqual(self.client.get(f"/conversations/{cid}/messages").status_code, 200)
        self.assertEqual(self.client.get(f"/users/{self.b.id}/conversations").status_code, 200)
        self.assertEqual(self.client.post("/memories", json=self.memory_body()).status_code, 201)
        self.assertEqual(self.client.get(f"/memories/{self.memory.id}").status_code, 200)
        self.assertEqual(self.client.get(f"/users/{self.a.id}/memories").status_code, 200)
        with patch("memory_router.get_memory_extraction", side_effect=extraction.MemoryExtractionAccessError):
            self.assertEqual(self.client.get(f"/messages/{self.mb.id}/memory-extraction?user_id={self.a.id}").status_code, 403)


if __name__ == "__main__":
    unittest.main()
