"""로컬 /chat canary입니다. production 코드를 바꾸지 않고 DB/외부 모델 경계만 격리합니다."""

import argparse
import json
import os
import statistics
import time
import unittest
from contextlib import contextmanager, redirect_stdout
from dataclasses import replace
from io import StringIO
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

# 직접 실행도 실제 환경변수/네트워크/DB를 먼저 차단합니다. 전체 suite에서는 기존 격리 실행기를 씁니다.
if __name__ == "__main__":
    from evals.run_security_adversarial_verification import isolate
    isolate(legacy_fixtures=True)

from fastapi.testclient import TestClient
import main
import lv4_production_service as production
from agent.lv4.context_bridge import ContextProviders, Lv4ContextBridge, SOURCES
from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
from chat_persistence_service import ChatPersistenceStart
from evals.run_lv4_production_integration_tests import production_fixture, LEGACY
from resource_budget import model_budget_scope
from schemas import ChatResponse

QUESTION = "오늘 운동할까 개발할까?"
CHOICE = "가볍게 운동해볼까요?"
PRIVATE_MEMORY = "개발 관련 MEMORY_INTERNAL_CANARY 근거"
PRIVATE_DEBUG = "PRIVATE_DEBUG_CANARY_DO_NOT_EXPOSE"


def structured_payload():
    """실제 adapter가 파싱할 JSON입니다. 후보 생성은 합성이므로 LLM 의미 품질 평가가 아닙니다."""
    return {"needs_action": True, "actions": [{"type": "recommendation", "intent": "suggest_recommendation",
        "mode": "suggest", "reason": "현재 선택 질문", "confidence": 0.7,
        "requires_confirmation": False, "execution_order": 1, "arguments": {
            "primary_action": CHOICE, "alternative_action": None, "rationale": "현재 질문의 선택 후보입니다.",
            "confidence": 0.7, "recommendation_kind": "direct", "reassess_after_minutes": None,
        }}], "used_evidence_refs": ["current"], "needs_user_input": False, "input_question": None}


@contextmanager
def canary_fixture(*, flag="true", payload=None, model_status="completed", sdk_error=None):
    """Step 1 fixture와 실제 adapter를 재사용합니다. write sink는 DB 저장 인자 검사용 메모리 목록입니다."""
    saved = []
    selected = structured_payload() if payload is None else payload
    create = Mock(return_value=SimpleNamespace(status=model_status, output_text=json.dumps(selected)))
    if sdk_error is not None:
        create.side_effect = sdk_error
    client = SimpleNamespace(responses=SimpleNamespace(create=create), close=Mock())

    def persist(context, content, source, response, **kwargs):
        """원문과 API 응답의 동일성을 관찰할 뿐 SQLAlchemy commit 성공으로 주장하지 않습니다."""
        saved.append({"content": content, "source": source, "response": dict(response)})
        return True

    with production_fixture(flag=flag) as (context, mocks, _, owner, bridge, factory), \
            patch.dict(os.environ, {"OPENAI_API_KEY": "SYNTHETIC_CANARY_KEY"}), \
            patch("agent.lv4.recommendation_adapter.OpenAI", return_value=client), model_budget_scope() as budget:
        factory.side_effect = OpenAIRecommendationAdapter
        mocks["complete_chat_request"].side_effect = persist
        yield SimpleNamespace(context=context, mocks=mocks, owner=owner, bridge=bridge, factory=factory,
                              create=create, client=client, saved=saved, budget=budget)


def send(client, fixture, text=QUESTION):
    """실제 route/middleware/response_model을 거칩니다. 운영 URL이나 외부 서버를 호출하지 않습니다."""
    return client.post("/chat", json={"text": text, "request_id": str(fixture.context.request_id)})


def production_records(output):
    """기존 고정 telemetry만 읽습니다. 다른 업무 로그를 진단 자료로 재전송하지 않습니다."""
    prefix = "[noie] lv4_production "
    return [json.loads(line[len(prefix):]) for line in output.splitlines() if line.startswith(prefix)]


def observe_latency(samples=30):
    """워밍업 후 ON/OFF를 교대로 측정합니다. HTTP 모델/DB mock과 합성 background를 포함한 로컬 시간입니다."""
    measurements = {"off": [], "on": []}
    calls = {"off": [], "on": []}
    for index in range(samples + 3):
        # 동일한 순서의 환경 편향을 줄입니다. ON이 반드시 느려야 한다는 flaky assertion은 하지 않습니다.
        modes = ("off", "on") if index % 2 == 0 else ("on", "off")
        for mode in modes:
            with canary_fixture(flag="true" if mode == "on" else "false") as fixture, \
                    TestClient(main.app) as client, redirect_stdout(StringIO()):
                start = time.perf_counter()
                response = send(client, fixture)
                elapsed = (time.perf_counter() - start) * 1000
                if response.status_code != 200 or len(fixture.saved) != 1:
                    raise AssertionError("Local canary request failed")
                if index >= 3:
                    measurements[mode].append(elapsed)
                    calls[mode].append(fixture.create.call_count)

    def summary(values):
        """분포를 사실대로 기록합니다. 임의 latency 목표나 production 수치를 만들어내지 않습니다."""
        ordered = sorted(values)
        return {"samples": len(values), "median_ms": round(statistics.median(values), 3),
                "mean_ms": round(statistics.mean(values), 3), "min_ms": round(min(values), 3),
                "max_ms": round(max(values), 3), "p95_ms": round(ordered[max(0, (len(ordered) * 95 + 99) // 100 - 1)], 3)}

    return {"method": "TestClient perf_counter; 3 warmups per mode; alternating ON/OFF",
            "network": "mocked", "database": "mocked persistence boundary", "production_latency": "NOT_MEASURED",
            "off": summary(measurements["off"]), "on": summary(measurements["on"]),
            "lv4_sdk_calls_per_request": {mode: sorted(set(values)) for mode, values in calls.items()},
            "other_model_calls": "mocked; total production model calls not measured"}


class LocalCanaryTests(unittest.TestCase):
    """ON 상태의 실제 /chat 응답, fallback, privacy, 설정 복원과 저장 경계 일치를 검사합니다."""

    def test_general_chat_on_preserves_reply_and_contract(self):
        with canary_fixture() as fixture, TestClient(main.app) as client:
            response = send(client, fixture, "오늘 기분 좋아.")
        self.assertEqual(response.status_code, 200)
        ChatResponse.model_validate(response.json())
        self.assertEqual(response.json()["reply"], LEGACY)
        fixture.create.assert_not_called()
        fixture.bridge.assert_not_called()

    def test_choice_on_uses_arbitrator_reply_and_saves_exactly(self):
        with canary_fixture() as fixture, TestClient(main.app) as client, redirect_stdout(StringIO()) as output:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("선택 후보: " + CHOICE, body["reply"])
        self.assertNotEqual(body["reply"], LEGACY)
        self.assertNotIn("기존 Lv3 추천", body["reply"])
        self.assertEqual(fixture.saved[0]["content"], body["reply"])
        self.assertEqual(fixture.saved[0]["response"]["reply"], body["reply"])
        self.assertEqual(fixture.saved[0]["source"], "lv4")
        self.assertEqual(production_records(output.getvalue())[-1]["outcome"], "adopted")
        self.assertEqual(fixture.create.call_count, 1)
        fixture.client.close.assert_called_once()

    def test_none_result_preserves_lv3(self):
        with canary_fixture() as fixture, patch.object(production, "_run_pipeline", return_value=None), \
                TestClient(main.app) as client:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)
        self.assertEqual(fixture.saved[0]["content"], LEGACY)

    def test_unusable_no_recommendation_result_preserves_lv3(self):
        payload = {**structured_payload(), "needs_action": False, "actions": [], "used_evidence_refs": []}
        with canary_fixture(payload=payload) as fixture, TestClient(main.app) as client:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)

    def test_pipeline_sdk_exception_is_safe_fallback(self):
        with canary_fixture(sdk_error=RuntimeError(PRIVATE_DEBUG)) as fixture, \
                TestClient(main.app) as client, redirect_stdout(StringIO()) as output:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)
        self.assertNotIn(PRIVATE_DEBUG, response.text + output.getvalue())
        self.assertEqual(fixture.saved[0]["content"], LEGACY)

    def test_service_bridge_exception_is_safe_fallback(self):
        with canary_fixture() as fixture, TestClient(main.app) as client:
            fixture.bridge.side_effect = RuntimeError(PRIVATE_DEBUG)
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)
        fixture.create.assert_not_called()

    def test_incomplete_sdk_output_is_safe_fallback(self):
        with canary_fixture(model_status="incomplete") as fixture, TestClient(main.app) as client:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)
        self.assertEqual(fixture.saved[0]["content"], LEGACY)

    def test_missing_structured_output_field_is_safe_fallback(self):
        payload = structured_payload()
        payload.pop("input_question")
        with canary_fixture(payload=payload) as fixture, TestClient(main.app) as client:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)

    def test_unsupported_arbitrator_candidate_is_safe_fallback(self):
        original = production._run_pipeline

        def unsupported(context):
            """네 Specialist가 만든 실제 결과에서 지원하지 않는 candidate mode만 주입합니다."""
            result = original(context).model_dump()
            result["arbitrator_opinion"]["suggested_actions"][0]["mode"] = "execute"
            return result

        with canary_fixture() as fixture, patch.object(production, "_run_pipeline", side_effect=unsupported), \
                TestClient(main.app) as client:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)

    def test_privacy_reply_and_logs_only_expose_user_facing_projection(self):
        def private_state_bridge(owner, memories):
            """실제 Bridge가 state와 Memory를 읽도록 하되 UUID/metadata는 모델 투영에서 제외합니다."""
            providers = {name: lambda *args: [] for name in SOURCES}
            providers["memory"] = lambda *args: list(memories)
            providers["body"] = lambda user, question, now: [{
                "user_id": user, "fatigue": 0.1, "energy": 0.8, "confidence": 0.7, "observed_at": now}]
            return Lv4ContextBridge(ContextProviders(**providers))

        with canary_fixture() as fixture, TestClient(main.app) as client, redirect_stdout(StringIO()) as output:
            fixture.bridge.side_effect = private_state_bridge
            fixture.mocks["retrieve_relevant_memories_safe"].return_value = [SimpleNamespace(
                content=PRIVATE_MEMORY, relevance=0.9, confidence=0.7, metadata=PRIVATE_DEBUG)]
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        reply, logs = response.json()["reply"], output.getvalue()
        for secret in (PRIVATE_MEMORY, PRIVATE_DEBUG, "evidence_ref", "state_opinion", "arbitrator_opinion",
                       "used_evidence_refs", "confidence", "fatigue=", "energy=", "source_type",
                       "observed_at", "Traceback", "ORCHESTRATOR_SYSTEM_PROMPT"):
            self.assertNotIn(secret, reply + logs)
        self.assertNotIn(fixture.create.call_args.kwargs["input"][0]["content"], reply)
        self.assertIsNotNone(json.loads(fixture.create.call_args.kwargs["input"][1]["content"])["state_opinion"])
        for identity in (fixture.context.user_id, fixture.context.conversation_id,
                         fixture.context.user_message_id, fixture.context.request_id):
            self.assertNotIn(str(identity), logs)
        self.assertNotIn(QUESTION, logs)
        self.assertEqual(set(production_records(logs)[-1]), {"event", "outcome", "reason"})

    def test_minimized_sdk_input_uses_existing_contract(self):
        with canary_fixture() as fixture, TestClient(main.app) as client:
            fixture.mocks["retrieve_relevant_memories_safe"].return_value = [SimpleNamespace(
                content=PRIVATE_MEMORY, relevance=0.9, confidence=0.7, metadata=PRIVATE_DEBUG)]
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        kwargs = fixture.create.call_args.kwargs
        self.assertEqual(kwargs["text"]["format"]["type"], "json_schema")
        self.assertTrue(kwargs["text"]["format"]["strict"])
        submitted = json.loads(kwargs["input"][1]["content"])
        self.assertEqual(set(submitted), {"current_user_utterance", "reference_time", "state_opinion", "recommendation_evidence"})
        self.assertEqual(submitted["current_user_utterance"], QUESTION)
        self.assertNotIn(PRIVATE_DEBUG, json.dumps(submitted))
        self.assertTrue(all("user_id" not in item and "metadata" not in item for item in submitted["recommendation_evidence"]))

    def test_assistant_fallback_and_user_original_are_consistent(self):
        raw = "  " + QUESTION + "  \n"
        with canary_fixture(model_status="incomplete") as fixture, TestClient(main.app) as client:
            response = send(client, fixture, raw)
        fixture.mocks["begin_chat_request"].assert_called_once_with(raw, fixture.context.request_id)
        self.assertEqual(fixture.saved[0]["content"], response.json()["reply"])
        self.assertEqual(fixture.saved[0]["source"], "openai")

    def test_flag_off_preserves_legacy_and_records_disabled(self):
        with canary_fixture(flag="false") as fixture, TestClient(main.app) as client, redirect_stdout(StringIO()) as output:
            response = send(client, fixture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], LEGACY)
        fixture.create.assert_not_called()
        fixture.bridge.assert_not_called()
        self.assertEqual(production_records(output.getvalue())[-1], {
            "event": "reply_selected", "outcome": "fallback", "reason": "disabled"})

    def test_fixture_restores_flag_and_unset_default_is_off(self):
        original = os.environ.get("NOIE_LV4_PRODUCTION_ENABLED")
        with canary_fixture() as fixture, TestClient(main.app) as client:
            self.assertEqual(os.environ["NOIE_LV4_PRODUCTION_ENABLED"], "true")
            self.assertIn(CHOICE, send(client, fixture).json()["reply"])
        self.assertEqual(os.environ.get("NOIE_LV4_PRODUCTION_ENABLED"), original)
        with canary_fixture() as fixture, TestClient(main.app) as client:
            os.environ.pop("NOIE_LV4_PRODUCTION_ENABLED", None)
            self.assertEqual(send(client, fixture).json()["reply"], LEGACY)
            fixture.create.assert_not_called()
        self.assertEqual(os.environ.get("NOIE_LV4_PRODUCTION_ENABLED"), original)

    def test_cached_duplicate_reuses_final_reply_without_sdk_or_save(self):
        with canary_fixture() as fixture, TestClient(main.app) as client:
            first = send(client, fixture).json()
            fixture.mocks["begin_chat_request"].return_value = ChatPersistenceStart(fixture.context, first)
            second = send(client, fixture).json()
        self.assertEqual(first, second)
        self.assertEqual(len(fixture.saved), 1)
        fixture.create.assert_called_once()

    def test_new_request_id_same_text_is_a_new_result(self):
        with canary_fixture() as fixture, TestClient(main.app) as client:
            first = send(client, fixture).json()
            fixture.context = replace(fixture.context, request_id=uuid4(), user_message_id=uuid4())
            fixture.mocks["begin_chat_request"].return_value = ChatPersistenceStart(fixture.context)
            second = send(client, fixture).json()
        self.assertEqual(first["reply"], second["reply"])
        self.assertNotEqual(first["request_id"], second["request_id"])
        self.assertEqual(len(fixture.saved), 2)
        self.assertEqual(fixture.create.call_count, 2)

    def test_permission_failure_keeps_403_not_lv3_fallback(self):
        with canary_fixture() as fixture, patch.object(main, "mark_chat_request_failed") as failed, \
                TestClient(main.app) as client:
            fixture.owner.side_effect = LookupError(PRIVATE_DEBUG)
            response = send(client, fixture)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn(PRIVATE_DEBUG, response.text)
        self.assertEqual(fixture.saved, [])
        fixture.create.assert_not_called()
        failed.assert_called_once_with(fixture.context)

    def test_on_off_http_schema_and_analysis_are_identical(self):
        results = []
        for flag in ("false", "true"):
            with canary_fixture(flag=flag) as fixture, TestClient(main.app) as client:
                body = send(client, fixture).json()
                ChatResponse.model_validate(body)
                for name in ("reply", "request_id", "conversation_id"):
                    body.pop(name)
                results.append(body)
        self.assertEqual(results[0], results[1])

    def test_telemetry_distinguishes_unusable_result_from_disabled(self):
        with canary_fixture() as fixture, patch.object(production, "_run_pipeline", return_value=None), \
                TestClient(main.app) as client, redirect_stdout(StringIO()) as output:
            send(client, fixture)
        record = production_records(output.getvalue())[-1]
        self.assertEqual(record["outcome"], "fallback")
        self.assertNotEqual(record["reason"], "disabled")

    def test_latency_probe_counts_added_calls_without_live_claims(self):
        report = observe_latency(samples=2)
        self.assertEqual(report["lv4_sdk_calls_per_request"], {"off": [0], "on": [1]})
        self.assertEqual(report["production_latency"], "NOT_MEASURED")
        self.assertEqual(report["off"]["samples"], 2)
        self.assertEqual(report["on"]["samples"], 2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--timing", action="store_true")
    args = parser.parse_args()
    from evals.run_security_adversarial_verification import SafeResult
    with redirect_stdout(StringIO()):
        result = SafeResult()
        unittest.defaultTestLoader.loadTestsFromTestCase(LocalCanaryTests).run(result)
        timing = observe_latency() if args.timing and result.wasSuccessful() else None
    print(json.dumps({"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
        "skipped": len(result.skipped), "records": result.records, "timing": timing}, ensure_ascii=True))
    raise SystemExit(0 if result.wasSuccessful() else 1)
