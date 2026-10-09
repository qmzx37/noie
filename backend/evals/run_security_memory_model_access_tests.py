"""P1-1: 실제 Memory 서비스와 합성 SQLite/Mock SDK로 전송 직전 접근 검사를 검증합니다."""

import contextlib
import io
import json
import logging
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Run with the isolated security verifier")

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

import account_lifecycle_service as lifecycle
import memory_extraction_service as extraction
import memory_extractor as extractor
import memory_reconciler as reconciler
import memory_reconciliation_service as reconciliation
from auth_context import AuthPrincipal
from evals import run_security_account_deletion_tests as fixture
from memory_schemas import MemoryExtractionDecision
from models.conversation import Conversation
from models.memory_extraction import MemoryExtraction
from models.message import Message
from private_model_access import (
    PrivateModelAccessDenied, private_model_access_scope, require_private_model_access,
)


SECRET = "password=SYNTHETIC_ONLY token=SYNTHETIC_ONLY"


class MemoryModelAccessTests(unittest.TestCase):
    """인증 경계 이후 같은 소유자만 재검사하며 외부 통신은 전부 mock으로 막습니다."""

    count = fixture.AccountDeletionTests.count

    def setUp(self):
        """커밋된 FK 활성 fixture를 재사용하며 운영 DB/환경 설정을 읽지 않습니다."""
        fixture.AccountDeletionTests.setUp(self)
        self.stack = contextlib.ExitStack()
        self.sessions = []
        sessions = self.sessions

        class ObservedSession(Session):
            """SDK 호출 시 열린 테스트 transaction이 없는지 추적합니다."""

            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                sessions.append(self)

        self.session_type = ObservedSession
        self.factory = sessionmaker(self.engine, class_=ObservedSession, expire_on_commit=False)
        for module in (extraction, reconciliation):
            self.stack.enter_context(patch.object(module, "SessionLocal", self.factory))
        self.stack.enter_context(patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-not-a-key"}))
        self.decision = MemoryExtractionDecision(should_remember=True, content="synthetic new goal",
            reason="synthetic lasting goal", kind="goal", importance=60, confidence=.9)
        self.first_result = SimpleNamespace(output_text=json.dumps(self.decision.model_dump()))
        self.second_result = SimpleNamespace(output_text=json.dumps(dict(
            action="new", matched_memory_id="", reason="synthetic distinct goal", confidence=.9)))
        self.first, self.second = Mock(), Mock()
        self.first.responses.create.side_effect = lambda **kwargs: self.sdk_result(self.first_result)
        self.second.responses.create.side_effect = lambda **kwargs: self.sdk_result(self.second_result)
        self.stack.enter_context(patch.object(extractor, "OpenAI", return_value=self.first))
        self.stack.enter_context(patch.object(reconciler, "OpenAI", return_value=self.second))
        self.logs = io.StringIO()
        self.stack.enter_context(contextlib.redirect_stdout(self.logs))
        self.stack.enter_context(contextlib.redirect_stderr(self.logs))
        handler = logging.StreamHandler(self.logs)
        logging.getLogger().addHandler(handler)
        self.stack.callback(logging.getLogger().removeHandler, handler)

    def tearDown(self):
        """합성 세션/patch만 정리하고 기존 사용자 파일이나 실제 데이터는 건드리지 않습니다."""
        self.stack.close()
        fixture.AccountDeletionTests.tearDown(self)

    def sdk_result(self, result):
        """실제 모델 호출을 대신하며 조회/lease transaction이 먼저 끝났는지 확인합니다."""
        self.assertFalse(any(db.in_transaction() for db in self.sessions))
        return result

    def post(self):
        """실제 추출 API를 통과합니다. 인증 Principal만 기존 합성 fixture가 제공합니다."""
        return self.client.post(f"/messages/{self.ma.id}/extract-memory", json={"user_id": str(self.aid)})

    def deactivate(self, *, purge=False):
        """별도 transaction에서 실제 비활성화/purge 서비스를 실행합니다."""
        with self.factory() as db:
            lifecycle.deactivate_account(db, AuthPrincipal(self.aid))
            if purge:
                lifecycle.purge_deleted_account(db, self.aid)

    def deny_response(self, response, *, first_calls=1):
        """접근 거부와 SDK 0회, 응답/로그의 합성 개인정보 비노출을 함께 확인합니다."""
        self.assertIn(response.status_code, {403, 404, 503})
        self.assertEqual(self.first.responses.create.call_count, first_calls)
        self.assertEqual(self.second.responses.create.call_count, 0)
        for value in (SECRET, self.ma.content, self.mb.content, self.memory.content,
                      str(self.aid), str(self.bid), str(self.ma.id), self.decision.content):
            self.assertNotIn(value, response.text + self.logs.getvalue())

    def fail_session_factory(self):
        """세션 생성 실패도 모델 허가로 취급하지 않습니다."""
        self.stack.enter_context(patch.object(extraction, "SessionLocal", side_effect=SQLAlchemyError(SECRET)))

    def test_active_two_models_duplicate_and_read_preserved(self):
        """정상 호출, 원문 보존, 결과 재사용과 조회를 같은 실제 저장 경로로 확인합니다."""
        before = self.count("memories")
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(self.count("memories"), before + 1)
        again = self.post()
        self.assertEqual(again.json(), response.json())
        self.assertEqual((self.first.responses.create.call_count, self.second.responses.create.call_count), (1, 1))
        detail = self.client.get(f"/memories/{response.json()['memory_id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["evidence"][0]["message"]["content"], self.ma.content)
        self.assertNotIn(self.mb.content, json.dumps(self.second.responses.create.call_args.kwargs))
        require_private_model_access()  # 요청이 끝난 뒤 scope가 다른 작업에 남지 않습니다.

    def test_deactivated_after_first_model_blocks_second(self):
        """감사 v203의 핵심: 첫 SDK 응답 후 비활성화되면 후속 전송을 하지 않습니다."""
        before = self.count("memories")

        def first(**kwargs):
            self.sdk_result(self.first_result)
            self.deactivate()
            return self.first_result

        self.first.responses.create.side_effect = first
        self.deny_response(self.post())
        self.assertEqual(self.count("memories"), before)

    def test_purged_after_first_model_blocks_second(self):
        """삭제된 원래 사용자 대신 dev-user나 다른 사용자를 선택하지 않습니다."""
        def first(**kwargs):
            self.sdk_result(self.first_result)
            self.deactivate(purge=True)
            return self.first_result

        self.first.responses.create.side_effect = first
        self.deny_response(self.post())
        self.assertEqual(self.count("memory_extractions"), 0)
        self.assertIsNotNone(self.db.get(Message, self.mb.id))

    def test_purged_after_candidate_read_blocks_second(self):
        """후보를 이미 읽었더라도 삭제 후 그 원문을 SDK에 보내지 않습니다."""
        original = extraction.find_reconciliation_candidates

        def candidates(*args):
            values = original(*args)
            self.deactivate(purge=True)
            return values

        with patch.object(extraction, "find_reconciliation_candidates", side_effect=candidates):
            self.deny_response(self.post())

    def test_deactivation_during_second_client_creation_blocks_sdk(self):
        """서비스의 앞선 검사만 신뢰하지 않고 실제 SDK 호출 지점도 검사합니다."""
        def client(**kwargs):
            self.deactivate()
            return self.second

        with patch.object(reconciler, "OpenAI", side_effect=client):
            self.deny_response(self.post())

    def test_session_creation_failure_before_first_sdk_is_closed(self):
        """lease 이후 DB 세션을 만들 수 없으면 첫 모델조차 전송하지 않습니다."""
        def client(**kwargs):
            self.fail_session_factory()
            return self.first

        with patch.object(extractor, "OpenAI", side_effect=client):
            self.deny_response(self.post(), first_calls=0)

    def test_query_failure_before_first_sdk_is_closed(self):
        """세션은 열리지만 소유권 SELECT가 실패하는 경우도 원문 전송을 차단합니다."""
        class FailedQuerySession(self.session_type):
            def execute(self, *args, **kwargs):
                raise SQLAlchemyError(SECRET)

        def client(**kwargs):
            self.stack.enter_context(patch.object(extraction, "SessionLocal",
                sessionmaker(self.engine, class_=FailedQuerySession)))
            return self.first

        with patch.object(extractor, "OpenAI", side_effect=client):
            self.deny_response(self.post(), first_calls=0)
        self.assertFalse(any(db.in_transaction() for db in self.sessions))

    def test_db_failure_after_first_model_blocks_second(self):
        """첫 모델 응답 후 계정 조회 장애가 나도 허가된 것으로 추측하지 않습니다."""
        def first(**kwargs):
            self.sdk_result(self.first_result)
            self.fail_session_factory()
            return self.first_result

        self.first.responses.create.side_effect = first
        self.deny_response(self.post())

    def test_changed_owner_never_rebinds_to_dev_user(self):
        """검사 중 source 소유자가 바뀌어도 lease의 원래 user UUID를 유지합니다."""
        def first(**kwargs):
            self.sdk_result(self.first_result)
            with self.factory() as db:
                db.get(Conversation, self.ca.id).user_id = self.bid
                db.get(Message, self.ma.id).user_id = self.bid
                db.commit()
            return self.first_result

        self.first.responses.create.side_effect = first
        with patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(self.bid)}):
            self.deny_response(self.post())

    def test_parent_denial_is_not_replaced_by_memory_scope(self):
        """중첩 Memory 검사 성공이 외부 요청의 모델 접근 거부를 덮어쓰지 않습니다."""
        denied = Mock(side_effect=RuntimeError(SECRET))
        with private_model_access_scope(denied):
            self.deny_response(self.post(), first_calls=0)
        self.assertGreater(denied.call_count, 0)
        # 거부 시 개인정보 결과를 기록하거나 lease를 임의로 완료시키지 않습니다.
        with self.factory() as db:
            state = db.scalar(select(MemoryExtraction).where(MemoryExtraction.message_id == self.ma.id))
            self.assertEqual((state.status, state.attempt_count), ("processing", 1))
            self.assertIsNotNone(state.lease_expires_at)
            self.assertIsNone(state.reason)
            self.assertIsNone(state.memory_id)
        require_private_model_access()

    def test_denied_scope_does_not_leak_to_next_user(self):
        """A의 거부된 요청이 끝난 뒤 B의 별도 정상 요청을 오염시키지 않습니다."""
        with private_model_access_scope(Mock(side_effect=RuntimeError(SECRET))):
            self.deny_response(self.post(), first_calls=0)
        self.principal = AuthPrincipal(self.bid)
        response = self.client.post(f"/messages/{self.mb.id}/extract-memory", json={"user_id": str(self.bid)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(self.first.responses.create.call_count, 1)
        self.assertNotIn(self.ma.content, json.dumps(self.first.responses.create.call_args.kwargs))

    def test_first_sdk_failure_after_deactivation_returns_no_private_result(self):
        """SDK가 결과 대신 오류를 내도 삭제된 원래 계정의 failed 결과를 반환하지 않습니다."""
        before = self.count("memories")

        def first(**kwargs):
            self.sdk_result(self.first_result)
            self.deactivate()
            raise RuntimeError(SECRET)

        self.first.responses.create.side_effect = first
        self.deny_response(self.post())
        self.assertEqual(self.count("memories"), before)

    def test_model_failure_safe_retry_preserved(self):
        """계정 거부와 일반 SDK 실패를 구분하고 기존 failed -> retry 계약을 유지합니다."""
        self.first.responses.create.side_effect = RuntimeError(SECRET)
        failed = self.post()
        self.assertEqual(failed.status_code, 200)
        self.assertEqual(failed.json()["status"], "failed")
        self.assertNotIn(SECRET, failed.text + self.logs.getvalue())
        self.first.responses.create.side_effect = lambda **kwargs: self.sdk_result(self.first_result)
        completed = self.post()
        self.assertEqual(completed.json()["status"], "completed")
        self.assertEqual(completed.json()["attempt_count"], 2)

    def test_deactivation_after_second_model_returns_no_private_result(self):
        """이미 허가된 호출의 완료 직후 삭제되면 생성 결과 저장/반환을 거부합니다."""
        before = self.count("memories")

        def second(**kwargs):
            self.sdk_result(self.second_result)
            self.deactivate()
            return self.second_result

        self.second.responses.create.side_effect = second
        response = self.post()
        self.assertIn(response.status_code, {403, 404})
        self.assertEqual(self.second.responses.create.call_count, 1)
        self.assertEqual(self.count("memories"), before)
        self.assertNotIn(self.decision.content, response.text + self.logs.getvalue())

    def test_direct_extractor_respects_model_scope(self):
        """서비스 밖에서 호출해도 활성 scope의 접근 거부를 SDK 직전에 적용합니다."""
        with private_model_access_scope(Mock(side_effect=RuntimeError(SECRET))):
            with self.assertRaises(PrivateModelAccessDenied):
                extractor.extract_memory_with_openai(self.ma.content)
        self.first.responses.create.assert_not_called()
        self.assertNotIn(SECRET, self.logs.getvalue())

    def test_direct_reconciler_respects_model_scope(self):
        """직접 조정 helper 호출도 기존 private-model 검사 경계를 우회하지 않습니다."""
        with private_model_access_scope(Mock(side_effect=RuntimeError(SECRET))):
            with self.assertRaises(PrivateModelAccessDenied):
                reconciler.reconcile_memory_candidate(self.decision,
                    [{"id": str(self.memory.id), "content": self.memory.content}])
        self.second.responses.create.assert_not_called()
        self.assertNotIn(SECRET, self.logs.getvalue())


if __name__ == "__main__":
    unittest.main()
