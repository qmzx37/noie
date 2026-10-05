"""독립 endpoint 계약 검사입니다. TestClient 결과는 Render 실행 증거가 아닙니다."""

import ast
import hashlib
import inspect
import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
import main
from evals.run_chat_background_observability_tests import records


class BackgroundEndpointProbeTests(unittest.TestCase):
    """환경변수 분기, 최소 등록 계약, privacy와 업무 호출 부재를 검사합니다."""

    def call_endpoint(self, value=None, request_id=None):
        """실제 route와 BackgroundTasks를 사용하고 등록 내용을 함께 수집합니다."""
        registered = []
        original = BackgroundTasks.add_task

        def capture(tasks, function, *args, **kwargs):
            registered.append((function, args, kwargs))
            return original(tasks, function, *args, **kwargs)

        # 이 기존 dispatch 검사는 개발 모드이며 인증 정책은 별도 Access 검사에서 검증합니다.
        with patch.dict(os.environ, {'NOIE_AUTH_ENABLED': 'false'}):
            os.environ.pop('NOIE_BG_PROBE_ENDPOINT_ENABLED', None)
            if value is not None:
                os.environ['NOIE_BG_PROBE_ENDPOINT_ENABLED'] = value
            with patch.object(BackgroundTasks, 'add_task', capture), redirect_stdout(StringIO()) as output:
                response = TestClient(main.app).post('/internal/background-probe',
                    params={} if request_id is None else {'request_id': str(request_id)})
        return response, registered, output.getvalue()

    def test_unset_false_and_invalid_off(self):
        """미설정과 허용하지 않은 값은 404이며 task를 등록하지 않습니다."""
        for value in (None, '', 'false', '0', 'off', 'no', 'enabled', 'true!'):
            with self.subTest(value=value):
                response, registered, output = self.call_endpoint(value, uuid4())
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {'detail': 'Not Found'})
                self.assertEqual(registered, [])
                self.assertEqual(output, '')

    def test_enabled_single_task_and_safe_lifecycle(self):
        """ON 값에서 probe 하나만 등록하고 같은 hash로 시작/반환을 기록합니다."""
        for value in ('1', 'true', 'yes', 'on', ' TRUE ', ' YeS ', ' ON '):
            with self.subTest(value=value):
                request_id = uuid4()
                response, registered, output = self.call_endpoint(value, request_id)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {'status': 'scheduled'})
                self.assertEqual(registered, [(main.run_background_probe, (),
                                              {'correlation_source': request_id})])
                events = records(output)
                self.assertEqual([r['event'] for r in events], ['started', 'returned'])
                self.assertTrue(all(r['task'] == 'probe' for r in events))
                expected = hashlib.sha256(request_id.bytes).hexdigest()[:24]
                self.assertTrue(all(r['correlation'] == expected for r in events))
                self.assertNotIn(str(request_id), output)

    def test_invalid_uuid_validation(self):
        """잘못된 UUID는 FastAPI가 422로 거부하고 probe를 예약하지 않습니다."""
        response, registered, output = self.call_endpoint('true', 'not-a-uuid')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['detail'][0]['loc'], ['query', 'request_id'])
        self.assertEqual(registered, [])
        self.assertEqual(output, '')

    def test_missing_uuid_validation(self):
        """필수 query가 없으면 task 없이 검증 오류만 반환합니다."""
        response, registered, _ = self.call_endpoint('true')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(registered, [])

    def test_no_external_work_or_dependencies(self):
        """호출 목록과 의존성 계약을 제한해 DB/OpenAI/업무 호출을 막습니다."""
        tree = ast.parse(inspect.getsource(main.background_endpoint_probe))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef))
        body = ast.Module(body=function.body, type_ignores=[])
        calls = {ast.unparse(node.func) for node in ast.walk(body) if isinstance(node, ast.Call)}
        self.assertEqual(calls, {'os.getenv',
            "os.getenv('NOIE_BG_PROBE_ENDPOINT_ENABLED', '').strip",
            "os.getenv('NOIE_BG_PROBE_ENDPOINT_ENABLED', '').strip().lower",
            'HTTPException', 'background_tasks.add_task',
            'require_core_principal', 'resolve_auth_principal'})
        route = next(route for route in main.app.routes if route.path == '/internal/background-probe')
        self.assertEqual(route.dependant.dependencies, [])
        self.assertFalse(route.include_in_schema)

    def test_logging_failure_preserves_scheduled_response(self):
        """로그 출력 실패도 scheduled 응답을 깨뜨리지 않습니다."""
        with patch('builtins.print', side_effect=OSError('PRIVATE_LOG_FAILURE')):
            response, registered, output = self.call_endpoint('true', uuid4())
        self.assertEqual(response.json(), {'status': 'scheduled'})
        self.assertEqual(len(registered), 1)
        self.assertEqual(output, '')


if __name__ == '__main__':
    unittest.main()
