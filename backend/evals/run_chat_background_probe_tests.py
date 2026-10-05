"""probe 전용 로컬 검사입니다. 업무/DB/OpenAI는 fake이며 production 요청은 없습니다."""

import ast
import hashlib
import inspect
import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
import main
import chat_background_observability as observer
import lv4_shadow_service as shadow
from evals.run_chat_background_observability_tests import records
from evals.run_lv4_shadow_mode_tests import chat_fixture


class BackgroundProbeTests(unittest.TestCase):
    """설정값, 실제 등록/실행 순서, privacy, 관측 오류 격리를 확인합니다."""

    def call_chat(self, value=None, cached=None):
        """실제 FastAPI/Starlette 경로를 사용하고 외부 업무만 fake로 교체합니다."""
        trace, registered = [], []
        original_probe = observer.run_background_probe
        original_add = BackgroundTasks.add_task

        def probe(**kwargs):
            trace.append('probe')
            return original_probe(**kwargs)

        def capture(tasks, function, *args, **kwargs):
            registered.append((function, args, kwargs))
            return original_add(tasks, function, *args, **kwargs)

        with patch.dict(os.environ):
            os.environ.pop('NOIE_CHAT_BG_PROBE_ENABLED', None)
            if value is not None:
                os.environ['NOIE_CHAT_BG_PROBE_ENABLED'] = value
            with chat_fixture(enabled=True, cached=cached) as (context, mocks), \
                    patch.object(main, 'run_background_probe', probe), \
                    patch.object(BackgroundTasks, 'add_task', capture), \
                    patch.object(shadow, 'run_shadow', side_effect=lambda **kw: trace.append('shadow')), \
                    redirect_stdout(StringIO()) as output:
                mocks['run_memory_extraction_background'].side_effect = lambda *a: trace.append('memory')
                mocks['run_chat_agent_integration'].side_effect = lambda *a: trace.append('agent')
                response = TestClient(main.app).post('/chat', json={
                    'text': 'PRIVATE_INPUT', 'request_id': str(context.request_id)})
        return response, context, trace, registered, output.getvalue()

    def test_off_and_invalid_values(self):
        """미설정과 잘못된 값에서는 기존 세 task만 실행합니다."""
        for value in (None, '', '0', 'false', 'no', 'off', 'enabled', 'true!'):
            with self.subTest(value=value):
                response, _, trace, registered, _ = self.call_chat(value)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(trace, ['memory', 'agent', 'shadow'])
                self.assertEqual(len(registered), 4)
                self.assertIs(registered[-1][0], shadow.run_background_tail_probe)

    def test_on_values_order_and_correlation(self):
        """허용된 값에서만 probe가 Memory보다 먼저 등록/실행됩니다."""
        for value in ('1', 'true', 'yes', 'on', ' TRUE ', ' YeS ', ' ON '):
            with self.subTest(value=value):
                response, context, trace, registered, output = self.call_chat(value)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(trace, ['probe', 'memory', 'agent', 'shadow'])
                self.assertEqual(len(registered), 5)
                self.assertIs(registered[-2][0], shadow.run_shadow_dispatch_observed)
                self.assertIs(registered[-1][0], shadow.run_background_tail_probe)
                self.assertEqual(registered[0][2]['correlation_source'], context.request_id)
                self.assertEqual(registered[1][1][0], 'memory')
                self.assertEqual(registered[2][1][0], 'agent')
                events = records(output)
                self.assertEqual([(r['task'], r['event']) for r in events[:2]],
                                 [('probe', 'started'), ('probe', 'returned')])
                expected = hashlib.sha256(context.request_id.bytes).hexdigest()[:24]
                self.assertTrue(all(r['correlation'] == expected for r in events))
                self.assertNotIn(str(context.request_id), output)
                self.assertNotIn('PRIVATE_INPUT', output)

    def test_lifecycle_and_flush(self):
        """각 로그를 즉시 flush하고 UUID 원문을 포함하지 않는지 확인합니다."""
        request = uuid4()
        with patch('builtins.print') as printer:
            self.assertIsNone(observer.run_background_probe(correlation_source=request))
        self.assertEqual(printer.call_count, 2)
        for call in printer.call_args_list:
            self.assertEqual(call.kwargs, {'flush': True})
            self.assertNotIn(str(request), call.args[0])
            self.assertIn(hashlib.sha256(request.bytes).hexdigest()[:24], call.args[0])

    def test_logging_failures_do_not_block_next_task(self):
        """print/JSON/helper 오류가 나도 다음 task로 진행합니다."""
        for target in ('builtins.print', 'chat_background_observability.json.dumps',
                       'chat_background_observability._emit'):
            with self.subTest(target=target), patch(target, side_effect=RuntimeError('PRIVATE_ERROR')):
                observer.run_background_probe(correlation_source=uuid4())
                task = Mock()
                observer.run_observed_background('memory', task, correlation_source=uuid4())
                task.assert_called_once_with()

    def test_bad_correlation_safe(self):
        """잘못된 식별자는 원문을 출력하지 않고 null로 관측합니다."""
        with redirect_stdout(StringIO()) as output:
            observer.run_background_probe(correlation_source='PRIVATE_UUID')
        self.assertEqual([r['event'] for r in records(output.getvalue())], ['started', 'returned'])
        self.assertTrue(all(r['correlation'] is None for r in records(output.getvalue())))
        self.assertNotIn('PRIVATE_UUID', output.getvalue())

    def test_no_external_work_contract(self):
        """AST로 probe 호출 대상을 제한해 DB/OpenAI/sleep/service 호출을 금지합니다."""
        tree = ast.parse(inspect.getsource(observer.run_background_probe))
        calls = {ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)}
        self.assertEqual(calls, {'hashlib.sha256', 'hashlib.sha256(correlation_source.bytes).hexdigest', '_emit'})

    def test_cached_duplicate_no_tasks(self):
        """완료된 request 재사용은 ON이어도 task를 다시 등록하지 않습니다."""
        cached = self.call_chat('on')[0].json()
        response, _, trace, registered, output = self.call_chat('on', cached=cached)
        self.assertEqual(response.json(), cached)
        self.assertEqual(trace, [])
        self.assertEqual(registered, [])
        self.assertEqual(records(output), [])


if __name__ == '__main__':
    unittest.main()
