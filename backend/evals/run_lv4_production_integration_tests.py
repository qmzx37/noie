"""실제 /chat의 최종 reply 연결을 검사합니다. DB/SDK 경계만 fake이며 LIVE 평가는 아닙니다."""

import json
import os
import unittest
from contextlib import ExitStack, contextmanager, redirect_stdout
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

import main
import lv4_production_service as production
from agent.lv4.context_bridge import ContextProviders, Lv4ContextBridge, SOURCES
from agent.lv4.recommendation_specialist import RecommendationDecision
from agent.recommendation_schemas import RecommendationArguments
from evals.chat_test_fixture import chat_fixture
from schemas import AnalyzeEmotionResponse, ChatRequest, ChatResponse
from resource_budget import MAX_MODEL_CALLS, model_budget_scope

QUESTION = "지금 개발할까 쉴까?"
CHOICE = "잠깐 쉬어볼까요?"
LEGACY = "기존 production 답변\n\n기존 Lv3 추천"


class Reasoner:
    """현재 발화와 전달된 근거만 참조하는 합성 생성기입니다. 실제 네 Specialist는 그대로 실행합니다."""

    def __init__(self):
        self.calls = []

    def __call__(self, context, evidence):
        """해석 신뢰도/근거를 기존 계약으로 반환하고 외부 호출이나 쓰기는 하지 않습니다."""
        self.calls.append((context, evidence))
        return RecommendationDecision(recommendation=RecommendationArguments(
            primary_action=CHOICE, rationale="현재 선택 질문에 기반한 후보입니다.",
            confidence=0.7, recommendation_kind="direct",
        ), used_evidence_refs=[item.evidence_ref for item in evidence][:12])


def empty_bridge(owner, memories):
    """소유권과 필터링은 기존 Bridge에 맡깁니다. 실제 PostgreSQL에는 연결하지 않습니다."""
    providers = {name: lambda *args: [] for name in SOURCES}
    providers["memory"] = lambda *args: list(memories)
    return Lv4ContextBridge(ContextProviders(**providers))


@contextmanager
def production_fixture(*, flag="true", cached=None):
    """실제 HTTP 경로에서 legacy 답변/저장 경계만 고정합니다. 운영 환경변수는 바꾸지 않습니다."""
    with patch.dict(os.environ, {"NOIE_LV4_PRODUCTION_ENABLED": flag}), \
            chat_fixture(enabled=False, cached=cached) as (context, mocks), ExitStack() as stack:
        mocks["prepare_chat_recommendation"].return_value = (None, "기존 Lv3 추천")
        reasoner = Reasoner()
        owner = stack.enter_context(patch.object(production, "require_active_chat_user"))
        bridge = stack.enter_context(patch.object(production, "_make_bridge", side_effect=empty_bridge))
        adapter = stack.enter_context(patch.object(production, "OpenAIRecommendationAdapter", return_value=reasoner))
        yield context, mocks, reasoner, owner, bridge, adapter


class ProductionIntegrationTests(unittest.TestCase):
    """함수 호출 여부뿐 아니라 응답 문자열/저장값/duplicate/권한/개인정보 경계를 검증합니다."""

    def send(self, context, text=QUESTION, **fields):
        """TestClient는 실제 FastAPI serialization/background 경로를 사용하며 외부 업무만 mock입니다."""
        return TestClient(main.app).post("/chat", json={"text": text, "request_id": str(context.request_id), **fields})

    def test_completed_pipeline_changes_final_reply(self):
        with production_fixture() as (context, mocks, reasoner, *_), redirect_stdout(StringIO()) as logs:
            response = self.send(context)
        self.assertEqual(response.status_code, 200)
        reply = response.json()["reply"]
        self.assertIn("선택 후보: " + CHOICE, reply)
        self.assertNotIn("기존 production 답변", reply)
        self.assertNotIn("기존 Lv3 추천", reply)
        self.assertEqual(len(reasoner.calls), 1)
        mocks["complete_chat_request"].assert_called_once()
        self.assertEqual(mocks["complete_chat_request"].call_args.args[1], reply)
        self.assertEqual(mocks["complete_chat_request"].call_args.args[2], "lv4")
        self.assertIn('"outcome": "adopted"', logs.getvalue())

    def test_api_contract_and_analysis_unchanged(self):
        with production_fixture() as (context, mocks, *_):
            body = self.send(context).json()
        self.assertEqual(set(body), set(ChatResponse.model_fields))
        validated = ChatResponse.model_validate(body)
        self.assertEqual(validated.analysis, AnalyzeEmotionResponse.model_validate(mocks["analyze_text"].return_value[0]))
        self.assertEqual(body["source"], "rule_based")
        self.assertIsNone(body["checkpoint_draft"])
        self.assertEqual(body["conversation_id"], str(context.conversation_id))
        self.assertEqual(body["request_id"], str(context.request_id))
        self.assertFalse(set(body) & {"evidence", "confidence", "arbitrator_opinion", "lv4_result"})

    def test_missing_result_falls_back(self):
        with production_fixture() as (context, mocks, *_), patch.object(production, "_run_pipeline", return_value=None):
            response = self.send(context)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)
        self.assertEqual(mocks["complete_chat_request"].call_args.args[2], "openai")

    def test_pipeline_exception_falls_back(self):
        with production_fixture() as (context, mocks, *_), \
                patch.object(production, "_run_pipeline", side_effect=RuntimeError("PRIVATE_EXCEPTION")), \
                redirect_stdout(StringIO()) as logs:
            response = self.send(context)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)
        mocks["complete_chat_request"].assert_called_once()
        self.assertNotIn("PRIVATE_EXCEPTION", logs.getvalue())

    def test_invalid_incomplete_results_fall_back(self):
        for result in ({}, {"pipeline_status": "COMPLETED"}, "PRIVATE_RAW_OUTPUT", SimpleNamespace()):
            with self.subTest(result_type=type(result).__name__), production_fixture() as (context, _, *_), \
                    patch.object(production, "_run_pipeline", return_value=result):
                self.assertEqual(self.send(context).json()["reply"], LEGACY)

    def test_specialist_reported_failure_falls_back(self):
        with production_fixture() as (context, _, *_), \
                patch.object(production.CriticSpecialist, "run", side_effect=ValueError("PRIVATE_CRITIC_ERROR")):
            self.assertEqual(self.send(context).json()["reply"], LEGACY)

    def test_bridge_failure_falls_back(self):
        with production_fixture() as (context, _, _, _, bridge, _):
            bridge.side_effect = RuntimeError("PRIVATE_BRIDGE_ERROR")
            self.assertEqual(self.send(context).json()["reply"], LEGACY)

    def test_no_recommendation_result_falls_back(self):
        with production_fixture() as (context, _, _, _, _, adapter):
            adapter.return_value = lambda *args: RecommendationDecision(recommendation=None)
            self.assertEqual(self.send(context).json()["reply"], LEGACY)

    def test_needs_input_result_falls_back(self):
        with production_fixture() as (context, _, _, _, _, adapter):
            adapter.return_value = lambda *args: RecommendationDecision(recommendation=None,
                used_evidence_refs=["current"], needs_user_input=True, input_question="선택지는 무엇인가요?")
            self.assertEqual(self.send(context).json()["reply"], LEGACY)

    def test_flag_off_or_invalid_no_private_context(self):
        for flag in ("", "false", "0", "enabled", "true!"):
            with self.subTest(flag=flag), production_fixture(flag=flag) as (context, _, _, owner, bridge, adapter):
                self.assertEqual(self.send(context).json()["reply"], LEGACY)
                owner.assert_not_called()
                bridge.assert_not_called()
                adapter.assert_not_called()

    def test_unset_flag_is_off(self):
        with production_fixture() as (context, _, _, owner, bridge, _):
            os.environ.pop("NOIE_LV4_PRODUCTION_ENABLED", None)
            self.assertEqual(self.send(context).json()["reply"], LEGACY)
            owner.assert_not_called()
            bridge.assert_not_called()

    def test_flag_on_values(self):
        for flag in ("1", "true", "yes", "on", " TRUE ", " On "):
            with self.subTest(flag=flag), production_fixture(flag=flag) as (context, _, *_):
                self.assertIn(CHOICE, self.send(context).json()["reply"])

    def test_casual_and_settled_utterances_do_not_load_context(self):
        for text in ("오늘 기분 좋아.", "광안리 다녀왔어.", "내일 3시에 수업 있어.", "오늘은 집에서 쉬기로 했어."):
            with self.subTest(text=text), production_fixture() as (context, _, _, owner, bridge, adapter):
                self.assertEqual(self.send(context, text).json()["reply"], LEGACY)
                owner.assert_not_called()
                bridge.assert_not_called()
                adapter.assert_not_called()

    def test_project_contract_excluded(self):
        with production_fixture() as (context, mocks, _, _, bridge, _), \
                patch.object(main, "generate_project_chat_reply_with_checkpoint_openai", return_value={
                    "reply": "기존 project 답변", "checkpoint_draft": None}):
            body = self.send(context, is_project=True).json()
        self.assertEqual(body["reply"], "기존 project 답변\n\n기존 Lv3 추천")
        self.assertIsNone(body["checkpoint_draft"])
        bridge.assert_not_called()
        self.assertEqual(mocks["complete_chat_request"].call_args.args[2], "project")

    def test_missing_persistence_context_falls_back(self):
        with production_fixture() as (context, mocks, _, _, bridge, _):
            mocks["begin_chat_request"].return_value = SimpleNamespace(context=None, cached_response=None)
            body = self.send(context).json()
        self.assertEqual(body["reply"], "기존 production 답변")
        bridge.assert_not_called()

    def test_completed_duplicate_reuses_lv4_reply_without_calls(self):
        with production_fixture() as (context, mocks, reasoner, *_):
            first = self.send(context).json()
            mocks["begin_chat_request"].return_value = SimpleNamespace(context=context, cached_response=first)
            second = self.send(context).json()
        self.assertEqual(first, second)
        self.assertEqual(len(reasoner.calls), 1)
        mocks["complete_chat_request"].assert_called_once()
        mocks["run_memory_extraction_background"].assert_called_once()
        mocks["run_chat_agent_integration"].assert_called_once()

    def test_user_original_and_assistant_final_text_preserved(self):
        with production_fixture() as (context, mocks, *_):
            raw = "  " + QUESTION + "  \n"
            body = self.send(context, raw).json()
        mocks["begin_chat_request"].assert_called_once_with(raw, context.request_id)
        self.assertEqual(mocks["complete_chat_request"].call_args.args[1], body["reply"])
        self.assertEqual(mocks["complete_chat_request"].call_args.args[3]["reply"], body["reply"])

    def test_background_order_and_prepared_record_routing_preserved(self):
        trace = []
        routing = object()
        with production_fixture() as (context, mocks, *_):
            mocks["prepare_chat_recommendation"].return_value = (routing, "기존 Lv3 추천")
            mocks["run_memory_extraction_background"].side_effect = lambda *args: trace.append("memory")
            mocks["run_chat_agent_integration"].side_effect = lambda *args: trace.append("agent")
            self.send(context)
        self.assertEqual(trace, ["memory", "agent"])
        mocks["run_chat_agent_integration"].assert_called_once_with(context.user_message_id, context.request_id, routing)

    def test_privacy_logs_and_internal_fields_not_exposed(self):
        with production_fixture() as (context, _, *_), redirect_stdout(StringIO()) as logs:
            body = self.send(context).json()
        output = logs.getvalue()
        for secret in (QUESTION, str(context.user_id), str(context.request_id), str(context.user_message_id),
                       str(context.conversation_id), "recommendation_opinion", "confidence"):
            self.assertNotIn(secret, output)
        record = json.loads(next(line.split("lv4_production ", 1)[1] for line in output.splitlines() if "lv4_production " in line))
        self.assertEqual(record, {"event": "reply_selected", "outcome": "adopted", "reason": "valid_suggest"})
        self.assertNotIn("evidence_ref", body["reply"])

    def test_log_failure_does_not_change_reply(self):
        with production_fixture() as (context, _, *_), patch("builtins.print", side_effect=RuntimeError("PRIVATE_LOG_ERROR")):
            self.assertIn(CHOICE, self.send(context).json()["reply"])
        # JSON 표준 모듈 전체를 패치하면 HTTP/예산 코드도 고장납니다. 관측 모듈의 참조만 격리합니다.
        with production_fixture() as (context, _, *_), patch.object(production, "json", SimpleNamespace(
                dumps=Mock(side_effect=RuntimeError("PRIVATE_LOG_ERROR")))):
            self.assertIn(CHOICE, self.send(context).json()["reply"])

    def test_owner_rechecked_before_sdk_and_after_pipeline(self):
        with production_fixture() as (context, _, _, owner, *_):
            self.send(context)
        self.assertEqual(owner.call_count, 3)
        self.assertTrue(all(call.args == (context.user_id,) for call in owner.call_args_list))

    def test_deactivation_at_model_boundary_fails_closed(self):
        with production_fixture() as (context, mocks, reasoner, owner, *_), \
                patch.object(main, "mark_chat_request_failed") as failed:
            owner.side_effect = [None, LookupError("PRIVATE_ACCOUNT"), LookupError("PRIVATE_ACCOUNT")]
            response = self.send(context)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("PRIVATE_ACCOUNT", response.text)
        self.assertEqual(reasoner.calls, [])
        mocks["complete_chat_request"].assert_not_called()
        failed.assert_called_once_with(context)

    def test_memory_snapshot_bounded_and_filtered_before_generation(self):
        with production_fixture() as (context, mocks, reasoner, _, bridge, _):
            mocks["retrieve_relevant_memories_safe"].return_value = [SimpleNamespace(
                content="개발 관련 최소 근거", relevance=0.9, confidence=0.7, private_field="PRIVATE_DUMP",
            ) for _ in range(8)]
            self.send(context)
        snapshot = bridge.call_args.args[1]
        self.assertEqual(len(snapshot), 4)
        self.assertEqual(set(snapshot[0]), {"content", "relevance", "confidence"})
        request, evidence = reasoner.calls[0]
        self.assertEqual(request.memories, [])
        self.assertTrue(all(not hasattr(item, "private_field") for item in evidence))

    def test_evidence_confidence_and_risks_not_mutated_by_formatter(self):
        with production_fixture() as (context, _, *_), patch.object(production, "_run_pipeline", wraps=production._run_pipeline) as run:
            self.send(context)
            # 해당 입력으로 실제 pipeline을 다시 실행하되 새로운 도메인 쓰기/모델 통신은 없습니다.
            result = production._run_pipeline(run.call_args.args[0])
            before = result.model_dump()
            production.format_lv4_reply(result, QUESTION)
        self.assertEqual(result.model_dump(), before)
        self.assertTrue(result.recommendation_opinion.evidence)
        self.assertEqual(result.recommendation_opinion.confidence, 0.7)

    def test_no_user_id_or_lv4_body_authority_added(self):
        self.assertNotIn("user_id", ChatRequest.model_fields)
        self.assertNotIn("lv4_result", ChatRequest.model_fields)

    def test_unsupported_or_tampered_decision_falls_back(self):
        original_run = production._run_pipeline
        for mutation in ("execute", "other_domain", "no_choices", "other_utterance", "nan", "missing_arbitrator"):
            def tampered(context):
                """유효한 실제 결과에서 한 계약만 훼손합니다. 기대값은 항상 기존 reply입니다."""
                data = original_run(context).model_dump()
                final = data["arbitrator_opinion"]
                if mutation == "execute":
                    final["suggested_actions"][0]["mode"] = "execute"
                elif mutation == "other_domain":
                    final["suggested_actions"][0]["type"] = "emotion"
                elif mutation == "no_choices":
                    final["suggested_actions"] = []
                elif mutation == "other_utterance":
                    final["evidence"] = []
                elif mutation == "nan":
                    final["confidence"] = float("nan")
                else:
                    data["arbitrator_opinion"] = None
                return data

            with self.subTest(mutation=mutation), production_fixture() as (context, _, *_), \
                    patch.object(production, "_run_pipeline", side_effect=tampered):
                self.assertEqual(self.send(context).json()["reply"], LEGACY)

    def test_recent_domain_state_reaches_existing_pipeline(self):
        def state_bridge(owner, memories):
            """기존 DB provider가 반환하는 최소 관찰 형식만 주입합니다."""
            providers = {name: lambda *args: [] for name in SOURCES}
            providers["body"] = lambda owner, question, now: [{
                "user_id": owner, "energy": 0.2, "fatigue": 0.8, "confidence": 0.7, "observed_at": now}]
            return Lv4ContextBridge(ContextProviders(**providers))

        with production_fixture() as (context, _, reasoner, _, bridge, _):
            bridge.side_effect = state_bridge
            body = self.send(context).json()
        self.assertIn(CHOICE, body["reply"])
        request, evidence = reasoner.calls[0]
        self.assertIsNotNone(request.state_opinion)
        self.assertTrue(any(item.source_type == "state" and "fatigue=0.8" in item.summary for item in evidence))

    def test_current_choice_not_replaced_by_old_memory(self):
        with production_fixture() as (context, mocks, reasoner, *_):
            mocks["retrieve_relevant_memories_safe"].return_value = [SimpleNamespace(
                content="예전에 개발을 즐긴다고 했어", relevance=0.9, confidence=0.7)]
            body = self.send(context).json()
        self.assertIn(CHOICE, body["reply"])
        self.assertEqual(reasoner.calls[0][0].current_utterance, QUESTION)
        self.assertTrue(any(item.source_type == "utterance" and item.summary == QUESTION for item in reasoner.calls[0][1]))

    def test_real_structured_output_adapter_without_network(self):
        from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
        arguments = RecommendationArguments(primary_action=CHOICE, rationale="현재 선택 질문의 후보입니다.",
                                            confidence=0.7, recommendation_kind="direct")
        payload = {"needs_action": True, "actions": [{"type": "recommendation", "intent": "suggest_recommendation",
            "mode": "suggest", "reason": "현재 선택 질문", "confidence": 0.7, "requires_confirmation": False,
            "execution_order": 1, "arguments": arguments.model_dump()}], "used_evidence_refs": ["current"],
            "needs_user_input": False, "input_question": None}
        create = Mock(return_value=SimpleNamespace(status="completed", output_text=json.dumps(payload)))
        close = Mock()
        client = SimpleNamespace(responses=SimpleNamespace(create=create), close=close)
        with production_fixture() as (context, _, _, _, _, factory), \
                patch.dict(os.environ, {"OPENAI_API_KEY": "SYNTHETIC_TEST_KEY"}), \
                patch("agent.lv4.recommendation_adapter.OpenAI", return_value=client), model_budget_scope() as budget:
            factory.side_effect = OpenAIRecommendationAdapter
            body = self.send(context).json()
        self.assertIn(CHOICE, body["reply"])
        self.assertEqual(budget.calls, 1)
        create.assert_called_once()
        close.assert_called_once()
        self.assertEqual(create.call_args.kwargs["text"]["format"]["type"], "json_schema")
        self.assertTrue(create.call_args.kwargs["text"]["format"]["strict"])

    def test_model_budget_exhaustion_preserves_legacy_reply(self):
        from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
        create = Mock(side_effect=AssertionError("SDK_MUST_NOT_BE_CALLED"))
        client = SimpleNamespace(responses=SimpleNamespace(create=create), close=Mock())
        with production_fixture() as (context, _, _, _, _, factory), \
                patch.dict(os.environ, {"OPENAI_API_KEY": "SYNTHETIC_TEST_KEY"}), \
                patch("agent.lv4.recommendation_adapter.OpenAI", return_value=client), model_budget_scope() as budget:
            factory.side_effect = OpenAIRecommendationAdapter
            budget.calls = MAX_MODEL_CALLS
            self.assertEqual(self.send(context).json()["reply"], LEGACY)
        create.assert_not_called()

    def test_shadow_remains_separate_after_response_persistence(self):
        trace = []
        with production_fixture() as (context, mocks, *_), patch.object(main, "schedule_shadow") as shadow:
            mocks["complete_chat_request"].side_effect = lambda *a, **kw: trace.append("persist") or True
            shadow.side_effect = lambda *a, **kw: trace.append("shadow")
            self.send(context)
        self.assertEqual(trace, ["persist", "shadow"])
        self.assertEqual(shadow.call_args.kwargs["context"], context)


if __name__ == "__main__":
    unittest.main()
