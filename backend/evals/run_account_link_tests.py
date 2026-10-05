"""로컬 SQLite의 합성 테이블과 fake 세션만 사용합니다. 실제 계정/DB 연결은 없습니다."""

import contextlib
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4
import unittest

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from models.auth_identity import AuthIdentity
from auth_account_link_service import AccountLinkError, link_auth_identity
from scripts import link_supabase_identity as cli


class AccountLinkTests(unittest.TestCase):
    """실제 SQLAlchemy 조회/flush와 로컬 UNIQUE 제약으로 서비스 계약을 검사합니다."""

    def setUp(self):
        self.engine = sa.create_engine('sqlite:///:memory:')
        @sa.event.listens_for(self.engine, 'connect')
        def configure(connection, record):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.create_function('now', 0, lambda: datetime.now(timezone.utc).isoformat())
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)
        metadata = sa.MetaData()
        self.users = sa.Table('users', metadata,
            sa.Column('id', sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column('deleted_at', sa.DateTime(timezone=True)))
        AuthIdentity.__table__.to_metadata(metadata)
        metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.owner, self.other = uuid4(), uuid4()
        self.subject, self.other_subject = str(uuid4()), str(uuid4())
        self.db.execute(self.users.insert(), [{'id': self.owner}, {'id': self.other}])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def link(self, **kwargs):
        return link_auth_identity(self.db, **{'user_id': self.owner, 'provider': 'supabase',
                                             'subject': self.subject, **kwargs})

    def count(self):
        return self.db.scalar(sa.select(sa.func.count()).select_from(AuthIdentity))

    def test_active_user_success_and_idempotent_repeat(self):
        result = self.link()
        self.assertEqual((result.user_id, result.provider, result.subject), (self.owner, 'supabase', self.subject))
        self.db.commit()
        again = self.link()
        self.assertEqual(again.id, result.id)
        self.assertEqual(self.count(), 1)

    def test_missing_or_deleted_local_user_fails(self):
        self.db.execute(self.users.update().where(self.users.c.id == self.other).values(deleted_at=datetime.now(timezone.utc)))
        self.db.commit()
        for identity in (uuid4(), self.other):
            with self.subTest(identity=identity), self.assertRaises(AccountLinkError) as caught:
                self.link(user_id=identity)
            self.assertEqual(caught.exception.code, 'ACTIVE_LOCAL_USER_REQUIRED')
        self.assertEqual(self.count(), 0)

    def test_invalid_inputs_never_write(self):
        inputs = [{'provider': 'other'}, {'provider': ''}, {'subject': ''}, {'subject': ' '},
                  {'subject': 'bad-uuid'}, {'subject': self.subject.upper()},
                  {'subject': self.subject.replace('-', '')}, {'subject': None},
                  {'user_id': str(self.owner)}]
        for change in inputs:
            with self.subTest(change=tuple(change)), self.assertRaises(AccountLinkError) as caught:
                self.link(**change)
            self.assertEqual(caught.exception.code, 'INVALID_LINK_INPUT')
        self.assertEqual(self.count(), 0)

    def test_same_subject_other_user_conflict(self):
        original = self.link()
        self.db.commit()
        with self.assertRaises(AccountLinkError) as caught:
            self.link(user_id=self.other)
        self.assertEqual(caught.exception.code, 'IDENTITY_ALREADY_LINKED')
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.db.get(AuthIdentity, original.id).user_id, self.owner)

    def test_same_user_other_subject_conflict(self):
        self.link()
        self.db.commit()
        with self.assertRaises(AccountLinkError) as caught:
            self.link(subject=self.other_subject)
        self.assertEqual(caught.exception.code, 'USER_ALREADY_LINKED')
        self.assertEqual(self.count(), 1)

    def test_dry_run_does_not_write_and_checks_conflicts(self):
        self.assertIsNone(self.link(dry_run=True))
        self.assertEqual(self.count(), 0)
        existing = self.link()
        self.db.commit()
        self.assertEqual(self.link(dry_run=True).id, existing.id)
        with self.assertRaises(AccountLinkError):
            self.link(user_id=self.other, dry_run=True)
        with self.assertRaises(AccountLinkError):
            self.link(subject=self.other_subject, dry_run=True)
        self.assertEqual(self.count(), 1)

    def test_local_unique_constraints_enforced(self):
        self.link()
        self.db.commit()
        for owner, subject in ((self.other, self.subject), (self.owner, self.other_subject)):
            with self.subTest(owner=owner):
                with self.assertRaises(IntegrityError):
                    with self.db.begin_nested():
                        self.db.add(AuthIdentity(user_id=owner, provider='supabase', subject=subject))
                        self.db.flush()
        self.assertEqual(self.count(), 1)

    def test_write_rollback_removes_new_link(self):
        # 바깥 transaction은 CLI가 commit할 때까지 저장을 확정하지 않습니다.
        self.db.connection().exec_driver_sql('BEGIN')
        self.link()
        self.db.rollback()
        self.assertEqual(self.count(), 0)


class AccountLinkRaceTests(unittest.TestCase):
    """PostgreSQL UNIQUE 경쟁 경로는 fake savepoint로 결정론적으로 확인합니다."""

    def test_race_winner_same_link_reused(self):
        owner, subject = uuid4(), str(uuid4())
        winner = AuthIdentity(id=uuid4(), user_id=owner, provider='supabase', subject=subject)
        db = Mock()
        db.scalar.side_effect = [owner, None, None, winner]
        db.begin_nested.return_value.__enter__ = Mock()
        db.begin_nested.return_value.__exit__ = Mock(return_value=False)
        db.flush.side_effect = IntegrityError('synthetic', {}, Exception())
        self.assertIs(link_auth_identity(db, user_id=owner, provider='supabase', subject=subject), winner)
        db.commit.assert_not_called()
        self.assertIn('FOR UPDATE', str(db.scalar.call_args_list[0].args[0]))

    def test_race_winner_other_user_conflict(self):
        owner, subject = uuid4(), str(uuid4())
        db = Mock()
        db.scalar.side_effect = [owner, None, None, AuthIdentity(user_id=uuid4(), provider='supabase', subject=subject)]
        db.begin_nested.return_value.__enter__ = Mock()
        db.begin_nested.return_value.__exit__ = Mock(return_value=False)
        db.flush.side_effect = IntegrityError('synthetic', {}, Exception())
        with self.assertRaises(AccountLinkError) as caught:
            link_auth_identity(db, user_id=owner, provider='supabase', subject=subject)
        self.assertEqual(caught.exception.code, 'IDENTITY_ALREADY_LINKED')

    def test_dry_run_no_write_or_lock(self):
        owner = uuid4()
        db = Mock()
        db.scalar.side_effect = [owner, None, None]
        self.assertIsNone(link_auth_identity(db, user_id=owner, provider='supabase', subject=str(uuid4()), dry_run=True))
        for method in (db.add, db.flush, db.commit, db.begin_nested):
            method.assert_not_called()
        self.assertNotIn('FOR UPDATE', str(db.scalar.call_args_list[0].args[0]))


class AccountLinkCliTests(unittest.TestCase):
    """CLI 출력/확인/dry-run transaction을 fake DB로 검증합니다."""

    def run_cli(self, *flags, result=None, error=None):
        owner, subject = uuid4(), str(uuid4())
        db = Mock()
        factory = Mock()
        factory.return_value.__enter__ = Mock(return_value=db)
        factory.return_value.__exit__ = Mock(return_value=False)
        with patch.object(cli, 'SessionLocal', factory), \
                patch.object(cli, 'link_auth_identity', return_value=result, side_effect=error) as link, \
                contextlib.redirect_stdout(StringIO()) as output, contextlib.redirect_stderr(StringIO()) as errors:
            code = cli.main(['--user-id', str(owner), '--subject', subject, *flags])
        for secret in (str(owner), subject):
            self.assertNotIn(secret, output.getvalue() + errors.getvalue())
        return code, db, link, output.getvalue(), errors.getvalue()

    def test_cli_dry_run_rolls_back_no_commit(self):
        code, db, link, output, _ = self.run_cli('--dry-run')
        self.assertEqual(code, 0)
        self.assertEqual(output.strip(), 'DRY_RUN: LINK_AVAILABLE')
        self.assertTrue(link.call_args.kwargs['dry_run'])
        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    def test_cli_write_explicit_commit_and_safe_output(self):
        code, db, _, output, _ = self.run_cli('--confirm-link')
        self.assertEqual(code, 0)
        db.commit.assert_called_once()
        self.assertEqual(output.strip(), 'ACCOUNT_LINK_OK')

    def test_cli_write_failure_rolls_back_and_hides_details(self):
        for error in (AccountLinkError('IDENTITY_ALREADY_LINKED'), RuntimeError('PRIVATE_DB_TOKEN_URL')):
            with self.subTest(error=type(error).__name__):
                code, db, _, output, errors = self.run_cli('--confirm-link', error=error)
                self.assertEqual(code, 1)
                db.rollback.assert_called_once()
                db.commit.assert_not_called()
                self.assertNotIn('PRIVATE_DB_TOKEN_URL', output + errors)

    def test_cli_does_not_accept_token_email_or_unconfirmed_write(self):
        for extra in ([], ['--access-token', 'PRIVATE_TOKEN'], ['--email', 'private@example.invalid']):
            with self.subTest(extra=bool(extra)), patch.object(cli, 'SessionLocal') as factory, \
                    contextlib.redirect_stderr(StringIO()) as errors, self.assertRaises(SystemExit) as caught:
                cli.main(['--user-id', str(uuid4()), '--subject', str(uuid4()), *extra])
            self.assertEqual(caught.exception.code, 2)
            factory.assert_not_called()
            self.assertNotIn('PRIVATE_TOKEN', errors.getvalue())
            self.assertNotIn('private@example.invalid', errors.getvalue())


if __name__ == '__main__':
    unittest.main()
