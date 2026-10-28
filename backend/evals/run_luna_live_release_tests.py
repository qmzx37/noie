"""Offline Luna contracts on the existing Live backend, without newer features."""
import importlib
import json
import os
from contextlib import ExitStack
from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import UUID

import resource_budget as budget
from memory_schemas import MemoryExtractionDecision, MemoryRetrievalCandidate

SOURCE = "나는 장기적으로 개인 AI를 만들고 싶어."
DECISION = dict(should_remember=True, reason="Explicit synthetic goal", content=SOURCE,
                kind="goal", importance=70, confidence=.9)
KEYS = ('OPENAI_MODEL','OPENAI_MEMORY_MODEL','OPENAI_AGENT_MODEL',
        'OPENAI_MEMORY_EXTRACTION_MODEL','OPENAI_MEMORY_EXTRACTION_REASONING_EFFORT')
MODULES = ('openai_analyzer','memory_extractor','memory_retriever','memory_reconciler',
           'daily_trace_analyzer','agent.orchestrator','agent.lv4.recommendation_adapter')
EFFORT = {role: ('medium' if role in {'save_gate','extraction','reconciliation','lv3','lv4'} else 'low')
          for role in ('emotion','title','save_gate','chat','project_chat','daily_trace','extraction',
                       'retrieval','reconciliation','routing','relationship','lv3','lv4')}


class Dispatched(RuntimeError):
    pass


def fake_client(response=None, error=None):
    sdk = SimpleNamespace(max_retries=2, responses=SimpleNamespace(create=Mock(return_value=response, side_effect=error)),
                          close=Mock())
    sdk.with_options = Mock(return_value=sdk)
    return sdk


def invoke(role):
    import openai_analyzer as general
    import memory_extractor as extraction
    import memory_retriever as retrieval
    import memory_reconciler as reconciliation
    from agent.orchestrator import orchestrate_with_openai
    if role == 'emotion':
        return general.analyze_with_openai('오늘 기분이 좋아.')
    if role == 'title':
        return general.generate_title_with_openai(SOURCE)
    if role == 'save_gate':
        return general.generate_save_decision_with_openai(SOURCE, {})
    if role == 'chat':
        return general.generate_chat_reply_with_openai(SOURCE,'unknown',{})
    if role == 'project_chat':
        return general.generate_project_chat_reply_with_checkpoint_openai(SOURCE,'unknown',{}, {})
    if role == 'daily_trace':
        return importlib.import_module('daily_trace_analyzer').extract_daily_trace_with_openai('운동 완료했어.','2026-10-27')
    if role == 'extraction':
        return extraction.extract_memory_with_openai(SOURCE)
    if role == 'retrieval':
        return retrieval.select_relevant_memories('내 목표를 알려 줘.',[MemoryRetrievalCandidate(
            memory_id=UUID(int=11),content=SOURCE,kind='goal',importance=70,confidence=.9)])
    if role == 'reconciliation':
        return reconciliation.reconcile_memory_candidate(MemoryExtractionDecision(**DECISION),
            [dict(id=str(UUID(int=12)),content='A separate synthetic project',kind='project')])
    if role in ('routing','relationship'):
        return orchestrate_with_openai(SOURCE,relationship_only=role=='relationship')
    if role == 'lv3':
        from agent.recommendation_schemas import RecommendationContext
        return orchestrate_with_openai('공부할까 운동할까?',recommendation_context=RecommendationContext(
            as_of=datetime(2026,10,27,tzinfo=timezone.utc)))
    if role == 'lv4':
        from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
        from agent.lv4.recommendation_context import RecommendationContext
        return OpenAIRecommendationAdapter()(RecommendationContext(current_utterance='공부할까 운동할까?',
            reference_time=datetime(2026,10,27,tzinfo=timezone.utc)),[])
    raise AssertionError(role)


class LunaLiveReleaseTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ,{'OPENAI_API_KEY':'SYNTHETIC_MOCK_ONLY'}))
        for key in KEYS:
            os.environ.pop(key,None)
        self.modules = [importlib.import_module(name) for name in MODULES]

    def sdk(self, client):
        self.stack.enter_context(patch('openai.OpenAI',return_value=client))
        for module in self.modules:
            if hasattr(module,'OpenAI'):
                self.stack.enter_context(patch.object(module,'OpenAI',return_value=client))

    def test_extraction_override_and_medium(self):
        client = fake_client(error=Dispatched())
        self.sdk(client)
        with patch.dict(os.environ,OPENAI_MODEL='synthetic-global',OPENAI_MEMORY_MODEL='synthetic-memory',
            OPENAI_MEMORY_EXTRACTION_MODEL='gpt-6-luna',OPENAI_MEMORY_EXTRACTION_REASONING_EFFORT='medium'):
            with self.assertRaises(Dispatched):
                invoke('extraction')
        sent = client.responses.create.call_args.kwargs
        self.assertEqual(sent['model'],'gpt-6-luna')
        self.assertEqual(sent['reasoning'],{'effort':'medium'})
        self.assertEqual(sent['input'][1]['content'],SOURCE)

    def test_wrong_extraction_setting_fails_before_dispatch(self):
        client = fake_client()
        self.sdk(client)
        for settings in ({'OPENAI_MEMORY_EXTRACTION_MODEL':'other'},
                         {'OPENAI_MEMORY_EXTRACTION_MODEL':'gpt-6-luna','OPENAI_MEMORY_EXTRACTION_REASONING_EFFORT':'high'}):
            with patch.dict(os.environ,settings),self.assertRaises(ValueError):
                invoke('extraction')
        client.responses.create.assert_not_called()

    def test_six_fields_and_source_preserved(self):
        client = fake_client(SimpleNamespace(status='completed',output_text=json.dumps(DECISION)))
        self.sdk(client)
        result = invoke('extraction')
        self.assertEqual(result.model_dump(),DECISION)
        sent = client.responses.create.call_args.kwargs
        self.assertEqual(set(sent['text']['format']['schema']['properties']),set(DECISION))
        self.assertFalse(sent['text']['format']['schema']['additionalProperties'])

    def test_incomplete_empty_and_invalid_schema_do_not_become_memory(self):
        for response, expected in ((SimpleNamespace(status='incomplete',output_text=json.dumps(DECISION)),budget.ResourceBudgetExceeded),
                                   (SimpleNamespace(status='completed',output_text=''),ValueError),
                                   (SimpleNamespace(status='completed',output_text='{}'),ValueError)):
            with self.subTest(state=response.status,text=response.output_text):
                client = fake_client(response)
                self.sdk(client)
                with self.assertRaises(expected):
                    invoke('extraction')
                client.responses.create.assert_called_once()

    def test_secret_source_stops_before_client(self):
        import memory_extractor
        with patch.object(memory_extractor,'OpenAI') as sdk:
            result = memory_extractor.extract_memory_with_openai('My password is SYNTHETIC_NOT_A_CREDENTIAL')
        self.assertFalse(result.should_remember)
        sdk.assert_not_called()

    def test_unexpected_native_function_call_is_not_executed(self):
        response = SimpleNamespace(status='completed',output_text='',output=[SimpleNamespace(
            type='function_call',name='create_schedule',call_id='synthetic-call',arguments='{}')])
        for role in ('chat','extraction','routing'):
            with self.subTest(role=role):
                client = fake_client(response)
                self.sdk(client)
                with self.assertRaises(ValueError):
                    invoke(role)
                client.responses.create.assert_called_once()

    def test_no_native_tools_history_fanout(self):
        client = fake_client()
        for key in ('tools','previous_response_id','conversation','background','stream'):
            with self.subTest(key=key),self.assertRaises(budget.ResourceBudgetExceeded):
                budget.create_model_response(client,model='gpt-6-luna',input='synthetic',**{key:True})
        client.responses.create.assert_not_called()

    def test_small_cap_floor_is_reserved_before_dispatch(self):
        client = fake_client(SimpleNamespace(status='completed',output_text='{}'))
        with budget.model_budget_scope() as current:
            budget.create_model_response(client,model='gpt-6-luna',input='synthetic',max_output_tokens=128)
            self.assertEqual(current.output_tokens,2048)
            self.assertEqual(current.calls,1)
        self.assertEqual(client.responses.create.call_args.kwargs['max_output_tokens'],2048)

    def test_global_caps_and_no_high_escalation(self):
        self.assertEqual(budget.MAX_OUTPUT_TOKENS,8192)
        self.assertEqual(budget.MAX_MODEL_CALLS,24)
        self.assertEqual(budget.MAX_TOTAL_OUTPUT_TOKENS,196608)
        client = fake_client()
        for options in ({'reasoning_effort':'high'},{'reasoning':{'effort':'medium','mode':'pro'}},
                        {'reasoning_effort':'low','reasoning':{'effort':'medium'}}):
            with self.subTest(options=options),self.assertRaises(budget.ResourceBudgetExceeded):
                budget.create_model_response(client,model='gpt-6-luna',input='synthetic',**options)
        client.responses.create.assert_not_called()

    def test_existing_explicit_other_model_keeps_small_cap(self):
        client = fake_client(SimpleNamespace(status='completed',output_text='{}'))
        budget.create_model_response(client,model='synthetic-other',input='synthetic',reasoning_effort='low',max_output_tokens=128)
        self.assertNotIn('reasoning',client.responses.create.call_args.kwargs)
        self.assertEqual(client.responses.create.call_args.kwargs['max_output_tokens'],128)


def wire_test(role,explicit=False,timeout=False):
    def test(self):
        if explicit:
            os.environ.update(OPENAI_MODEL='synthetic-global',OPENAI_MEMORY_MODEL='synthetic-memory',OPENAI_AGENT_MODEL='synthetic-agent')
        client = fake_client(error=TimeoutError('synthetic timeout') if timeout else Dispatched())
        self.sdk(client)
        with self.assertRaises(TimeoutError if timeout else Dispatched):
            invoke(role)
        client.responses.create.assert_called_once()
        client.with_options.assert_called_once_with(max_retries=0,timeout=60.0)
        sent = client.responses.create.call_args.kwargs
        self.assertNotIn('reasoning_effort',sent)
        if explicit:
            group = 'agent' if role in {'routing','relationship','lv3','lv4'} else 'memory' if role in {'extraction','retrieval','reconciliation'} else 'global'
            self.assertEqual(sent['model'],'synthetic-'+group)
            self.assertNotIn('reasoning',sent)
        else:
            self.assertEqual(sent['model'],'gpt-6-luna')
            self.assertEqual(sent['reasoning'],{'effort':EFFORT[role]})
        self.assertEqual(sent['max_output_tokens'],8192)
        if role not in {'title','chat'}:
            self.assertEqual(sent['text']['format']['type'],'json_schema')
            self.assertTrue(sent['text']['format']['strict'])
        self.assertNotIn('tools',sent)
    return test


for role in EFFORT:
    for label,options in (('luna',{}),('override',{'explicit':True}),('timeout',{'timeout':True})):
        setattr(LunaLiveReleaseTests,'test_wire_'+role+'_'+label,wire_test(role,**options))
