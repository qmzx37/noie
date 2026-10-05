"""로컬 JWT 서명/합성 JWKS와 fake 세션 검사입니다. Supabase/DB/OpenAI 요청은 없습니다."""

import json
import os
import time
import unittest
from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from supabase import ClientOptions, create_client
import main
import auth_context as auth
import auth_identity_service as mapping
import supabase_auth_verifier as verifier
from models.auth_identity import AuthIdentity
from evals.run_lv4_shadow_mode_tests import chat_fixture

URL = 'https://synthetic-project.supabase.co'
CONFIG = {'SUPABASE_URL': URL, 'SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_synthetic_test'}


class SupabaseVerifierTests(unittest.TestCase):
    """실제 SDK의 서명 검증과 NOIE 추가 claims 정책을 외부 요청 없이 검증합니다."""

    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key()))
        jwk.update(kid='synthetic-key', alg='RS256', use='sig')
        cls.jwks = {'keys': [jwk]}

    def setUp(self):
        self.subject = str(uuid4())
        self.claims = {'sub': self.subject, 'exp': int(time.time()) + 600, 'iat': int(time.time()),
                       'iss': URL + '/auth/v1', 'aud': 'authenticated', 'role': 'authenticated',
                       'is_anonymous': False, 'email': 'private@example.invalid'}

    def token(self, claims=None, key=None):
        """합성 claims에 로컬 키로만 서명합니다."""
        return jwt.encode(self.claims if claims is None else claims, key or self.key,
                          algorithm='RS256', headers={'kid': 'synthetic-key'})

    def verify(self, token):
        """SDK get_claims에 로컬 JWKS를 전달하고 모든 HTTP send를 금지합니다."""
        with httpx.Client() as transport:
            client = create_client(URL, CONFIG['SUPABASE_PUBLISHABLE_KEY'], options=ClientOptions(
                auto_refresh_token=False, persist_session=False, httpx_client=transport))
            original = client.auth.get_claims
            with patch.object(client.auth, 'get_claims', side_effect=lambda token: original(token, jwks=self.jwks)), \
                    patch('supabase.create_client', return_value=client), patch.dict(os.environ, CONFIG), \
                    patch.object(httpx.Client, 'send', side_effect=AssertionError('NO_NETWORK')) as network:
                result = verifier.verify_supabase_token(token)
                network.assert_not_called()
                return result

    def test_real_sdk_signature_verified_subject_only(self):
        identity = self.verify(self.token())
        self.assertEqual(identity, auth.VerifiedAuthIdentity('supabase', self.subject))
        self.assertEqual(set(identity.__dataclass_fields__), {'provider', 'subject'})

    def test_invalid_signature_and_expired_token(self):
        tokens = [self.token(key=self.other_key), self.token({**self.claims, 'exp': int(time.time()) - 60}),
                  'not.a.valid.jwt']
        for token in tokens:
            with self.subTest(token_kind=len(token)), self.assertRaises(verifier.TokenVerificationError):
                self.verify(token)

    def test_claims_policy_fail_closed(self):
        changes = [{'iss': 'https://other.supabase.co/auth/v1'}, {'aud': 'anon'}, {'role': 'service_role'},
                   {'is_anonymous': True}, {'is_anonymous': None}, {'sub': None}, {'sub': 'not-uuid'},
                   {'sub': str(uuid4()).replace('-', '')}, {'sub': str(__import__('uuid').UUID(int=0))},
                   {'exp': None}, {'exp': True}, {'nbf': int(time.time()) + 100}, {'nbf': True}]
        for change in changes:
            with self.subTest(field=next(iter(change))), self.assertRaises(verifier.TokenVerificationError):
                self.verify(self.token({**self.claims, **change}))

    def test_audience_array_and_canonical_subject(self):
        result = self.verify(self.token({**self.claims, 'aud': ['authenticated'], 'sub': self.subject.upper()}))
        self.assertEqual(result.subject, self.subject)

    def test_unsafe_or_missing_configuration_no_sdk_call(self):
        changes = [{'SUPABASE_URL': ''}, {'SUPABASE_URL': 'http://localhost'},
                   {'SUPABASE_URL': URL + '/auth/v1'}, {'SUPABASE_PUBLISHABLE_KEY': ''},
                   {'SUPABASE_PUBLISHABLE_KEY': 'sb_secret_not_allowed'}]
        for change in changes:
            with self.subTest(field=next(iter(change))), patch.dict(os.environ, {**CONFIG, **change}), \
                    patch('supabase.create_client') as client, self.assertRaises(verifier.TokenVerificationError):
                verifier.verify_supabase_token('private-token')
            client.assert_not_called()

    def test_sdk_exception_not_logged_or_exposed(self):
        client = Mock()
        client.auth.get_claims.side_effect = RuntimeError('PRIVATE_TOKEN_EMAIL_CLAIMS')
        with patch.dict(os.environ, CONFIG), patch('supabase.create_client', return_value=client), \
                redirect_stdout(StringIO()) as output, self.assertRaises(verifier.TokenVerificationError) as caught:
            verifier.verify_supabase_token('PRIVATE_TOKEN')
        self.assertEqual(str(caught.exception), '')
        self.assertEqual(output.getvalue(), '')


class IdentityMappingTests(unittest.TestCase):
    """기존 local user만 read-only로 선택하고 email이나 자동 생성은 사용하지 않습니다."""

    def factory(self, db):
        factory = Mock()
        factory.return_value.__enter__ = Mock(return_value=db)
        factory.return_value.__exit__ = Mock(return_value=False)
        return factory

    def test_subjects_map_to_distinct_local_users_not_subject_uuid(self):
        owners = []
        for _ in range(2):
            subject, local = uuid4(), uuid4()
            db = Mock()
            db.scalar.side_effect = [SimpleNamespace(user_id=local), local]
            with patch.object(mapping, 'SessionLocal', self.factory(db)):
                principal = mapping.resolve_identity_principal(auth.VerifiedAuthIdentity('supabase', str(subject)))
            self.assertEqual(principal.user_id, local)
            self.assertNotEqual(principal.user_id, subject)
            sql = db.scalar.call_args_list[0].args[0].compile()
            self.assertEqual(set(sql.params.values()), {'supabase', str(subject)})
            self.assertIn('users.deleted_at IS NULL', str(db.scalar.call_args_list[1].args[0]))
            db.add.assert_not_called()
            db.commit.assert_not_called()
            owners.append(local)
        self.assertNotEqual(*owners)

    def test_unmapped_identity_fail_closed(self):
        db = Mock()
        db.scalar.return_value = None
        with patch.object(mapping, 'SessionLocal', self.factory(db)), self.assertRaises(mapping.IdentityMappingError) as caught:
            mapping.resolve_identity_principal(auth.VerifiedAuthIdentity('supabase', str(uuid4())))
        self.assertEqual(caught.exception.code, 'UNMAPPED_AUTH_IDENTITY')
        db.add.assert_not_called()
        self.assertEqual(db.scalar.call_count, 1)

    def test_deleted_or_missing_local_user_fail_closed(self):
        db = Mock()
        db.scalar.side_effect = [SimpleNamespace(user_id=uuid4()), None]
        with patch.object(mapping, 'SessionLocal', self.factory(db)), self.assertRaises(mapping.IdentityMappingError) as caught:
            mapping.resolve_identity_principal(auth.VerifiedAuthIdentity('supabase', str(uuid4())))
        self.assertEqual(caught.exception.code, 'INACTIVE_AUTH_USER')
        db.add.assert_not_called()

    def test_db_failure_no_detail_no_fallback(self):
        identity = auth.VerifiedAuthIdentity('supabase', str(uuid4()))
        with patch.object(mapping, 'SessionLocal', None), self.assertRaises(mapping.IdentityMappingError):
            mapping.resolve_identity_principal(identity)
        db = Mock()
        db.scalar.side_effect = RuntimeError('PRIVATE_DATABASE_URL')
        with patch.object(mapping, 'SessionLocal', self.factory(db)), self.assertRaises(mapping.IdentityMappingError) as caught:
            mapping.resolve_identity_principal(identity)
        self.assertNotIn('PRIVATE_DATABASE_URL', str(caught.exception))

    def test_model_constraints_and_no_email(self):
        from sqlalchemy import UniqueConstraint
        table = AuthIdentity.__table__
        self.assertEqual(set(table.columns.keys()), {'id', 'user_id', 'provider', 'subject', 'created_at'})
        unique = {tuple(c.columns.keys()) for c in table.constraints if isinstance(c, UniqueConstraint)}
        self.assertEqual(unique, {('provider', 'subject'), ('user_id', 'provider')})
        self.assertEqual(next(iter(table.c.user_id.foreign_keys)).ondelete, 'RESTRICT')
        self.assertTrue(table.c.created_at.type.timezone)


class SupabaseDependencyTests(unittest.TestCase):
    """Header -> verifier -> mapping -> /chat 경계를 fake로 연결합니다."""

    def test_malformed_bearer_never_verifies_or_maps(self):
        for header in (None, '', 'Basic token', 'Bearer', 'Bearer ', 'Bearer token extra'):
            with self.subTest(header=header), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}), \
                    patch.object(verifier, 'verify_supabase_token') as verify, \
                    patch.object(mapping, 'resolve_identity_principal') as resolve, chat_fixture() as (_, mocks):
                response = TestClient(main.app).post('/chat', json={'text': 'private'},
                    headers={} if header is None else {'Authorization': header})
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers['www-authenticate'], 'Bearer')
            verify.assert_not_called()
            resolve.assert_not_called()
            mocks['begin_chat_request'].assert_not_called()

    def test_invalid_verified_token_returns_safe_401(self):
        with patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}), \
                patch.object(verifier, 'verify_supabase_token', side_effect=verifier.TokenVerificationError('PRIVATE_TOKEN')):
            response = TestClient(main.app).post('/chat', json={'text': 'private'}, headers={'Authorization': 'Bearer PRIVATE_TOKEN'})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('PRIVATE_TOKEN', response.text)

    def test_mapping_errors_safe_403(self):
        identity = auth.VerifiedAuthIdentity('supabase', str(uuid4()))
        for code in ('UNMAPPED_AUTH_IDENTITY', 'INACTIVE_AUTH_USER', 'AUTH_DATABASE_UNAVAILABLE'):
            with self.subTest(code=code), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}), \
                    patch.object(verifier, 'verify_supabase_token', return_value=identity), \
                    patch.object(mapping, 'resolve_identity_principal', side_effect=mapping.IdentityMappingError(code)), \
                    chat_fixture() as (_, mocks):
                response = TestClient(main.app).post('/chat', json={'text': 'private'}, headers={'Authorization': 'Bearer synthetic'})
            self.assertEqual(response.status_code, 403)
            self.assertNotIn(code, response.text)
            mocks['begin_chat_request'].assert_not_called()

    def test_verified_subject_only_reaches_local_ownership_seam(self):
        for _ in range(2):
            with chat_fixture(enabled=False) as (context, mocks), patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'}):
                identity = auth.VerifiedAuthIdentity('supabase', str(uuid4()))
                with patch.object(verifier, 'verify_supabase_token', return_value=identity) as verify, \
                        patch.object(mapping, 'resolve_identity_principal', return_value=auth.AuthPrincipal(context.user_id)) as resolve, \
                        redirect_stdout(StringIO()) as output:
                    response = TestClient(main.app).post('/chat', params={'user_id': str(uuid4())},
                        json={'text': 'private', 'request_id': str(context.request_id), 'user_id': str(uuid4())},
                        headers={'Authorization': 'bEaReR PRIVATE_TOKEN', 'X-User-Id': str(uuid4())})
                self.assertEqual(response.status_code, 200)
                verify.assert_called_once_with('PRIVATE_TOKEN')
                resolve.assert_called_once_with(identity)
                mocks['begin_chat_request'].assert_called_once_with('private', context.request_id,
                    authenticated_user_id=context.user_id)
                self.assertNotIn('PRIVATE_TOKEN', output.getvalue())

    def test_auth_off_does_not_verify_or_map(self):
        with patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'false'}), \
                patch.object(verifier, 'verify_supabase_token') as verify, \
                patch.object(mapping, 'resolve_identity_principal') as resolve:
            self.assertIsNone(auth.resolve_auth_principal('Bearer PRIVATE_TOKEN'))
        verify.assert_not_called()
        resolve.assert_not_called()


if __name__ == '__main__':
    unittest.main()
