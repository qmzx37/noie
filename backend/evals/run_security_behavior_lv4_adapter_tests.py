"""Behavior read adapter의 실제 ORM 소유권과 세션 lifecycle을 합성 SQLite로 검사합니다."""

from contextlib import contextmanager
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.orm import Session

from agent.lv4 import behavior_adapter as adapter
from agent.lv4.state_context import StateContext
from agent.lv4.state_specialist import StateSpecialist
from database import Base
from models.message import Message
from evals import run_security_account_deletion_tests as fixtures


class BehaviorLv4OwnershipTests(unittest.TestCase):
    """기존 fixture를 재사용합니다. 실제 PostgreSQL/Render/OpenAI 호출은 없습니다."""

    def setUp(self):
        """다른 계정의 Message와 명확히 분리된 현재 요청을 준비합니다."""
        fixtures.AccountDeletionTests.setUp(self)
        self.ma.content = "운동할까 개발할까?"
        self.mb.content = "요리할까 산책할까?"
        self.db.commit()

    def tearDown(self):
        """테스트 fixture와 override만 정리합니다."""
        fixtures.AccountDeletionTests.tearDown(self)

    def read(self, *, user_id=None, message_id=None, text=None):
        """새 세션으로 조회하고 반환 시 transaction이 닫혔는지 확인합니다."""
        sessions = []

        @contextmanager
        def factory():
            """관측 목적의 session factory이며 production 설정을 바꾸지 않습니다."""
            with Session(self.engine) as db:
                sessions.append(db)
                yield db

        with patch.object(adapter, "SessionLocal", factory):
            result = adapter.read_behavior(user_id=user_id or self.aid, message_id=message_id or self.ma.id,
                                          current_utterance=text or self.ma.content)
        self.assertFalse(any(db.in_transaction() for db in sessions))
        return result

    def fingerprint(self):
        """모든 테이블의 값을 확인합니다. 실제 DB 데이터는 건드리지 않습니다."""
        return {table.name: sorted(repr(tuple(row)) for row in self.db.execute(select(table))) for table in Base.metadata.sorted_tables}

    def test_owner_read_session_closed_and_no_db_writes(self):
        before = self.fingerprint()
        result = self.read()
        self.assertEqual([item.status for item in result], ["candidate", "candidate"])
        self.assertEqual(self.fingerprint(), before)

    def test_other_account_source_blocked(self):
        self.assertEqual(self.read(message_id=self.mb.id, text=self.mb.content), [])

    def test_other_account_reads_only_own_behavior(self):
        result = self.read(user_id=self.bid, message_id=self.mb.id, text=self.mb.content)
        self.assertEqual([item.action for item in result], ["요리", "산책"])
        self.assertFalse(any(item.action == "운동" for item in result))

    def test_same_owner_other_request_text_blocked(self):
        self.assertEqual(self.read(text="운동했어"), [])

    def test_deleted_owner_blocked(self):
        self.a.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.read(), [])

    def test_deleted_conversation_blocked(self):
        self.ca.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(self.read(), [])

    def test_inconsistent_author_blocked(self):
        self.ma.user_id = self.bid
        self.db.commit()
        self.assertEqual(self.read(), [])

    def test_assistant_system_blocked(self):
        for role in ("assistant", "system"):
            source = Message(conversation_id=self.ca.id, role=role, content=self.ma.content)
            self.db.add(source)
            self.db.commit()
            with self.subTest(role=role):
                self.assertEqual(self.read(message_id=source.id), [])

    def test_privacy_restricted_no_state_evidence(self):
        self.ma.content += " password=SuperSecret987"
        self.db.commit()
        result = self.read()
        self.assertEqual(result, [])
        state = StateSpecialist().run(StateContext(as_of=datetime.now(timezone.utc), behaviors=result))
        self.assertNotIn("SuperSecret987", state.model_dump_json())

    def test_missing_session_factory_safe_empty(self):
        with patch.object(adapter, "SessionLocal", None):
            self.assertEqual(adapter.read_behavior(user_id=self.aid, message_id=self.ma.id, current_utterance=self.ma.content), [])

    def test_chat_orm_read_to_mock_sdk_preserves_boundary(self):
        """실제 owned ORM 조회와 실제 네 Specialist를 실행합니다. SDK와 채팅 저장 경계만 합성입니다."""
        from contextlib import redirect_stdout
        from dataclasses import replace
        from io import StringIO
        import json
        from fastapi.testclient import TestClient
        from chat_persistence_service import ChatPersistenceStart
        from evals import run_lv4_production_local_canary_tests as canary
        from agent.lv4 import state_specialist
        import chat_persistence_service

        before = self.fingerprint()
        states = []
        original_run = state_specialist.StateSpecialist._run

        def inspect_state(agent, request):
            """모델 이전 세션 종료와 내부 Message 근거 보존을 확인합니다."""
            opinion = original_run(agent, request)
            states.append(opinion)
            return opinion

        with canary.canary_fixture() as fixture, patch.object(adapter, "SessionLocal", lambda: Session(self.engine)), patch.object(chat_persistence_service, "SessionLocal", lambda: Session(self.engine)), patch.object(state_specialist.StateSpecialist, "_run", inspect_state), redirect_stdout(StringIO()) as logs:
            fixture.context = replace(fixture.context, user_id=self.aid, conversation_id=self.ca.id, user_message_id=self.ma.id)
            fixture.mocks["begin_chat_request"].return_value = ChatPersistenceStart(context=fixture.context)
            with TestClient(__import__("main").app) as client:
                response = canary.send(client, fixture, self.ma.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(states), 1)
        self.assertTrue(any(item.evidence_ref == str(self.ma.id) for item in states[0].evidence))
        submitted = json.loads(fixture.create.call_args.kwargs["input"][1]["content"])
        self.assertEqual([item["status"] for item in submitted["behavior_observations"]], ["candidate", "candidate"])
        for identity in (self.aid, self.bid, self.ma.id, self.mb.id):
            self.assertNotIn(str(identity), json.dumps(submitted) + response.json()["reply"] + logs.getvalue())
        self.assertEqual(self.fingerprint(), before)
        self.assertEqual(fixture.saved[0]["content"], response.json()["reply"])


if __name__ == "__main__":
    unittest.main()
