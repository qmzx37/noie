"""기존 응답 뒤에서만 실행하는 Lv4 관찰자입니다. 응답/Tool/DB 쓰기 권한은 없습니다."""

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from uuid import UUID, uuid4

from chat_background_observability import run_background_tail_probe
from chat_persistence_service import require_active_chat_user
from private_model_access import (
    PrivateModelAccessDenied, private_model_access_scope, require_private_model_access,
)


def shadow_enabled():
    """기존 환경변수 방식으로 읽으며 미설정/잘못된 값은 OFF입니다. 자동 sampling은 없습니다."""
    return os.getenv("NOIE_LV4_SHADOW_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def _rollout_ids(name):
    """목록 하나의 모든 UUID를 검사합니다. 부분적으로 유효한 설정도 사용하지 않습니다."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return set(), "missing"
    try:
        tokens = [value.strip() for value in raw.split(",")]
        if not 1 <= len(tokens) <= 5:
            return set(), "invalid"
        owners = set()
        for token in tokens:
            owner = UUID(token)
            # wildcard/JSON/빈 항목/축약 UUID/nil UUID는 운영 실수로 보고 fail closed합니다.
            if token.lower() != str(owner) or owner.int == 0:
                return set(), "invalid"
            owners.add(owner)
        return owners, None
    except (ValueError, TypeError, AttributeError):
        return set(), "invalid"


def shadow_eligibility(user_id, request_id):
    """공통 개발 사용자 구조에서도 전체 트래픽이 켜지지 않도록 사용자와 요청을 모두 제한합니다."""
    if not shadow_enabled():
        return False, "global_off"
    for label, name, identity in (
        ("user", "NOIE_LV4_SHADOW_ALLOWLIST", user_id),
        ("request", "NOIE_LV4_SHADOW_REQUEST_ALLOWLIST", request_id),
    ):
        allowed, error = _rollout_ids(name)
        if error:
            return False, f"{label}_allowlist_{error}"
        if not isinstance(identity, UUID) or identity not in allowed:
            return False, f"{label}_not_allowlisted"
    return True, "allowlisted"


def _emit(event, observation):
    """원문/의견/예외 문자열은 출력하지 않습니다. 로깅 실패도 production으로 전파하지 않습니다."""
    try:
        print("[noie] lv4_shadow " + json.dumps({"event":event, **observation}, ensure_ascii=True), flush=True)
    except Exception:
        pass


def run_shadow_dispatch_observed(*, user_id, text, memories, correlation):
    """기존 Shadow 호출의 경계만 기록하고 반환값/예외 전파 정책은 그대로 유지합니다."""
    try:
        _emit("dispatch_started", {"correlation": correlation})
    except Exception:
        # helper 자체가 실패해도 실제 Shadow는 반드시 호출합니다.
        pass
    event = "dispatch_returned"
    try:
        return run_shadow(user_id=user_id, text=text, memories=memories, correlation=correlation)
    except BaseException:
        event = "dispatch_failed"
        raise
    finally:
        try:
            # 예외 문자열이나 사용자/Memory 원문은 관측 로그에 넣지 않습니다.
            _emit(event, {"correlation": correlation})
        except Exception:
            pass


def schedule_shadow(background_tasks, *, context, text, memories):
    """완료된 새 요청만 main에서 호출합니다. OFF면 projection/import/provider 호출도 없습니다."""
    correlation = None
    try:
        if not shadow_enabled():
            return
        eligible, reason = shadow_eligibility(context.user_id, context.request_id)
        # 사용자 UUID나 목록 자체 대신 낮은 cardinality의 판단 결과만 기록합니다.
        if not eligible:
            _emit("gate", {"eligible":False,"scheduled":False,"gate_reason":reason})
            return
        # 예약 준비의 오류도 이미 생성된 production 응답으로 전파하지 않습니다.
        correlation = hashlib.sha256((context.request_id or context.user_message_id or uuid4()).bytes).hexdigest()[:24]
        # 이미 production Retrieval이 선택한 최대 4개만 detached 최소 필드로 넘깁니다. 추가 검색은 없습니다.
        selected = tuple({"content":item.content, "relevance":item.relevance,
            "confidence":getattr(item,"confidence",None)} for item in memories[:4])
        background_tasks.add_task(run_shadow_dispatch_observed, user_id=context.user_id, text=text,
            memories=selected, correlation=correlation)
        # allowlist를 통과해 실제 Shadow가 예약된 경우에만 뒤에 초경량 tail을 붙입니다.
        background_tasks.add_task(run_background_tail_probe,
            correlation_source=context.request_id or context.user_message_id)
        _emit("gate", {"correlation":correlation,"eligible":True,"scheduled":True,"gate_reason":reason})
    except Exception:
        _emit("failed", {"correlation":correlation,"failure_stage":"SCHEDULING","failure_code":"scheduling_failed"})


def _make_bridge(user_id, memories):
    """Phase 7 factory를 재사용합니다. DB read 세션은 provider 반환 전에 닫힙니다."""
    from database import SessionLocal
    from agent.lv4.context_bridge import ContextProviders, Lv4ContextBridge
    from agent.lv4.read_providers import make_read_providers
    def memory_provider(owner, question, reference_time):
        """다른 사용자에게 snapshot을 재사용하지 않고 기존 Bridge의 관련성/개수 제한을 다시 적용합니다."""
        if owner != user_id:
            raise PermissionError("ownership mismatch")
        return list(memories)
    providers = make_read_providers(session_factory=SessionLocal, memory_provider=memory_provider) if SessionLocal else ContextProviders(memory=memory_provider)
    return Lv4ContextBridge(providers)


def _make_pipeline(text):
    """기존 네 Specialist만 만듭니다. Gateway/Executor/Action persistence는 연결하지 않습니다."""
    from openai import OpenAI
    from agent.recommendation_context import recommendation_needed
    from agent.lv4.collaboration_pipeline import Lv4CollaborationPipeline
    from agent.lv4.state_specialist import StateSpecialist
    from agent.lv4.recommendation_specialist import RecommendationSpecialist
    from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
    from agent.lv4.critic_specialist import CriticSpecialist
    from agent.lv4.arbitrator_specialist import ArbitratorSpecialist
    # 기존 60초 timeout을 재사용하되 관찰용 자동 재시도 비용은 늘리지 않습니다.
    client = OpenAI(timeout=60,max_retries=0) if recommendation_needed(text) and os.getenv("OPENAI_API_KEY", "").strip() else None
    return Lv4CollaborationPipeline(state_agent=StateSpecialist(),
        recommendation_agent=RecommendationSpecialist(OpenAIRecommendationAdapter(client)),
        critic_agent=CriticSpecialist(),arbitrator_agent=ArbitratorSpecialist()), client


def run_shadow(*, user_id, text, memories, correlation):
    """동기 background worker입니다. 전체 결과는 로컬에서만 보유하고 상태 metadata만 반환/기록합니다."""
    started = time.monotonic()
    # 아래 정책은 실행 권한 표시이며 측정된 카운터로 위장하지 않습니다.
    observation = {"correlation":correlation,"status":"STARTED",
        "gateway_policy":"disabled","executor_policy":"disabled","write_policy":"read_only"}
    _emit("started", observation)
    client = None
    stage = "BRIDGE"
    try:
        from agent.lv4.context_bridge import ContextBridgeResult
        from agent.lv4.collaboration_context import Lv4CollaborationResult, STAGES
        from agent.lv4.failure_diagnostics import diagnose
        # 예약 당시 권한은 재사용하지 않습니다. 매 검사마다 원래 계정만 조회하고 세션을 닫습니다.
        with private_model_access_scope(lambda: require_active_chat_user(user_id)):
            stage = "AUTHORIZATION"
            require_private_model_access()
            stage = "BRIDGE"
            bridge = _make_bridge(user_id,memories).build(user_id=user_id,current_utterance=text,
                reference_time=datetime.now(timezone.utc))
            bridge = ContextBridgeResult.model_validate(bridge.model_dump())
            observation["bridge_status"] = bridge.bridge_status
            observation["provider_statuses"] = {item.source:item.status for item in bridge.diagnostics}
            stage = "RECOMMENDATION"
            pipeline,client = _make_pipeline(text)
            diagnostics = []
            result = pipeline.run(bridge.context,failure_observer=diagnostics.append)
            # Specialist가 권한 거부를 partial 실패로 반환해도 성공/재시도로 취급하지 않습니다.
            require_private_model_access()
        stage = "VALIDATOR"
        result = Lv4CollaborationResult.model_validate(result.model_dump())
        observation.update(status=result.pipeline_status,pipeline_status=result.pipeline_status,
            failure_stage=result.failed_stage,
            failure_code=diagnostics[0].safe_message if diagnostics else result.failure_kind)
        if diagnostics:
            observation["error_type"] = diagnostics[0].error_type
        observation.update({stage+"_status":getattr(result,stage+"_opinion").result_status
            if getattr(result,stage+"_opinion") else None for stage in STAGES})
    except PrivateModelAccessDenied:
        # 비활성/삭제/잘못된 계정과 검사 장애를 모두 차단합니다. 예외 본문/식별자는 기록하지 않습니다.
        observation.update(status="SKIPPED",failure_stage="AUTHORIZATION",failure_code="private_access_denied")
    except Exception as error:
        # 기존 안전 진단만 사용하며 임의 예외 문자열을 로그에 넣지 않습니다.
        # 기존 진단 자체가 실패해도 고정된 코드만 기록하고 worker를 안전하게 끝냅니다.
        observation.update(status="FAILED",failure_stage=stage,failure_code="shadow_internal_error")
        timed_out = isinstance(error, TimeoutError) or type(error).__name__ == "APITimeoutError"
        try:
            from agent.lv4.failure_diagnostics import diagnose
            diagnostic = diagnose(error,stage)
            observation.update(failure_code=diagnostic.safe_message,error_type=diagnostic.error_type)
        except Exception:
            pass
        if timed_out:
            observation["error_type"] = "TimeoutError"
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
        observation["elapsed_ms"] = round((time.monotonic()-started)*1000,2)
        # 기존 완료/오류 outcome을 유지하며 권한 차단은 고정된 SKIPPED로 구분합니다.
        observation["outcome"] = ("SKIPPED" if observation["status"]=="SKIPPED"
            else "TIMEOUT" if observation.get("error_type") in {"TimeoutError","APITimeoutError"}
            else "FAILED" if observation["status"] != "COMPLETED"
            else "PARTIAL" if observation.get("bridge_status") == "PARTIAL" else "SUCCESS")
        event = "skipped" if observation["status"]=="SKIPPED" else "completed" if observation["status"]=="COMPLETED" else "failed"
        _emit(event,observation)
    return observation
