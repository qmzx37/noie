"""Shadow 호출 경계와 tail의 결정론적 검사입니다. 실제 DB/OpenAI/Render 호출은 없습니다."""

import ast
import asyncio
import hashlib
import inspect
import json
import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
import main
import lv4_shadow_service as shadow
import chat_background_observability as observer
from evals.run_chat_background_observability_tests import records
from evals.run_lv4_shadow_mode_tests import chat_fixture


def shadow_records(output):
    """원문 없는 Shadow JSON 로그만 읽습니다."""
    return [json.loads(line.split('[noie] lv4_shadow ', 1)[1]) for line in output.splitlines()
            if line.startswith('[noie] lv4_shadow ')]


class ShadowDispatchTailTests(unittest.TestCase):
    """예약, 실행 순서, 예외 정책과 privacy를 검증합니다."""

    def test_wrapper_arguments_return_and_order(self):
        """같은 객체/값을 넘기고 같은 반환값을 돌려주며 로그 순서를 유지합니다."""
        owner, memories, result = uuid4(), ({'content': 'PRIVATE_MEMORY'},), object()
        correlation = hashlib.sha256(uuid4().bytes).hexdigest()[:24]
        with redirect_stdout(StringIO()) as output:
            def worker(**kwargs):
                self.assertEqual(shadow_records(output.getvalue())[0]['event'], 'dispatch_started')
                self.assertIs(kwargs['memories'], memories)
                return result
            with patch.object(shadow, 'run_shadow', side_effect=worker) as task:
                actual = shadow.run_shadow_dispatch_observed(user_id=owner, text='PRIVATE_TEXT',
                    memories=memories, correlation=correlation)
        self.assertIs(actual, result)
        task.assert_called_once_with(user_id=owner, text='PRIVATE_TEXT', memories=memories, correlation=correlation)
        self.assertEqual([r['event'] for r in shadow_records(output.getvalue())],
                         ['dispatch_started', 'dispatch_returned'])
        for secret in (str(owner), 'PRIVATE_TEXT', 'PRIVATE_MEMORY'):
            self.assertNotIn(secret, output.getvalue())

    def test_base_exception_propagates_and_failed_logged(self):
        """취소 등 BaseException도 같은 예외 객체를 재전파합니다."""
        error = SystemExit('PRIVATE_EXCEPTION')
        with patch.object(shadow, 'run_shadow', side_effect=error), redirect_stdout(StringIO()) as output:
            with self.assertRaises(SystemExit) as caught:
                shadow.run_shadow_dispatch_observed(user_id=uuid4(), text='PRIVATE_TEXT', memories=(), correlation='safe')
        self.assertIs(caught.exception, error)
        self.assertEqual([r['event'] for r in shadow_records(output.getvalue())],
                         ['dispatch_started', 'dispatch_failed'])
        self.assertNotIn('PRIVATE_EXCEPTION', output.getvalue())

    def test_logging_failure_preserves_execution_and_exception(self):
        """관측 helper 실패가 Shadow 호출이나 원래 예외를 바꾸지 않습니다."""
        args = dict(user_id=uuid4(), text='private', memories=(), correlation='safe')
        with patch.object(shadow, '_emit', side_effect=RuntimeError('PRIVATE_LOG_ERROR')):
            with patch.object(shadow, 'run_shadow', return_value=42) as worker:
                self.assertEqual(shadow.run_shadow_dispatch_observed(**args), 42)
                worker.assert_called_once_with(**args)
            error = KeyboardInterrupt('PRIVATE_EXCEPTION')
            with patch.object(shadow, 'run_shadow', side_effect=error), self.assertRaises(KeyboardInterrupt) as caught:
                shadow.run_shadow_dispatch_observed(**args)
            self.assertIs(caught.exception, error)

    def test_allowed_registration_and_tail_lifecycle(self):
        """등록은 wrapper -> tail이며 실제 Starlette 실행에서도 같은 순서입니다."""
        with chat_fixture() as (context, _), redirect_stdout(StringIO()) as output:
            tasks = BackgroundTasks()
            shadow.schedule_shadow(tasks, context=context, text='PRIVATE_TEXT', memories=[])
            self.assertEqual([t.func for t in tasks.tasks],
                             [shadow.run_shadow_dispatch_observed, observer.run_background_tail_probe])
            self.assertEqual(tasks.tasks[0].kwargs['user_id'], context.user_id)
            self.assertEqual(tasks.tasks[1].kwargs, {'correlation_source': context.request_id})
            with patch.object(shadow, 'run_shadow', return_value=None) as worker:
                asyncio.run(tasks())
            worker.assert_called_once_with(**tasks.tasks[0].kwargs)
        self.assertEqual([r['event'] for r in shadow_records(output.getvalue())],
                         ['gate', 'dispatch_started', 'dispatch_returned'])
        tail = records(output.getvalue())
        self.assertEqual([(r['task'], r['event']) for r in tail], [('tail', 'started'), ('tail', 'returned')])
        expected = hashlib.sha256(context.request_id.bytes).hexdigest()[:24]
        self.assertTrue(all(r['correlation'] == expected for r in tail))
        self.assertNotIn(str(context.request_id), output.getvalue())
        self.assertNotIn('PRIVATE_TEXT', output.getvalue())

    def test_off_and_rejected_gate_register_neither(self):
        """global OFF와 이중 allowlist 실패에는 wrapper/tail이 모두 없습니다."""
        for flag in ('NOIE_LV4_SHADOW_ENABLED', 'NOIE_LV4_SHADOW_ALLOWLIST', 'NOIE_LV4_SHADOW_REQUEST_ALLOWLIST'):
            with self.subTest(flag=flag), chat_fixture() as (context, _), \
                    patch.dict(os.environ, {flag: 'false' if flag.endswith('ENABLED') else str(uuid4())}), \
                    redirect_stdout(StringIO()):
                tasks = BackgroundTasks()
                shadow.schedule_shadow(tasks, context=context, text='private', memories=[])
                self.assertEqual(tasks.tasks, [])

    def test_exception_stops_tail_without_changing_policy(self):
        """미처리 예외에는 기존 순차 chain이 중단되고 tail을 성공처럼 기록하지 않습니다."""
        with chat_fixture() as (context, _), redirect_stdout(StringIO()) as output:
            tasks = BackgroundTasks()
            shadow.schedule_shadow(tasks, context=context, text='private', memories=[])
            with patch.object(shadow, 'run_shadow', side_effect=RuntimeError('PRIVATE_ERROR')):
                with self.assertRaises(RuntimeError):
                    asyncio.run(tasks())
        self.assertEqual(records(output.getvalue()), [])
        self.assertEqual(shadow_records(output.getvalue())[-1]['event'], 'dispatch_failed')

    def test_flush_and_tail_errors_isolated(self):
        """양쪽 prefix가 flush하고 tail의 로그 오류는 전파하지 않습니다."""
        with patch('builtins.print') as printer:
            shadow._emit('dispatch_started', {'correlation': 'safe'})
            observer.run_background_tail_probe(correlation_source=uuid4())
        self.assertEqual(printer.call_count, 3)
        self.assertTrue(all(call.kwargs == {'flush': True} for call in printer.call_args_list))
        with patch.object(observer, '_emit', side_effect=RuntimeError('PRIVATE_ERROR')):
            self.assertIsNone(observer.run_background_tail_probe(correlation_source=uuid4()))

    def test_tail_has_no_external_calls(self):
        """tail은 hash와 로깅 외에 DB/OpenAI/sleep/service를 호출하지 않습니다."""
        tree = ast.parse(inspect.getsource(observer.run_background_tail_probe))
        self.assertEqual({ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)},
                         {'hashlib.sha256', 'hashlib.sha256(correlation_source.bytes).hexdigest', '_emit'})

    def test_full_chat_order_and_duplicate(self):
        """probe/Memory/Agent/Shadow 순서를 보존하며 tail이 마지막이고 duplicate는 재실행하지 않습니다."""
        with chat_fixture() as (context, mocks), patch.dict(os.environ, {'NOIE_CHAT_BG_PROBE_ENABLED': 'true'}), \
                patch.object(shadow, 'run_shadow', return_value=None), redirect_stdout(StringIO()) as output:
            response = TestClient(main.app).post('/chat', json={'text': 'private', 'request_id': str(context.request_id)})
            mocks['complete_chat_request'].assert_called_once()
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r['task'] for r in records(output.getvalue())],
                         ['probe', 'probe', 'memory', 'memory', 'agent', 'agent', 'tail', 'tail'])
        events = [json.loads(line.split(' ', 2)[2]) for line in output.getvalue().splitlines() if line.startswith('[noie] ')]
        agent_return = next(i for i,r in enumerate(events) if r.get('task') == 'agent' and r['event'] == 'returned')
        dispatch = next(i for i,r in enumerate(events) if r['event'] == 'dispatch_started')
        tail = next(i for i,r in enumerate(events) if r.get('task') == 'tail')
        self.assertLess(agent_return, dispatch)
        self.assertLess(dispatch, tail)
        with chat_fixture(cached=response.json()) as (context, _), \
                patch.object(shadow, 'run_shadow') as worker, redirect_stdout(StringIO()) as output:
            cached = TestClient(main.app).post('/chat', json={'text': 'private', 'request_id': str(context.request_id)})
        self.assertEqual(cached.json(), response.json())
        worker.assert_not_called()
        self.assertEqual(output.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
