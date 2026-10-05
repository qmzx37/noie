"""Bootstrap의 실제 ORM/UNIQUE 동작을 로컬 SQLite와 fake verifier로 검사합니다."""

import os
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import JSON, DefaultClause, MetaData, create_engine, func, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import main
import auth_bootstrap_router as router
import auth_bootstrap_service as service
import auth_context as auth
from auth_identity_service import IdentityMappingError
from database import get_db
from models.auth_identity import AuthIdentity
from models.user import User
from supabase_auth_verifier import TokenVerificationError


class AuthBootstrapTests(unittest.TestCase):
    """외부 연결 없이 새 계정/기존 연결/rollback과 일반 API fail-closed를 검증합니다."""

    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        schema = MetaData()
        for model in (User, AuthIdentity):
            table = model.__table__.to_metadata(schema)
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
                    column.server_default = None
                elif column.server_default is not None and 'gen_random_uuid' in str(column.server_default.arg):
                    column.server_default = None
                elif column.server_default is not None and str(column.server_default.arg) == 'now()':
                    column.server_default = DefaultClause(text('CURRENT_TIMESTAMP'))
        schema.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.identity = auth.VerifiedAuthIdentity('supabase', str(uuid4()))
        self.old_overrides = dict(main.app.dependency_overrides)
        main.app.dependency_overrides.clear()
        def db_override():
            yield self.db
        main.app.dependency_overrides[get_db] = db_override
        self.client = TestClient(main.app)
        self.env = patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'true'})
        self.env.start()
        self.verifier = patch.object(router, 'verify_supabase_token', return_value=self.identity)
        self.verify = self.verifier.start()

    def tearDown(self):
        self.verifier.stop()
        self.env.stop()
        self.client.close()
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(self.old_overrides)
        self.db.close()
        self.engine.dispose()

    def counts(self):
        """mapping만 아니라 User도 세어 경쟁 패자가 고아 계정을 남기지 않는지 확인합니다."""
        return tuple(self.db.scalar(select(func.count()).select_from(model)) for model in (User, AuthIdentity))

    def bootstrap(self, **kwargs):
        return self.client.post('/auth/bootstrap', headers={'Authorization': 'Bearer private-token'}, **kwargs)

    def test_no_token_always_401_including_auth_off(self):
        for value in ('false', 'true'):
            os.environ['NOIE_AUTH_ENABLED'] = value
            response = self.client.post('/auth/bootstrap')
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers['www-authenticate'], 'Bearer')
        self.verify.assert_not_called()
        self.assertEqual(self.counts(), (0, 0))

    def test_invalid_token_never_writes_or_leaks(self):
        self.verify.side_effect = TokenVerificationError('PRIVATE_CLAIMS')
        response = self.bootstrap()
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('PRIVATE', response.text)
        self.assertEqual(self.counts(), (0, 0))

    def test_new_subject_and_repeat_status_only(self):
        self.assertEqual(self.bootstrap().json(), {'status': 'ready'})
        mapping = self.db.scalar(select(AuthIdentity))
        owner = mapping.user_id
        self.assertNotEqual(str(owner), self.identity.subject)
        self.assertEqual(self.counts(), (1, 1))
        response = self.bootstrap(json={'user_id': str(uuid4()), 'email': 'private@example.test'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ready'})
        self.assertNotIn(self.identity.subject, response.text)
        self.assertEqual(self.db.scalar(select(AuthIdentity)).user_id, owner)
        self.assertEqual(self.counts(), (1, 1))

    def test_existing_manual_link_reused_without_changes(self):
        owner = User(name='dev-user', metadata_={'untouched': True})
        self.db.add(owner)
        self.db.flush()
        mapping = AuthIdentity(user_id=owner.id, provider='supabase', subject=self.identity.subject)
        self.db.add(mapping)
        self.db.commit()
        original = mapping.id
        self.assertEqual(self.bootstrap().status_code, 200)
        self.assertEqual(self.counts(), (1, 1))
        self.assertEqual(self.db.scalar(select(AuthIdentity)).id, original)
        self.assertEqual(owner.name, 'dev-user')
        self.assertEqual(owner.metadata_, {'untouched': True})

    def test_deleted_mapping_fails_without_replacement(self):
        owner_id = service.bootstrap_auth_identity(self.db, self.identity)
        self.db.get(User, owner_id).deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        response = self.bootstrap()
        self.assertEqual(response.status_code, 403)
        self.assertNotIn(str(owner_id), response.text)
        self.assertEqual(self.counts(), (1, 1))

    def test_invalid_verified_identity_rejected(self):
        for identity in (None, auth.VerifiedAuthIdentity('google', self.identity.subject),
                         auth.VerifiedAuthIdentity('supabase', 'bad'),
                         auth.VerifiedAuthIdentity('supabase', self.identity.subject.upper()),
                         auth.VerifiedAuthIdentity('supabase', '00000000-0000-0000-0000-000000000000')):
            with self.subTest(identity=type(identity).__name__), self.assertRaises(service.BootstrapError):
                service.bootstrap_auth_identity(self.db, identity)
        self.assertEqual(self.counts(), (0, 0))

    def test_unique_race_rolls_back_loser_user_and_reuses_winner(self):
        """최초 조회가 stale한 상황을 재현하고 실제 UNIQUE 위반/전체 rollback을 확인합니다."""
        winner = service.bootstrap_auth_identity(self.db, self.identity)
        with patch.object(service, '_existing_active_user', side_effect=[None, winner]):
            result = service.bootstrap_auth_identity(self.db, self.identity)
        self.assertEqual(result, winner)
        self.assertEqual(self.counts(), (1, 1))

    def test_commit_failure_rolls_back_both_rows_safe_503(self):
        with patch.object(self.db, 'commit', side_effect=SQLAlchemyError('PRIVATE_URL_SQL')):
            response = self.bootstrap()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('PRIVATE', response.text)
        self.assertEqual(self.counts(), (0, 0))

    def test_conflict_without_winner_fails_closed(self):
        fake = Mock()
        fake.scalar.return_value = None
        fake.commit.side_effect = IntegrityError('private', {}, Exception('PRIVATE_DB'))
        with self.assertRaises(service.BootstrapError) as caught:
            service.bootstrap_auth_identity(fake, self.identity)
        self.assertEqual(caught.exception.code, 'BOOTSTRAP_UNAVAILABLE')
        fake.rollback.assert_called_once()

    def test_missing_owner_mapping_fails_closed(self):
        # 훼손된 관계를 fake로 표현합니다. 운영 FK를 우회하거나 실제 데이터를 수정하지 않습니다.
        fake = Mock()
        fake.scalar.side_effect = [AuthIdentity(user_id=uuid4(), provider='supabase', subject=self.identity.subject), None]
        with self.assertRaises(service.BootstrapError) as caught:
            service.bootstrap_auth_identity(fake, self.identity)
        self.assertEqual(caught.exception.code, 'INACTIVE_AUTH_USER')
        fake.add.assert_not_called()

    def test_normal_principal_remains_read_only_and_unmapped_403(self):
        with patch('supabase_auth_verifier.verify_supabase_token', return_value=self.identity), \
             patch('auth_identity_service.resolve_identity_principal', side_effect=IdentityMappingError('UNMAPPED_AUTH_IDENTITY')), \
             patch.object(main, 'generate_title_with_openai') as title:
            response = self.client.post('/generate-title', json={'text': 'test'}, headers={'Authorization': 'Bearer token'})
        self.assertEqual(response.status_code, 403)
        title.assert_not_called()
        self.assertEqual(self.counts(), (0, 0))

    def test_endpoint_has_no_user_or_claim_body_schema(self):
        spec = main.app.openapi()['paths']['/auth/bootstrap']['post']
        self.assertNotIn('requestBody', spec)
        self.assertEqual([p['name'] for p in spec['parameters']], ['authorization'])


if __name__ == '__main__':
    unittest.main()
