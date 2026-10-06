"""provider-independent 인증 경계 검사입니다. 외부 인증/DB/OpenAI 호출은 하지 않습니다."""

import os
import unittest
from contextlib import contextmanager, redirect_stdout
from dataclasses import FrozenInstanceError
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
import main
import auth_context as auth
from chat_persistence_service import AuthenticatedOwnershipError
from schemas import ChatRequest
from evals.run_lv4_shadow_mode_tests import chat_fixture


@contextmanager
def principal_override(principal):
    """테스트에서만 trusted Principal을 주입하고 기존 dependency overrides를 보존합니다."""
    overrides = main.app.dependency_overrides
    previous = dict(overrides)
    overrides[auth.resolve_auth_principal] = lambda: principal
    try:
        yield
    finally:
        overrides.clear()
        overrides.update(previous)


class AuthPrincipalTests(unittest.TestCase):
    """OFF 호환성, ON 차단, 신원 위조 방지와 ownership 오류 매핑을 검사합니다."""

    def test_immutable_uuid_only_principal(self):
        """최소 정보만 담으며 문자열 UUID를 자동으로 신뢰하지 않습니다."""
        identity = uuid4()
        principal = auth.AuthPrincipal(identity)
        self.assertEqual(principal.user_id, identity)
        self.assertEqual(set(principal.__dataclass_fields__), {'user_id'})
        with self.assertRaises(FrozenInstanceError):
            principal.user_id = uuid4()
        with self.assertRaises(TypeError):
            auth.AuthPrincipal(str(identity))

    def test_off_values_return_none(self):
        """명시적인 OFF 값만 기존 dev 모드를 허용하며 Principal이 없습니다."""
        for value in ('false', '0', 'off', 'no', ' FALSE ', ' No '):
            with self.subTest(value=value), patch.dict(os.environ):
                os.environ.pop('NOIE_AUTH_ENABLED', None)
                if value is not None:
                    os.environ['NOIE_AUTH_ENABLED'] = value
                self.assertFalse(auth.auth_enabled())
                self.assertIsNone(auth.resolve_auth_principal())

    def test_on_values_without_verifier_are_unauthorized(self):
        """허용된 ON 값은 verifier 연결 전 자동 인증이나 fallback 없이 401입니다."""
        for value in ('1', 'true', 'yes', 'on', ' TRUE ', ' YeS ', ' ON '):
            with self.subTest(value=value), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': value}), \
                    self.assertRaises(HTTPException) as caught:
                auth.resolve_auth_principal()
            self.assertEqual(caught.exception.status_code, 401)

    def test_auth_off_chat_preserves_legacy_call(self):
        """OFF에서는 기존 두 positional 인자로 원문을 전달합니다."""
        raw = '  기존 원문 그대로  '
        with chat_fixture(enabled=False) as (context, mocks), \
                patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'false'}), redirect_stdout(StringIO()):
            response = TestClient(main.app).post('/chat', json={'text': raw, 'request_id': str(context.request_id)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reply'], '기존 production 답변')
        mocks['begin_chat_request'].assert_called_once_with(raw, context.request_id)
        mocks['complete_chat_request'].assert_called_once()

    def test_auth_on_blocks_before_persistence_and_other_work(self):
        """인증 없음은 persistence/Retrieval/분석/Agent 준비 이전에 거부합니다."""
        with chat_fixture() as (_, mocks), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}):
            response = TestClient(main.app).post('/chat', json={'text': 'private'})
        self.assertEqual(response.status_code, 401)
        for mock in mocks.values():
            mock.assert_not_called()

    def test_client_identity_and_unverified_token_cannot_bypass(self):
        """body/query/header/미검증 Bearer token은 trusted Principal을 만들지 못합니다."""
        identity = str(uuid4())
        with chat_fixture() as (_, mocks), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}):
            response = TestClient(main.app).post('/chat', params={'user_id': identity},
                json={'text': 'private', 'user_id': identity, 'authenticated_user_id': identity,
                      'principal': {'user_id': identity}},
                headers={'X-User-Id': identity, 'Authorization': 'Bearer unverified-token'})
        self.assertEqual(response.status_code, 401)
        mocks['begin_chat_request'].assert_not_called()

    def test_principals_a_and_b_reach_ownership_seam(self):
        """서로 다른 서버 Principal이 각자의 UUID를 전달하며 client UUID를 사용하지 않습니다."""
        identities = []
        for _ in range(2):
            with chat_fixture(enabled=False) as (context, mocks), \
                    patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}), \
                    principal_override(auth.AuthPrincipal(context.user_id)), redirect_stdout(StringIO()):
                response = TestClient(main.app).post('/chat', json={
                    'text': '원문', 'request_id': str(context.request_id), 'user_id': str(uuid4())})
            self.assertEqual(response.status_code, 200)
            mocks['begin_chat_request'].assert_called_once_with(
                '원문', context.request_id, authenticated_user_id=context.user_id)
            identities.append(context.user_id)
        self.assertNotEqual(*identities)

    def test_none_override_cannot_trigger_auth_on_dev_fallback(self):
        """dependency 실수로 None이 반환돼도 route의 ON 검사가 fallback을 막습니다."""
        with chat_fixture() as (_, mocks), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}), principal_override(None):
            response = TestClient(main.app).post('/chat', json={'text': 'private'})
        self.assertEqual(response.status_code, 401)
        mocks['begin_chat_request'].assert_not_called()

    def test_ownership_error_is_safe_forbidden_no_fallback(self):
        """missing/deleted/DB 오류의 상세 정보는 모두 같은 403으로 감춥니다."""
        secret = 'PRIVATE_DATABASE_ERROR ' + str(uuid4())
        with chat_fixture() as (context, mocks), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}), \
                principal_override(auth.AuthPrincipal(context.user_id)):
            mocks['begin_chat_request'].side_effect = AuthenticatedOwnershipError(secret)
            response = TestClient(main.app).post('/chat', json={'text': 'private', 'request_id': str(context.request_id)})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {'detail': '인증된 사용자로 요청을 처리할 수 없습니다.'})
        self.assertNotIn(secret, response.text)
        self.assertEqual(mocks['begin_chat_request'].call_count, 1)
        mocks['retrieve_relevant_memories_safe'].assert_not_called()
        mocks['complete_chat_request'].assert_not_called()

    def test_authenticated_cached_duplicate_no_background_rerun(self):
        """캐시 재사용은 기존처럼 Memory/Agent/Shadow를 재등록하지 않습니다."""
        with chat_fixture(enabled=False) as (_, _mocks), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'false'}), \
                redirect_stdout(StringIO()):
            cached = TestClient(main.app).post('/chat', json={'text': 'private'}).json()
        with chat_fixture(cached=cached) as (context, mocks), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}), \
                principal_override(auth.AuthPrincipal(context.user_id)), redirect_stdout(StringIO()) as output:
            response = TestClient(main.app).post('/chat', json={'text': 'private', 'request_id': str(context.request_id)})
        self.assertEqual(response.json(), cached)
        mocks['run_memory_extraction_background'].assert_not_called()
        mocks['run_chat_agent_integration'].assert_not_called()
        mocks['complete_chat_request'].assert_not_called()
        self.assertEqual(output.getvalue(), '')

    def test_schema_and_dependency_accept_no_client_identity(self):
        """인증 필드는 body에 없고 dependency도 UUID/header/query를 입력으로 받지 않습니다."""
        import inspect
        self.assertFalse({'user_id', 'authenticated_user_id', 'principal'} & set(ChatRequest.model_fields))
        # Phase 10.2에서는 Authorization만 읽고 임의 user UUID는 입력으로 받지 않습니다.
        # Request는 FastAPI 내부 객체이지 client user_id/body/query 입력이 아닙니다.
        parameters = inspect.signature(auth.resolve_auth_principal).parameters
        self.assertEqual(set(parameters), {'authorization', 'request'})
        from fastapi import Request
        self.assertIs(parameters['request'].annotation, Request)
        self.assertIsNone(parameters['request'].default)


if __name__ == '__main__':
    unittest.main()
