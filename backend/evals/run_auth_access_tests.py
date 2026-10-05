"""Access 인증 계약 검사입니다. 외부 DB/Supabase/OpenAI 대신 격리 mock을 사용합니다."""

import os
import unittest
from contextlib import ExitStack, redirect_stdout
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

import main
import auth_context as auth
import agent.router as agent_router
from auth_identity_service import IdentityMappingError
from database import get_db
from schemas import AnalyzeEmotionResponse
from supabase_auth_verifier import TokenVerificationError


class AuthAccessTests(unittest.TestCase):
    """업무 함수 실행 전 인증 차단과 OFF 호환성, 비공개 probe 순서를 검사합니다."""

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {
            'NOIE_AUTH_ENABLED': 'false', 'NOIE_BG_PROBE_ENDPOINT_ENABLED': 'false',
        }))
        self.old_overrides = dict(main.app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        main.app.dependency_overrides.clear()
        self.db = Mock()
        def db_override():
            yield self.db
        main.app.dependency_overrides[get_db] = db_override
        self.principal = auth.AuthPrincipal(uuid4())
        self.verify = self.stack.enter_context(patch(
            'supabase_auth_verifier.verify_supabase_token',
            return_value=auth.VerifiedAuthIdentity('supabase', str(uuid4())),
        ))
        self.mapping = self.stack.enter_context(patch(
            'auth_identity_service.resolve_identity_principal', return_value=self.principal,
        ))
        analysis = main.build_response('상태', main.analyze_with_rules('상태'), 'rule_based')
        self.emotion = AnalyzeEmotionResponse.model_validate(analysis).model_dump(mode='json')
        self.business = {
            '/orchestrate': self.stack.enter_context(patch.object(agent_router,
                'orchestrate_with_openai', return_value={'needs_action': False, 'actions': []})),
            '/agent/tool-plan': self.stack.enter_context(patch.object(agent_router,
                'create_tool_plan', wraps=agent_router.create_tool_plan)),
            '/generate-title': self.stack.enter_context(patch.object(main,
                'generate_title_with_openai', return_value='기존 제목')),
            '/analyze-emotion': self.stack.enter_context(patch.object(main,
                'analyze_text', return_value=(self.emotion, 'rule_based'))),
            '/extract-daily-trace': self.stack.enter_context(patch.object(main,
                'extract_daily_trace_with_openai', return_value={
                    'has_trace': True, 'type': 'record', 'date': '2026-10-05', 'title': '기존 기록',
                })),
        }
        self.probe = self.stack.enter_context(patch.object(main, 'run_background_probe'))
        self.client = self.stack.enter_context(TestClient(main.app))
        self.bodies = {
            '/orchestrate': {'text': '상태'}, '/agent/tool-plan': {'actions': []},
            '/generate-title': {'text': '상태'}, '/analyze-emotion': {'text': '상태'},
            '/extract-daily-trace': {'text': '상태', 'current_date': '2026-10-05'},
        }

    def restore_overrides(self):
        """다른 검사에 영향이 없도록 dependency override를 되돌립니다."""
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(self.old_overrides)

    def request(self, path, headers=None):
        """다섯 endpoint에 실제 HTTP 입력/출력 검증을 적용합니다."""
        return self.client.post(path, json=self.bodies[path], headers=headers or {})

    def test_no_token_blocks_all_before_business(self):
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        for path, work in self.business.items():
            with self.subTest(path=path):
                response = self.request(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers['www-authenticate'], 'Bearer')
                work.assert_not_called()
        self.verify.assert_not_called()
        self.mapping.assert_not_called()
        self.db.execute.assert_not_called()

    def test_invalid_token_blocks_all_without_leaking(self):
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        self.verify.side_effect = TokenVerificationError('PRIVATE_TOKEN_DETAIL')
        with redirect_stdout(StringIO()) as logs:
            for path, work in self.business.items():
                response = self.request(path, {'Authorization': 'Bearer PRIVATE_TOKEN'})
                self.assertEqual(response.status_code, 401)
                self.assertNotIn('PRIVATE', response.text)
                work.assert_not_called()
        self.assertEqual(logs.getvalue(), '')
        self.mapping.assert_not_called()

    def test_mapped_principal_preserves_off_business_contract(self):
        """같은 업무 입력의 OFF/ON 출력이 같고 인증만 앞에 추가되었는지 확인합니다."""
        for path in self.bodies:
            with self.subTest(path=path):
                os.environ['NOIE_AUTH_ENABLED'] = 'false'
                legacy = self.request(path)
                self.assertEqual(legacy.status_code, 200)
                os.environ['NOIE_AUTH_ENABLED'] = 'true'
                protected = self.request(path, {'Authorization': 'Bearer test-token'})
                self.assertEqual(protected.status_code, 200)
                self.assertEqual(protected.json(), legacy.json())
        self.assertEqual(self.verify.call_count, 5)
        self.assertEqual(self.mapping.call_count, 5)

    def test_unmapped_or_inactive_identity_returns_safe_403(self):
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        self.mapping.side_effect = IdentityMappingError('PRIVATE_DATABASE_OR_SUBJECT')
        for path, work in self.business.items():
            response = self.request(path, {'Authorization': 'Bearer test-token'})
            self.assertEqual(response.status_code, 403)
            self.assertNotIn('PRIVATE', response.text)
            work.assert_not_called()

    def test_none_principal_override_cannot_bypass_auth(self):
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        main.app.dependency_overrides[auth.resolve_auth_principal] = lambda: None
        for path, work in self.business.items():
            self.assertEqual(self.request(path).status_code, 401)
            work.assert_not_called()

    def test_public_health_preserves_contract_and_select_one(self):
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        response = self.client.get('/')
        self.assertEqual(response.json(), {'status': 'ok', 'service': 'noie'})
        response = self.client.get('/db-health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok', 'database': 'postgresql'})
        self.assertEqual(str(self.db.execute.call_args.args[0]), 'SELECT 1')
        self.verify.assert_not_called()

    def test_health_failure_hides_db_details_in_response_and_logs(self):
        self.db.execute.side_effect = SQLAlchemyError('PRIVATE_DATABASE_URL_SQL')
        with redirect_stdout(StringIO()) as logs:
            response = self.client.get('/db-health')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('PRIVATE', response.text + logs.getvalue())

    def probe_request(self, headers=None):
        """실제 query 검증은 유지하고 background 함수만 mock 처리합니다."""
        return self.client.post('/internal/background-probe',
            params={'request_id': str(uuid4())}, headers=headers or {})

    def test_disabled_probe_404_precedes_auth(self):
        for enabled in ('false', 'true'):
            os.environ['NOIE_AUTH_ENABLED'] = enabled
            for value in ('', 'false', '0', 'invalid'):
                os.environ['NOIE_BG_PROBE_ENDPOINT_ENABLED'] = value
                for headers in ({}, {'Authorization': 'Bearer test-token'}):
                    self.assertEqual(self.probe_request(headers).status_code, 404)
        self.verify.assert_not_called()
        self.mapping.assert_not_called()
        self.probe.assert_not_called()

    def test_enabled_probe_on_requires_valid_mapped_principal(self):
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        os.environ['NOIE_BG_PROBE_ENDPOINT_ENABLED'] = 'true'
        self.assertEqual(self.probe_request().status_code, 401)
        self.verify.side_effect = TokenVerificationError('PRIVATE_TOKEN')
        self.assertEqual(self.probe_request({'Authorization': 'Bearer invalid'}).status_code, 401)
        self.probe.assert_not_called()
        self.verify.side_effect = None
        self.mapping.side_effect = IdentityMappingError('PRIVATE_IDENTITY')
        self.assertEqual(self.probe_request({'Authorization': 'Bearer unmapped'}).status_code, 403)
        self.probe.assert_not_called()
        self.mapping.side_effect = None
        response = self.probe_request({'Authorization': 'Bearer test-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'scheduled'})
        self.probe.assert_called_once()
        self.db.execute.assert_not_called()

    def test_enabled_probe_off_preserves_legacy_schedule(self):
        for value in ('1', 'true', 'yes', 'on', ' TRUE ', ' YeS '):
            os.environ['NOIE_BG_PROBE_ENDPOINT_ENABLED'] = value
            self.assertEqual(self.probe_request().json(), {'status': 'scheduled'})
        self.assertEqual(self.probe.call_count, 6)
        self.verify.assert_not_called()
        route = next(r for r in main.app.routes if r.path == '/internal/background-probe')
        self.assertFalse(route.include_in_schema)

    def test_title_and_daily_fallbacks_unchanged(self):
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        headers = {'Authorization': 'Bearer test-token'}
        self.business['/generate-title'].side_effect = RuntimeError('PRIVATE_OPENAI')
        self.assertEqual(self.request('/generate-title', headers).json(), {'title': main.fallback_title('상태')})
        self.business['/extract-daily-trace'].side_effect = RuntimeError('PRIVATE_OPENAI')
        self.assertEqual(self.request('/extract-daily-trace', headers).json()['has_trace'], False)
        self.business['/extract-daily-trace'].side_effect = None
        self.business['/extract-daily-trace'].return_value = {'has_trace': True, 'type': 'invalid'}
        self.assertFalse(self.request('/extract-daily-trace', headers).json()['has_trace'])

    def test_gateway_remains_dry_run_with_confirmation(self):
        """access gate는 실제 Tool 실행 허가가 아니며 기존 Execute 확인 정책을 유지합니다."""
        os.environ['NOIE_AUTH_ENABLED'] = 'true'
        body = {'actions': [{'type': 'routine', 'intent': 'unknown', 'mode': 'execute',
            'reason': '검증', 'confidence': 0.9, 'requires_confirmation': True, 'execution_order': 1}]}
        response = self.client.post('/agent/tool-plan', json=body, headers={'Authorization': 'Bearer test-token'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['execution_enabled'])
        self.assertFalse(response.json()['plans'][0]['can_execute'])


if __name__ == '__main__':
    unittest.main()
