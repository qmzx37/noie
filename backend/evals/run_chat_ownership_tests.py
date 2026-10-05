"""인증 ownership 내부 경계 검사입니다. DB 세션은 fake이며 외부 인증/DB/OpenAI 호출은 없습니다."""

import inspect
import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
import chat_persistence_service as service
from schemas import ChatRequest
from models.user import User
from models.conversation import Conversation
from models.chat_request import ChatRequestRecord
from models.message import Message


class ChatOwnershipTests(unittest.TestCase):
    """기존 개발 경로, 인증 사용자 격리, 중복 요청 소유권을 검증합니다."""

    def setUp(self):
        self.owner, self.other, self.conversation, self.request = (uuid4() for _ in range(4))
        self.user = SimpleNamespace(id=self.owner)
        self.room = SimpleNamespace(id=self.conversation, user_id=self.owner)

    def session(self, db):
        """실제 connection 없이 서비스의 context manager 계약만 재현합니다."""
        factory = Mock()
        factory.return_value.__enter__ = Mock(return_value=db)
        factory.return_value.__exit__ = Mock(return_value=False)
        return factory

    def test_authenticated_existing_room_ignores_dev_configuration(self):
        """인증 UUID는 개발 ID/대화 설정보다 우선하며 잘못된 개발 설정도 읽지 않습니다."""
        db = Mock()
        db.scalar.side_effect = [self.user, self.room]
        with patch.dict(os.environ, {'NOIE_DEV_USER_ID': 'invalid', 'NOIE_DEV_CONVERSATION_ID': 'invalid'}), \
                patch.object(service, '_configured_uuid') as configured, patch.object(service, 'create_user') as bootstrap:
            result = service._resolve_context(db, self.owner)
        self.assertEqual((result.user_id, result.conversation_id), (self.owner, self.conversation))
        configured.assert_not_called()
        bootstrap.assert_not_called()
        statements = [call.args[0].compile() for call in db.scalar.call_args_list]
        self.assertIn(self.owner, statements[0].params.values())
        self.assertIn('users.deleted_at IS NULL', str(statements[0]))
        self.assertIn(self.owner, statements[1].params.values())
        self.assertIn('conversations.user_id =', str(statements[1]))
        self.assertIn('conversations.deleted_at IS NULL', str(statements[1]))
        self.assertIn('ORDER BY conversations.created_at DESC, conversations.id DESC', str(statements[1]))

    def test_newer_other_user_room_cannot_be_selected(self):
        """SQL 소유권 조건에 맞는 A의 대화만 반환해 B의 최신 대화를 제외합니다."""
        db = Mock()
        def scalar(statement):
            if statement.column_descriptions[0]['entity'] is User:
                return self.user
            params = statement.compile().params
            self.assertEqual(params['user_id_1'], self.owner)
            self.assertNotIn(self.other, params.values())
            return self.room
        db.scalar.side_effect = scalar
        self.assertEqual(service._resolve_context(db, self.owner).conversation_id, self.conversation)

    def test_authenticated_room_creation_owned_by_user(self):
        """활성 대화가 없으면 해당 사용자 소유 대화를 기존 생성 함수로 만듭니다."""
        db = Mock()
        db.scalar.side_effect = [self.user, None]
        with patch.object(service, 'create_conversation', return_value=self.room) as create:
            result = service._resolve_context(db, self.owner)
        self.assertEqual(create.call_args.args[1].user_id, self.owner)
        self.assertEqual(result.user_id, self.owner)

    def test_missing_or_deleted_user_no_bootstrap(self):
        """활성 사용자 필터에 걸린 missing/deleted 사용자 모두 fallback 없이 실패합니다."""
        for identity in (self.owner, self.other):
            with self.subTest(identity=identity):
                db = Mock()
                db.scalar.return_value = None
                with patch.object(service, 'create_user') as create, \
                        self.assertRaises(service.AuthenticatedOwnershipError):
                    service._resolve_context(db, identity)
                create.assert_not_called()
                self.assertEqual(db.scalar.call_count, 1)

    def test_invalid_identity_fails_before_lookup(self):
        """내부 계약도 UUID 객체만 허용하며 문자열을 인증 정보로 간주하지 않습니다."""
        db = Mock()
        with self.assertRaises(service.AuthenticatedOwnershipError):
            service._resolve_context(db, str(self.owner))
        db.scalar.assert_not_called()

    def test_legacy_configured_user_and_conversation(self):
        """None 경로는 기존 명시적 개발 사용자/대화 선택을 유지합니다."""
        for room_id in ('', str(self.conversation)):
            with self.subTest(room_id=room_id), patch.dict(os.environ, {
                    'NOIE_DEV_USER_ID': str(self.owner), 'NOIE_DEV_CONVERSATION_ID': room_id}):
                db = Mock()
                db.scalar.side_effect = [self.room, self.owner] if room_id else [self.user, self.room]
                result = service._resolve_context(db, None)
                self.assertEqual((result.user_id, result.conversation_id), (self.owner, self.conversation))

    def test_legacy_name_and_bootstrap(self):
        """개발 이름 조회와 사용자/대화 bootstrap은 기존 순서 그대로입니다."""
        with patch.dict(os.environ, {'NOIE_DEV_USER_ID': '', 'NOIE_DEV_CONVERSATION_ID': '', 'NOIE_DEV_USER_NAME': 'dev-user'}):
            db = Mock()
            db.scalar.side_effect = [None, None]
            with patch.object(service, 'create_user', return_value=self.user) as user_create, \
                    patch.object(service, 'create_conversation', return_value=self.room) as room_create:
                result = service._resolve_context(db)
            self.assertEqual(user_create.call_args.args[1].name, 'dev-user')
            self.assertEqual(room_create.call_args.args[1].user_id, self.owner)
            self.assertEqual(result.user_id, self.owner)

    def test_authenticated_begin_preserves_original_and_context(self):
        """새 request 저장은 원문 그대로 한 번 commit하며 인증 사용자 문맥을 반환합니다."""
        db = Mock()
        db.scalar.side_effect = [self.user, self.room]
        def flush():
            for call in db.add.call_args_list:
                if isinstance(call.args[0], Message):
                    call.args[0].id = uuid4()
        db.flush.side_effect = flush
        raw = '  원문\n그대로  '
        with patch.object(service, 'SessionLocal', self.session(db)):
            result = service.begin_chat_request(raw, self.request, authenticated_user_id=self.owner)
        self.assertEqual(result.context.user_id, self.owner)
        db.commit.assert_called_once()
        message = next(c.args[0] for c in db.add.call_args_list if isinstance(c.args[0], Message))
        self.assertEqual(message.content, raw)
        self.assertEqual(message.user_id, self.owner)

    def test_auth_unavailable_fails_closed_legacy_still_skips(self):
        """DB 미설정/오류는 인증 경로에서 명시 실패하며 기존 dev 응답 정책은 유지합니다."""
        with patch.object(service, 'SessionLocal', None), redirect_stdout(StringIO()):
            self.assertIsNone(service.begin_chat_request('text', self.request).context)
            with self.assertRaises(service.AuthenticatedOwnershipError):
                service.begin_chat_request('text', self.request, authenticated_user_id=self.owner)
        db = Mock()
        db.scalar.side_effect = RuntimeError('PRIVATE_DB_ERROR')
        with patch.object(service, 'SessionLocal', self.session(db)), redirect_stdout(StringIO()):
            self.assertIsNone(service.begin_chat_request('text', self.request).context)
            with self.assertRaises(service.AuthenticatedOwnershipError) as caught:
                service.begin_chat_request('text', self.request, authenticated_user_id=self.owner)
        self.assertNotIn('PRIVATE_DB_ERROR', str(caught.exception))

    def duplicate_db(self, owner, status='completed', content='text'):
        """중복 요청 레코드와 소유권 쿼리 결과를 fake로 제공합니다."""
        db = Mock()
        db.get.return_value = ChatRequestRecord(request_id=self.request, conversation_id=self.conversation,
            request_hash=service._request_hash(content), status=status, response={'reply': 'cached'}, user_message_id=uuid4())
        db.scalar.return_value = owner
        return db

    def test_authenticated_duplicate_same_owner_reuses_result(self):
        """같은 사용자만 캐시를 받으며 반환 context에도 인증 UUID가 들어갑니다."""
        db = self.duplicate_db(self.owner)
        with patch.object(service, 'SessionLocal', self.session(db)):
            result = service._wait_for_existing_request(self.request, service._request_hash('text'),
                                                       authenticated_user_id=self.owner)
        self.assertEqual(result.cached_response, {'reply': 'cached'})
        self.assertEqual(result.context.user_id, self.owner)
        sql = db.scalar.call_args.args[0].compile()
        self.assertIn(self.owner, sql.params.values())
        self.assertIn('users.deleted_at IS NULL', str(sql))
        self.assertIn('conversations.deleted_at IS NULL', str(sql))

    def test_duplicate_other_owner_or_deleted_never_returns_cache(self):
        """소유권 오류는 completed/processing/failed와 본문 hash 검사보다 먼저 차단합니다."""
        for owner in (self.other, None):
            for status in ('completed', 'processing', 'failed'):
                with self.subTest(owner=owner, status=status):
                    db = self.duplicate_db(owner, status)
                    with patch.object(service, 'SessionLocal', self.session(db)), \
                            self.assertRaises(service.AuthenticatedOwnershipError):
                        service._wait_for_existing_request(self.request, 'different-hash', authenticated_user_id=self.owner)

    def test_integrity_race_checks_duplicate_ownership(self):
        """PK 충돌 후 rollback하고 소유권 확인을 거쳐 다른 사용자 캐시를 차단합니다."""
        db = Mock()
        db.scalar.side_effect = [self.user, self.room]
        db.flush.side_effect = IntegrityError('synthetic', {}, Exception())
        duplicate = self.duplicate_db(self.other)
        factory = Mock(side_effect=[self.session(db)(), self.session(duplicate)()])
        with patch.object(service, 'SessionLocal', factory), self.assertRaises(service.AuthenticatedOwnershipError):
            service.begin_chat_request('text', self.request, authenticated_user_id=self.owner)
        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    def test_legacy_duplicate_and_hash_conflict(self):
        """기존 캐시 재사용과 request UUID의 서로 다른 본문 충돌 정책을 유지합니다."""
        db = self.duplicate_db(None)
        with patch.object(service, 'SessionLocal', self.session(db)):
            result = service._wait_for_existing_request(self.request, service._request_hash('text'))
            self.assertIsNone(result.context.user_id)
            self.assertEqual(result.cached_response, {'reply': 'cached'})
            with self.assertRaises(service.RequestIdConflictError):
                service._wait_for_existing_request(self.request, 'different-hash')
        db.scalar.assert_not_called()

    def test_processing_timeout_and_failed_idempotency(self):
        """processing 대기는 기존 timeout, failed는 기존 conflict를 유지합니다."""
        db = self.duplicate_db(self.owner, 'processing')
        with patch.object(service, 'SessionLocal', self.session(db)), \
                patch.object(service.time, 'monotonic', side_effect=[0, 0, 61]), patch.object(service.time, 'sleep'), \
                self.assertRaises(service.RequestStillProcessingError):
            service._wait_for_existing_request(self.request, service._request_hash('text'), authenticated_user_id=self.owner)
        db.get.return_value.status = 'failed'
        with patch.object(service, 'SessionLocal', self.session(db)), self.assertRaises(service.RequestIdConflictError):
            service._wait_for_existing_request(self.request, service._request_hash('text'), authenticated_user_id=self.owner)

    def test_keyword_only_seam_and_no_body_user_id(self):
        """신뢰 경계는 내부 keyword-only 인자이며 request body에 사용자 ID를 추가하지 않습니다."""
        parameter = inspect.signature(service.begin_chat_request).parameters['authenticated_user_id']
        self.assertEqual(parameter.kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIsNone(parameter.default)
        self.assertNotIn('user_id', ChatRequest.model_fields)


if __name__ == '__main__':
    unittest.main()
