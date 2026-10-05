"""Phase 9.2.1 로컬 결정론적 검사입니다. 실제 DB/OpenAI/Render 요청은 하지 않습니다."""

import hashlib
import json
import threading
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
from evals.run_lv4_shadow_mode_tests import chat_fixture


def records(output):
    """새 prefix의 최소 JSON만 읽고 업무 원문은 수집하지 않습니다."""
    return [json.loads(line.split('[noie] chat_bg ', 1)[1]) for line in output.splitlines()
            if line.startswith('[noie] chat_bg ')]


class BackgroundObservabilityTests(unittest.TestCase):
    """관측 오류 격리와 기존 함수/순서/응답 계약을 검사합니다."""

    def test_memory_lifecycle_and_elapsed(self):
        task = Mock(return_value='PRIVATE_RESULT')
        request = uuid4()
        with redirect_stdout(StringIO()) as output, patch.object(observer.time, 'monotonic', side_effect=[10.0, 11.25]):
            result = observer.run_observed_background('memory', task, 'PRIVATE_INPUT', correlation_source=request)
        self.assertEqual(result, 'PRIVATE_RESULT')
        task.assert_called_once_with('PRIVATE_INPUT')
        events = records(output.getvalue())
        self.assertEqual([r['event'] for r in events], ['started', 'returned'])
        self.assertEqual(events[-1]['elapsed_ms'], 1250.0)
        self.assertEqual(events[-1]['correlation'], hashlib.sha256(request.bytes).hexdigest()[:24])

    def test_agent_arguments_and_return_unchanged(self):
        args = (uuid4(), uuid4(), object())
        task = Mock(return_value=object())
        with redirect_stdout(StringIO()) as output:
            result = observer.run_observed_background('agent', task, *args, correlation_source=args[1])
        task.assert_called_once_with(*args)
        self.assertIs(result, task.return_value)
        self.assertEqual([r['task'] for r in records(output.getvalue())], ['agent', 'agent'])

    def test_uncaught_exception_logged_and_rethrown(self):
        error = RuntimeError('PRIVATE_EXCEPTION_MESSAGE')
        task = Mock(side_effect=error)
        with redirect_stdout(StringIO()) as output:
            with self.assertRaises(RuntimeError) as caught:
                observer.run_observed_background('memory', task, correlation_source=uuid4())
        self.assertIs(caught.exception, error)
        self.assertEqual([r['event'] for r in records(output.getvalue())], ['started', 'failed'])
        self.assertNotIn('PRIVATE_EXCEPTION_MESSAGE', output.getvalue())

    def test_internally_swallowed_error_is_returned_not_success(self):
        def task():
            try:
                raise RuntimeError('PRIVATE_EXCEPTION')
            except Exception:
                return None
        with redirect_stdout(StringIO()) as output:
            observer.run_observed_background('agent', task, correlation_source=uuid4())
        self.assertEqual(records(output.getvalue())[-1]['event'], 'returned')
        self.assertNotIn('success', output.getvalue().lower())

    def test_print_failure_does_not_block_task(self):
        task = Mock()
        with patch('builtins.print', side_effect=OSError('PRIVATE_LOG_ERROR')):
            observer.run_observed_background('memory', task, correlation_source=uuid4())
        task.assert_called_once_with()

    def test_json_failure_does_not_block_task(self):
        task = Mock()
        with patch.object(observer.json, 'dumps', side_effect=TypeError('PRIVATE_SERIALIZATION')):
            observer.run_observed_background('agent', task, correlation_source=uuid4())
        task.assert_called_once_with()

    def test_observation_function_failure_does_not_block_task(self):
        task = Mock()
        with patch.object(observer, '_emit', side_effect=RuntimeError('PRIVATE_LOG_ERROR')):
            observer.run_observed_background('memory', task, correlation_source=uuid4())
        task.assert_called_once_with()

    def test_clock_failure_does_not_block_task(self):
        task = Mock()
        with patch.object(observer.time, 'monotonic', side_effect=RuntimeError('PRIVATE_CLOCK')), redirect_stdout(StringIO()):
            observer.run_observed_background('agent', task, correlation_source=uuid4())
        task.assert_called_once_with()

    def test_invalid_correlation_does_not_block_or_log_raw_source(self):
        task = Mock()
        with redirect_stdout(StringIO()) as output:
            observer.run_observed_background('memory', task, correlation_source='PRIVATE_UUID_SOURCE')
        task.assert_called_once_with()
        self.assertIsNone(records(output.getvalue())[0]['correlation'])
        self.assertNotIn('PRIVATE_UUID_SOURCE', output.getvalue())

    def test_logging_failure_preserves_original_exception(self):
        error = ValueError('PRIVATE_TASK_ERROR')
        with patch.object(observer, '_emit', side_effect=RuntimeError('PRIVATE_LOG_ERROR')):
            with self.assertRaises(ValueError) as caught:
                observer.run_observed_background('agent', Mock(side_effect=error), correlation_source=uuid4())
        self.assertIs(caught.exception, error)

    def test_low_cardinality_and_private_arguments(self):
        identities = [uuid4() for _ in range(4)]
        with redirect_stdout(StringIO()) as output:
            observer.run_observed_background('agent', Mock(), *identities, 'PRIVATE_USER_TEXT',
                'PRIVATE_MEMORY', 'PRIVATE_API_KEY', 'PRIVATE_DB_URL', correlation_source=identities[0])
        for secret in [str(x) for x in identities] + ['PRIVATE_USER_TEXT', 'PRIVATE_MEMORY', 'PRIVATE_API_KEY', 'PRIVATE_DB_URL']:
            self.assertNotIn(secret, output.getvalue())
        for record in records(output.getvalue()):
            self.assertLessEqual(set(record), {'event', 'task', 'correlation', 'elapsed_ms'})

    def test_unknown_task_name_not_logged_but_task_runs(self):
        task = Mock()
        with redirect_stdout(StringIO()) as output:
            observer.run_observed_background('PRIVATE_TASK_NAME', task, correlation_source=uuid4())
        task.assert_called_once_with()
        self.assertEqual(output.getvalue(), '')

    def call_chat(self, enabled):
        """실제 route와 Starlette 예약을 사용하되 원래 업무/OpenAI/DB는 fixture fake입니다."""
        trace = []
        with chat_fixture(enabled=enabled) as (context, mocks), \
                patch.object(shadow, 'run_shadow', side_effect=lambda **kwargs: trace.append('shadow')) as worker, \
                redirect_stdout(StringIO()) as output:
            mocks['run_memory_extraction_background'].side_effect = lambda *args: trace.append('memory')
            mocks['run_chat_agent_integration'].side_effect = lambda *args: trace.append('agent')
            response = TestClient(main.app).post('/chat', json={'text': 'PRIVATE_CHAT_INPUT', 'request_id': str(context.request_id)})
        return response, context, mocks, trace, output.getvalue(), worker

    def test_shadow_off_production_unchanged(self):
        response, context, mocks, trace, output, worker = self.call_chat(False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reply'], '기존 production 답변')
        self.assertEqual(trace, ['memory', 'agent'])
        worker.assert_not_called()
        mocks['run_memory_extraction_background'].assert_called_once_with(context.user_message_id)
        mocks['run_chat_agent_integration'].assert_called_once_with(context.user_message_id, context.request_id, None)
        mocks['complete_chat_request'].assert_called_once()
        self.assertNotIn('PRIVATE_CHAT_INPUT', output)

    def test_registration_order_preserved(self):
        order = []
        original = BackgroundTasks.add_task
        def capture(tasks, function, *args, **kwargs):
            order.append(args[0] if function is observer.run_observed_background else 'shadow'
                if function is shadow.run_shadow else 'other')
            return original(tasks, function, *args, **kwargs)
        with patch.object(BackgroundTasks, 'add_task', capture):
            _, _, _, trace, _, _ = self.call_chat(True)
        self.assertEqual(order, ['memory', 'agent', 'shadow'])
        self.assertEqual(trace, order)

    def test_matching_shadow_correlation(self):
        _, context, _, _, output, _ = self.call_chat(True)
        gate = next(json.loads(line.split('[noie] lv4_shadow ', 1)[1]) for line in output.splitlines()
            if line.startswith('[noie] lv4_shadow '))
        self.assertTrue(gate['eligible'] and gate['scheduled'])
        self.assertTrue(all(r['correlation'] == gate['correlation'] for r in records(output)))
        self.assertNotIn(str(context.request_id), output)

    def test_message_fallback_matches_shadow_correlation(self):
        with chat_fixture() as (context, _), redirect_stdout(StringIO()) as output:
            tasks = BackgroundTasks()
            from dataclasses import replace
            context = replace(context, request_id=None)
            shadow.schedule_shadow(tasks, context=context, text='private', memories=[])
            observer.run_observed_background('memory', Mock(), correlation_source=context.user_message_id)
        # request가 없는 실제 /chat은 gate에서 제외됩니다. 동일 hash fallback 개념만 검증합니다.
        self.assertEqual(records(output.getvalue())[0]['correlation'], hashlib.sha256(context.user_message_id.bytes).hexdigest()[:24])
        self.assertEqual(len(tasks.tasks), 0)

    def test_cached_duplicate_no_observability_or_tasks(self):
        original = self.call_chat(False)[0].json()
        with chat_fixture(cached=original) as (context, mocks), redirect_stdout(StringIO()) as output:
            response = TestClient(main.app).post('/chat', json={'text': 'PRIVATE_INPUT', 'request_id': str(context.request_id)})
        self.assertEqual(response.json(), original)
        self.assertEqual(records(output.getvalue()), [])
        mocks['run_memory_extraction_background'].assert_not_called()
        mocks['run_chat_agent_integration'].assert_not_called()

    def test_logging_failure_does_not_break_chat_or_shadow(self):
        with patch.object(observer, '_emit', side_effect=RuntimeError('PRIVATE_LOG_ERROR')):
            response, _, _, trace, _, worker = self.call_chat(True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(trace, ['memory', 'agent', 'shadow'])
        worker.assert_called_once()

    def test_started_is_visible_while_function_blocked(self):
        entered, release = threading.Event(), threading.Event()
        def blocked():
            entered.set()
            release.wait(3)
        with redirect_stdout(StringIO()) as output:
            thread = threading.Thread(target=observer.run_observed_background,
                args=('memory', blocked), kwargs={'correlation_source': uuid4()})
            thread.start()
            try:
                self.assertTrue(entered.wait(2))
                self.assertEqual([r['event'] for r in records(output.getvalue())], ['started'])
            finally:
                release.set()
                thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(records(output.getvalue())[-1]['event'], 'returned')


if __name__ == '__main__':
    unittest.main()
