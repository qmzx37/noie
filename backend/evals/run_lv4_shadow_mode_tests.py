"""Phase 9 격리 검사입니다. production 저장 경계는 fake이며 실제 DB 성공을 주장하지 않습니다."""

import asyncio
import json
import os
import threading
import unittest
from contextlib import ExitStack, contextmanager, redirect_stdout
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import BackgroundTasks
from fastapi.testclient import TestClient

import main
import lv4_shadow_service as shadow
from agent.lv4.context_bridge import ContextProviders, Lv4ContextBridge
from agent.lv4.collaboration_pipeline import Lv4CollaborationPipeline
from agent.lv4.state_specialist import StateSpecialist
from agent.lv4.recommendation_specialist import RecommendationDecision, RecommendationSpecialist
from agent.recommendation_schemas import RecommendationArguments
from agent.lv4.critic_specialist import CriticSpecialist
from agent.lv4.arbitrator_specialist import ArbitratorSpecialist
from chat_persistence_service import ChatPersistenceContext, ChatPersistenceStart


def decision(primary='10분 쉬어보세요.'):
    """과거 eval 대신 동일한 typed fake를 사용하며 전달된 근거만 참조합니다."""
    def reasoner(context, evidence):
        """실제 Specialist 계약은 유지하고 외부 모델 호출만 대체합니다."""
        return RecommendationDecision(recommendation=RecommendationArguments(
            primary_action=primary, rationale='현재 대화 선택을 도울 수 있습니다.',
            confidence=.6, recommendation_kind='direct'),
            used_evidence_refs=[item.evidence_ref for item in evidence],
            needs_user_input=False, input_question=None)
    return reasoner


def empty_bridge(*args):
    """합성 read provider로 실제 Bridge 계약을 사용합니다. DB/원문 history를 읽지 않습니다."""
    return Lv4ContextBridge(ContextProviders(**{name: lambda *args: [] for name in
        ('memory', 'emotion', 'body', 'cognitive', 'schedule', 'relationship', 'place')}))


def fake_pipeline(text, failure=None):
    """실제 네 Specialist를 사용하되 자연어 생성만 결정론적 fake로 바꿉니다."""
    agents = [StateSpecialist(), RecommendationSpecialist(decision('10분 쉬어보세요.')),
              CriticSpecialist(), ArbitratorSpecialist()]
    if failure:
        agents[['state', 'recommendation', 'critic', 'arbitrator'].index(failure)].run = Mock(
            side_effect=RuntimeError('PRIVATE_RAW_SECRET'))
    return Lv4CollaborationPipeline(state_agent=agents[0], recommendation_agent=agents[1],
        critic_agent=agents[2], arbitrator_agent=agents[3]), None


@contextmanager
def chat_fixture(*, enabled=True, cached=None, persisted=True):
    """실제 /chat route를 호출하며 production 분석/API/DB 쓰기만 고정합니다."""
    context = ChatPersistenceContext(user_id=uuid4(), conversation_id=uuid4(),
        request_id=uuid4(), user_message_id=uuid4())
    view = {'primary_axis': {'like': 'Mid', 'dislike': 'Low'},
        'emotion_axis': {axis: 'Low' for axis in 'FADJCGTR'}, 'state_summary': '기존 상태 요약'}
    analysis = {'input': '합성 입력', 'user_view': view, 'admin_view': {
        'primary_axis': {'like': .4, 'dislike': .1},
        'emotion_axis': {axis: .1 for axis in 'FADJCGTR'}}, 'source': 'rule_based'}
    with ExitStack() as stack:
        # Phase 9.2부터 ON 검사도 전용 UUID를 명시해야 합니다. 실제 운영 설정은 변경하지 않습니다.
        stack.enter_context(patch.dict(os.environ, {'NOIE_LV4_SHADOW_ENABLED': 'true' if enabled else 'false',
            'NOIE_LV4_SHADOW_ALLOWLIST': str(context.user_id),
            'NOIE_LV4_SHADOW_REQUEST_ALLOWLIST': str(context.request_id)}))
        # 기존 DB fake는 활성 계정을 전제합니다. 실제 차단은 별도 SQLite 보안 검사에서 검증합니다.
        stack.enter_context(patch.object(shadow, 'require_active_chat_user', return_value=None))
        mocks = {}
        overrides = {'begin_chat_request': ChatPersistenceStart(context=context, cached_response=cached),
            'retrieve_relevant_memories_safe': [], 'analyze_text': (analysis, 'rule_based'),
            'generate_chat_reply_with_openai': '기존 production 답변', 'prepare_chat_recommendation': (None, None),
            'complete_chat_request': persisted, 'run_memory_extraction_background': None,
            'run_chat_agent_integration': None}
        for name, value in overrides.items():
            mocks[name] = stack.enter_context(patch.object(main, name, return_value=value))
        yield context, mocks


class ShadowTests(unittest.TestCase):
    """기존 production 응답과 신규 관찰자의 격리를 검증합니다."""

    def call_chat(self, *, failure=None, worker=None, enabled=True, text='지금 개발할까 쉴까?'):
        """HTTP response와 안전한 진단만 수집합니다."""
        with chat_fixture(enabled=enabled) as (context, mocks), redirect_stdout(StringIO()) as output, \
             patch.object(shadow, '_make_bridge', side_effect=empty_bridge), \
             patch.object(shadow, '_make_pipeline', side_effect=lambda text: fake_pipeline(text, failure)) as factory:
            with ExitStack() as stack:
                if worker:
                    stack.enter_context(patch.object(shadow, 'run_shadow', worker))
                response = TestClient(main.app).post('/chat', json={'text': text, 'request_id': str(context.request_id)})
            return response, mocks, factory.call_count, output.getvalue()

    def test_default_off(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(shadow.shadow_enabled())

    def test_invalid_flag_off(self):
        with patch.dict(os.environ, {'NOIE_LV4_SHADOW_ENABLED': 'random'}):
            self.assertFalse(shadow.shadow_enabled())

    def test_off_chat_no_pipeline(self):
        response, mocks, count, output = self.call_chat(enabled=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(count, 0)
        self.assertNotIn('lv4_shadow', output)
        mocks['complete_chat_request'].assert_called_once()

    def test_on_chat_original_reply_and_persistence(self):
        response, mocks, count, output = self.call_chat()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reply'], '기존 production 답변')
        self.assertNotIn('shadow', response.json())
        self.assertEqual(count, 1)
        self.assertIn('completed', output)
        self.assertEqual(mocks['complete_chat_request'].call_args.args[1], response.json()['reply'])

    def test_off_on_same_response_shape(self):
        off = self.call_chat(enabled=False)[0].json()
        on = self.call_chat()[0].json()
        for result in (off, on):
            result.pop('request_id')
            result.pop('conversation_id')
        self.assertEqual(off, on)

    def test_state_failure(self):
        self.assert_failure('state')

    def test_recommendation_failure(self):
        self.assert_failure('recommendation')

    def test_critic_failure(self):
        self.assert_failure('critic')

    def test_arbitrator_failure(self):
        self.assert_failure('arbitrator')

    def assert_failure(self, stage):
        """각 stage 오류가 실제 HTTP 응답과 저장 reply를 변경하지 않음을 확인합니다."""
        response, _, count, output = self.call_chat(failure=stage)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reply'], '기존 production 답변')
        self.assertEqual(count, 1)
        self.assertIn('failed', output)
        self.assertNotIn('PRIVATE_RAW_SECRET', output)

    def test_unexpected_factory_failure(self):
        self.assert_worker_failure(RuntimeError('PRIVATE_RAW_SECRET'))

    def test_timeout(self):
        self.assert_worker_failure(TimeoutError('PRIVATE_RAW_SECRET'))

    def test_openai_exception(self):
        import httpx
        from openai import APIConnectionError
        self.assert_worker_failure(APIConnectionError(message='PRIVATE_RAW_SECRET',
            request=httpx.Request('POST', 'https://api.openai.com/v1/responses')))

    def assert_worker_failure(self, error):
        """실제 worker의 최상위 격리 경계를 검사합니다."""
        with chat_fixture() as (context, _), patch.object(shadow, '_make_bridge', side_effect=error), \
             redirect_stdout(StringIO()) as output:
            response = TestClient(main.app).post('/chat', json={'text': '합성 비공개 입력', 'request_id': str(context.request_id)})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('PRIVATE_RAW_SECRET', output.getvalue())
        self.assertNotIn('합성 비공개 입력', output.getvalue())

    def test_malformed_result(self):
        with chat_fixture() as (context, _), patch.object(shadow, '_make_bridge', side_effect=empty_bridge), \
             patch.object(shadow, '_make_pipeline', return_value=(SimpleNamespace(run=lambda *args, **kwargs: {}), None)), \
             redirect_stdout(StringIO()) as output:
            response = TestClient(main.app).post('/chat', json={'text': '뭐부터 할까?', 'request_id': str(context.request_id)})
        self.assertEqual(response.status_code, 200)
        self.assertIn('FAILED', output.getvalue())

    def test_provider_partial(self):
        def broken(*args):
            raise RuntimeError('PRIVATE_RAW_SECRET')
        bridge = Lv4ContextBridge(ContextProviders(emotion=broken))
        with patch.object(shadow, '_make_bridge', return_value=bridge), \
             patch.object(shadow, 'require_active_chat_user', return_value=None), \
             patch.object(shadow, '_make_pipeline', side_effect=fake_pipeline), redirect_stdout(StringIO()) as output:
            result = shadow.run_shadow(user_id=uuid4(), text='지금 개발할까 쉴까?', memories=(), correlation='test')
        self.assertEqual(result['bridge_status'], 'PARTIAL')
        self.assertEqual(result['provider_statuses']['emotion'], 'failed')
        self.assertEqual(result['pipeline_status'], 'COMPLETED')
        self.assertNotIn('PRIVATE_RAW_SECRET', output.getvalue())

    def test_explicit_decision_no_openai(self):
        with patch('agent.lv4.recommendation_adapter.OpenAI', side_effect=AssertionError('unexpected API')), \
             patch.object(shadow, 'require_active_chat_user', return_value=None), \
             patch.object(shadow, '_make_bridge', side_effect=empty_bridge), redirect_stdout(StringIO()):
            result = shadow.run_shadow(user_id=uuid4(), text='오늘 집에서 쉬기로 했어.', memories=(), correlation='test')
        self.assertEqual(result['arbitrator_status'], 'NO_RECOMMENDATION')

    def test_schedule_raw_text_preserved(self):
        tasks = BackgroundTasks()
        raw = '  지금 개발할까 쉴까?  '
        with chat_fixture() as (context, _):
            shadow.schedule_shadow(tasks, context=context, text=raw, memories=[])
        self.assertEqual(tasks.tasks[0].kwargs['text'], raw)

    def test_scheduling_error_isolated(self):
        with chat_fixture(), redirect_stdout(StringIO()) as output:
            shadow.schedule_shadow(Mock(), context=object(), text='secret', memories=[])
        self.assertIn('scheduling_failed', output.getvalue())
        self.assertNotIn('secret', output.getvalue())

    def test_logging_failure_isolated(self):
        with patch('builtins.print', side_effect=OSError('log unavailable')):
            shadow._emit('failed', {})

    def test_duplicate_cached_no_worker(self):
        original = self.call_chat()[0].json()
        with chat_fixture(cached=original) as (context, mocks), patch.object(shadow, 'run_shadow') as worker:
            response = TestClient(main.app).post('/chat', json={'text': '동일 입력', 'request_id': str(context.request_id)})
        self.assertEqual(response.json(), original)
        worker.assert_not_called()
        mocks['complete_chat_request'].assert_not_called()

    def test_new_uuid_same_text_runs_again(self):
        first = self.call_chat()
        second = self.call_chat()
        self.assertEqual((first[2], second[2]), (1, 1))
        self.assertNotEqual(first[0].json()['request_id'], second[0].json()['request_id'])

    def test_unsaved_request_no_shadow(self):
        with chat_fixture(persisted=False) as (context, _), patch.object(shadow, 'run_shadow') as worker:
            response = TestClient(main.app).post('/chat', json={'text': '뭐부터 할까?', 'request_id': str(context.request_id)})
        self.assertEqual(response.status_code, 200)
        worker.assert_not_called()

    def test_no_gateway_executor_or_session_writes(self):
        # Shadow가 쓰기 계층을 호출하면 즉시 실패하게 합니다. production 기존 쓰기는 fixture로 분리됩니다.
        from sqlalchemy.orm import Session
        with patch('agent.tool_gateway.create_tool_plan') as gateway, \
             patch('agent.executor_service.execute_action') as executor, \
             patch.object(Session, 'add', side_effect=AssertionError('DB write')), \
             patch.object(Session, 'commit', side_effect=AssertionError('DB write')), \
             patch.object(Session, 'flush', side_effect=AssertionError('DB write')):
            response, _, count, output = self.call_chat()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(count, 1)
        self.assertIn('completed', output)
        gateway.assert_not_called()
        executor.assert_not_called()
        # observer 자체가 Gateway/Executor를 import하거나 호출하는 경로도 금지합니다.
        import inspect
        source = inspect.getsource(shadow)
        self.assertNotIn('from agent.gateway', source)
        self.assertNotIn('from agent.executor', source)
        self.assertNotIn('agent_actions', source)

    def test_real_provider_read_only_and_closed_before_pipeline(self):
        # 실제 provider factory를 사용하고 DB 객체만 fake로 둡니다. SQL/세션 lifecycle을 검사합니다.
        db = Mock()
        db.__enter__ = Mock(return_value=db)
        db.__exit__ = Mock()
        session = Mock(return_value=db)
        with patch('database.SessionLocal', session), \
             patch.object(shadow, 'require_active_chat_user', return_value=None), \
             patch('agent.lv4.read_providers.list_emotion_events', return_value=[]), \
             patch('agent.lv4.read_providers.list_body_state_events', return_value=[]), \
             patch('agent.lv4.read_providers.list_cognitive_state_events', return_value=[]), \
             patch('agent.lv4.read_providers.list_relationship_events', return_value=[]), \
             patch.object(shadow, '_make_pipeline', side_effect=fake_pipeline), redirect_stdout(StringIO()):
            # Schedule 조회도 빈 scalar 결과로 반환해 실제 읽기 전용 SQL 경계를 통과시킵니다.
            db.scalars.return_value.all.return_value = []
            result = shadow.run_shadow(user_id=uuid4(), text='지금 개발할까 쉴까?', memories=(), correlation='test')
        self.assertEqual(result['pipeline_status'], 'COMPLETED')
        self.assertGreaterEqual(db.execute.call_count, 3)
        self.assertTrue(all(str(call.args[0]) == 'SET TRANSACTION READ ONLY' for call in db.execute.call_args_list))
        self.assertEqual(db.__exit__.call_count, session.call_count)
        db.add.assert_not_called()
        db.flush.assert_not_called()
        db.commit.assert_not_called()

    def test_diagnostic_failure_isolated(self):
        with patch('agent.lv4.failure_diagnostics.diagnose', side_effect=RuntimeError('secret')):
            self.assert_worker_failure(RuntimeError('PRIVATE_RAW_SECRET'))

    def test_validation_long_raw_message_isolated(self):
        response, _, _, output = self.call_chat(text='가' * 501)
        self.assertEqual(response.status_code, 200)
        self.assertIn('FAILED', output)
        self.assertNotIn('가' * 501, output)

    def test_sdk_timeout_and_no_retry(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'synthetic-test-key'}), patch('openai.OpenAI') as sdk:
            _, client = shadow._make_pipeline('지금 개발할까 쉴까?')
        sdk.assert_called_once_with(timeout=60, max_retries=0)
        self.assertIs(client, sdk.return_value)

    def test_response_body_precedes_blocking_shadow(self):
        """TestClient 총시간이 아니라 ASGI body 전송과 background 완료 순서를 측정합니다."""
        release = threading.Event()
        def blocked(**kwargs):
            release.wait(5)
        async def request():
            sent = asyncio.Event()
            messages = []
            body = json.dumps({'text': '뭐부터 할까?', 'request_id': str(context.request_id)}).encode()
            async def receive():
                return {'type': 'http.request', 'body': body, 'more_body': False}
            async def send(message):
                messages.append(message)
                if message['type'] == 'http.response.body' and not message.get('more_body'):
                    sent.set()
            scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                'method': 'POST', 'scheme': 'http', 'path': '/chat', 'raw_path': b'/chat',
                'query_string': b'', 'headers': [(b'content-type', b'application/json')],
                'server': ('test', 80), 'client': ('test', 123)}
            task = asyncio.create_task(main.app(scope, receive, send))
            try:
                await asyncio.wait_for(sent.wait(), 2)
                self.assertFalse(task.done())
                self.assertEqual(messages[0]['status'], 200)
                self.assertEqual(json.loads(messages[1]['body'])['reply'], '기존 production 답변')
            finally:
                release.set()
                await task
        with chat_fixture() as (context, _), patch.object(shadow, 'run_shadow', side_effect=blocked):
            asyncio.run(request())


if __name__ == '__main__':
    unittest.main()
