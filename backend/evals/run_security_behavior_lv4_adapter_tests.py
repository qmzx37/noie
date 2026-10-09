"""Behavior read adapter의 실제 ORM 소유권과 세션 lifecycle을 합성 SQLite로 검사합니다."""

from contextlib import contextmanager, redirect_stdout, redirect_stderr
from dataclasses import replace
from datetime import datetime, timezone
from io import StringIO
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from agent.behavior_specialist import BehaviorSpecialist
from agent.lv4 import behavior_adapter as adapter
from agent.lv4.state_context import StateContext
from agent.lv4.state_specialist import StateSpecialist
from chat_persistence_service import ChatPersistenceStart
import chat_persistence_service
from database import Base
import lv4_production_service as production
from models.message import Message
from private_model_access import private_model_access_scope
from evals import run_security_account_deletion_tests as fixtures
from evals import run_lv4_production_local_canary_tests as canary


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

    # 실제 비밀이 아닌 표식으로 예외 원문이 출력/응답에 섞이는지 검사합니다.
    FAILURE_SECRET = "password=BEHAVIOR_FAKE_PASSWORD token=BEHAVIOR_FAKE_TOKEN"

    def assert_failure_private(self, logs, response=None):
        """고정 운영 로그는 허용하되 합성 비밀과 내부 ID의 반사는 허용하지 않습니다."""
        output = logs.getvalue() + (response.text if response is not None else "")
        for private in (self.FAILURE_SECRET, "BEHAVIOR_FAKE_PASSWORD", "BEHAVIOR_FAKE_TOKEN",
                        str(self.aid), str(self.bid), str(self.ma.id), str(self.mb.id)):
            self.assertNotIn(private, output)

    def invalid_analysis(self):
        """분석기 결함을 모사합니다. production의 실제 Pydantic 재검증은 우회하지 않습니다."""
        return SimpleNamespace(model_dump=lambda: {
            "source_message_id": self.ma.id, "reason": "recognized",
            "behaviors": [{"action": "운동", "status": self.FAILURE_SECRET, "evidence": {}}],
        })

    def test_session_creation_failure_returns_empty_without_leak(self):
        """세션을 만들기도 전에 실패해도 분석/조회 없이 무로그 빈 context를 반환합니다."""
        before = self.fingerprint()
        with patch.object(adapter, "SessionLocal", side_effect=RuntimeError(self.FAILURE_SECRET)) as factory, \
                patch.object(adapter, "analyze_owned_behavior") as analyze, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), self.assertNoLogs(level="DEBUG"):
            result = adapter.read_behavior(user_id=self.aid, message_id=self.ma.id, current_utterance=self.ma.content)
        self.assertEqual(result, [])
        factory.assert_called_once_with()
        analyze.assert_not_called()
        self.assertEqual(logs.getvalue(), "")
        self.assert_failure_private(logs)
        self.assertEqual(self.fingerprint(), before)

    def test_query_failure_rolls_back_closes_session_and_returns_empty(self):
        """실제 service의 SQL 오류 처리와 adapter의 fallback을 함께 통과시킵니다."""
        before = self.fingerprint()
        sessions, closed, queries, rollbacks = [], [], [], []

        @contextmanager
        def factory():
            """합성 SQLite 세션의 조회만 실패시키고 종료/rollback을 관찰합니다."""
            db = Session(self.engine)
            sessions.append(db)
            try:
                with patch.object(db, "scalar", side_effect=SQLAlchemyError(self.FAILURE_SECRET)) as query, \
                        patch.object(db, "rollback", wraps=db.rollback) as rollback:
                    queries.append(query)
                    rollbacks.append(rollback)
                    yield db
            finally:
                db.close()
                closed.append(db)

        with patch.object(adapter, "SessionLocal", factory), patch.object(BehaviorSpecialist, "analyze") as analyze, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), self.assertNoLogs(level="DEBUG"):
            result = adapter.read_behavior(user_id=self.aid, message_id=self.ma.id, current_utterance=self.ma.content)
        self.assertEqual(result, [])
        self.assertEqual(len(sessions), 1)
        self.assertEqual(closed, sessions)
        queries[0].assert_called_once()
        rollbacks[0].assert_called_once_with()
        analyze.assert_not_called()
        self.assertFalse(sessions[0].in_transaction())
        self.assertEqual(logs.getvalue(), "")
        self.assert_failure_private(logs)
        self.assertEqual(self.fingerprint(), before)

    def test_unexpected_analysis_error_returns_empty_without_leak(self):
        """소유권 조회는 실제로 수행하고 그 뒤 분석기 프로그래밍 오류를 주입합니다."""
        before = self.fingerprint()
        with patch.object(BehaviorSpecialist, "analyze", side_effect=RuntimeError(self.FAILURE_SECRET)) as analyze, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), self.assertNoLogs(level="DEBUG"):
            self.assertEqual(self.read(), [])
        analyze.assert_called_once()
        self.assertEqual(analyze.call_args.args[0].source_message_id, self.ma.id)
        self.assertEqual(logs.getvalue(), "")
        self.assert_failure_private(logs)
        self.assertEqual(self.fingerprint(), before)

    def test_invalid_analysis_is_revalidated_and_omitted(self):
        """잘못된 status의 input을 가진 ValidationError도 빈 context로만 처리합니다."""
        before = self.fingerprint()
        with patch.object(BehaviorSpecialist, "analyze", return_value=self.invalid_analysis()) as analyze, \
                patch.object(adapter, "project_behavior", wraps=adapter.project_behavior) as project, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), self.assertNoLogs(level="DEBUG"):
            self.assertEqual(self.read(), [])
        analyze.assert_called_once()
        project.assert_called_once()
        self.assertEqual(logs.getvalue(), "")
        self.assert_failure_private(logs)
        self.assertEqual(self.fingerprint(), before)

    def test_session_exit_failure_returns_empty_after_closing(self):
        """분석이 끝나도 세션 종료 경계가 실패하면 부분 결과를 사용하지 않습니다."""
        before = self.fingerprint()
        closed = []

        @contextmanager
        def factory():
            """실제 합성 세션은 먼저 닫고 종료 시 예외만 모사합니다."""
            with Session(self.engine) as db:
                yield db
            closed.append(db)
            raise RuntimeError(self.FAILURE_SECRET)

        with patch.object(adapter, "SessionLocal", factory), \
                patch.object(BehaviorSpecialist, "analyze", wraps=BehaviorSpecialist().analyze) as analyze, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), self.assertNoLogs(level="DEBUG"):
            result = adapter.read_behavior(user_id=self.aid, message_id=self.ma.id, current_utterance=self.ma.content)
        self.assertEqual(result, [])
        analyze.assert_called_once()
        self.assertEqual(len(closed), 1)
        self.assertFalse(closed[0].in_transaction())
        self.assertEqual(logs.getvalue(), "")
        self.assert_failure_private(logs)
        self.assertEqual(self.fingerprint(), before)

    def test_chat_real_adapter_session_failure_preserves_lv4_reply(self):
        """read_behavior 자체는 mock하지 않고 세션 생성 오류 뒤 실제 Lv4/HTTP 경로를 실행합니다."""
        before = self.fingerprint()
        with canary.canary_fixture() as fixture, \
                patch.object(chat_persistence_service, "SessionLocal", lambda: Session(self.engine)), \
                patch.object(adapter, "SessionLocal", side_effect=RuntimeError(self.FAILURE_SECRET)) as factory, \
                patch.object(production, "read_behavior", wraps=adapter.read_behavior) as read, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), TestClient(__import__("main").app) as client:
            fixture.context = replace(fixture.context, user_id=self.aid, conversation_id=self.ca.id, user_message_id=self.ma.id)
            fixture.mocks["begin_chat_request"].return_value = ChatPersistenceStart(context=fixture.context)
            response = canary.send(client, fixture, self.ma.content)
        self.assertEqual(response.status_code, 200)
        self.assertIn(canary.CHOICE, response.json()["reply"])
        read.assert_called_once()
        factory.assert_called_once_with()
        fixture.create.assert_called_once()
        submitted = json.loads(fixture.create.call_args.kwargs["input"][1]["content"])
        self.assertNotIn("behavior_observations", submitted)
        self.assertNotIn(self.FAILURE_SECRET, json.dumps(submitted))
        self.assertEqual(len(fixture.saved), 1)
        self.assertEqual(fixture.saved[0]["content"], response.json()["reply"])
        self.assertEqual(fixture.saved[0]["source"], "lv4")
        self.assert_failure_private(logs, response)
        self.assertEqual(self.fingerprint(), before)

    def test_chat_invalid_analysis_preserves_lv4_without_private_behavior(self):
        """실제 소유자 조회 뒤 손상된 분석을 제외해도 정상 추천/저장 계약은 유지됩니다."""
        before = self.fingerprint()
        with canary.canary_fixture() as fixture, patch.object(adapter, "SessionLocal", lambda: Session(self.engine)), \
                patch.object(chat_persistence_service, "SessionLocal", lambda: Session(self.engine)), \
                patch.object(BehaviorSpecialist, "analyze", return_value=self.invalid_analysis()) as analyze, \
                patch.object(production, "read_behavior", wraps=adapter.read_behavior) as read, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), TestClient(__import__("main").app) as client:
            fixture.context = replace(fixture.context, user_id=self.aid, conversation_id=self.ca.id, user_message_id=self.ma.id)
            fixture.mocks["begin_chat_request"].return_value = ChatPersistenceStart(context=fixture.context)
            response = canary.send(client, fixture, self.ma.content)
        self.assertEqual(response.status_code, 200)
        self.assertIn(canary.CHOICE, response.json()["reply"])
        read.assert_called_once()
        analyze.assert_called_once()
        fixture.create.assert_called_once()
        submitted = json.loads(fixture.create.call_args.kwargs["input"][1]["content"])
        self.assertNotIn("behavior_observations", submitted)
        self.assertNotIn(self.FAILURE_SECRET, json.dumps(submitted))
        self.assertEqual(fixture.saved[0]["content"], response.json()["reply"])
        self.assert_failure_private(logs, response)
        self.assertEqual(self.fingerprint(), before)

    def test_chat_deactivation_during_behavior_failure_denies_model_and_reply(self):
        """optional 실패와 동시에 비활성화되면 실제 계정 재검사를 통해 403이어야 합니다."""
        def failing_factory():
            """운영 DB가 아닌 fixture 계정만 비활성화하고 Behavior 세션 실패를 모사합니다."""
            self.a.deleted_at = datetime.now(timezone.utc)
            self.db.commit()
            raise RuntimeError(self.FAILURE_SECRET)

        with canary.canary_fixture() as fixture, \
                patch.object(chat_persistence_service, "SessionLocal", lambda: Session(self.engine)), \
                patch.object(adapter, "SessionLocal", side_effect=failing_factory) as factory, \
                patch.object(production, "read_behavior", wraps=adapter.read_behavior) as read, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), TestClient(__import__("main").app) as client:
            fixture.context = replace(fixture.context, user_id=self.aid, conversation_id=self.ca.id, user_message_id=self.ma.id)
            fixture.mocks["begin_chat_request"].return_value = ChatPersistenceStart(context=fixture.context)
            fixture.owner.side_effect = chat_persistence_service.require_active_chat_user
            response = canary.send(client, fixture, self.ma.content)
        self.assertEqual(response.status_code, 403)
        read.assert_called_once()
        factory.assert_called_once_with()
        # 상위/내부 어느 경계가 먼저 거부해도 최초 소유자 확인과 모델 미호출이 계약입니다.
        fixture.owner.assert_called_with(self.aid)
        self.assertIsNotNone(self.a.deleted_at)
        fixture.create.assert_not_called()
        fixture.mocks["complete_chat_request"].assert_not_called()
        self.assertEqual(fixture.saved, [])
        self.assert_failure_private(logs, response)

    def test_chat_private_access_denial_is_not_behavior_fallback(self):
        """계정이 활성이어도 상위 모델 접근 거부를 optional 빈 결과로 우회하지 못합니다."""
        before = self.fingerprint()
        allowed = True
        checks = []

        def access_check():
            """실제 private access scope를 사용하며 SDK 대신 권한 callback만 합성입니다."""
            checks.append(allowed)
            if not allowed:
                raise PermissionError(self.FAILURE_SECRET)

        def failing_factory():
            """처음 권한 검사는 통과시키고 Behavior 조회 시점부터 모델 접근을 거부합니다."""
            nonlocal allowed
            allowed = False
            raise RuntimeError(self.FAILURE_SECRET)

        with canary.canary_fixture() as fixture, private_model_access_scope(access_check), \
                patch.object(chat_persistence_service, "SessionLocal", lambda: Session(self.engine)), \
                patch.object(adapter, "SessionLocal", side_effect=failing_factory) as factory, \
                patch.object(production, "read_behavior", wraps=adapter.read_behavior) as read, \
                redirect_stdout(StringIO()) as logs, redirect_stderr(logs), TestClient(__import__("main").app) as client:
            fixture.context = replace(fixture.context, user_id=self.aid, conversation_id=self.ca.id, user_message_id=self.ma.id)
            fixture.mocks["begin_chat_request"].return_value = ChatPersistenceStart(context=fixture.context)
            response = canary.send(client, fixture, self.ma.content)
        self.assertEqual(response.status_code, 403)
        self.assertIn(True, checks)
        self.assertIn(False, checks)
        read.assert_called_once()
        factory.assert_called_once_with()
        fixture.create.assert_not_called()
        fixture.mocks["complete_chat_request"].assert_not_called()
        self.assertEqual(fixture.saved, [])
        self.assert_failure_private(logs, response)
        self.assertEqual(self.fingerprint(), before)


if __name__ == "__main__":
    unittest.main()
