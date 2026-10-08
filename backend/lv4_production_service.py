"""명시적 추천 요청에서만 기존 Lv4 의견을 최종 reply로 투영합니다. 업무 쓰기는 없습니다."""

import json
import os
from datetime import datetime, timezone
from uuid import UUID

from agent.recommendation_context import recommendation_needed
from agent.lv4.arbitrator_specialist import ArbitratorSpecialist
from agent.lv4.collaboration_context import Lv4CollaborationResult
from agent.lv4.collaboration_pipeline import Lv4CollaborationPipeline
from agent.lv4.context_bridge import ContextBridgeResult
from agent.lv4.critic_specialist import CriticSpecialist
from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
from agent.lv4.recommendation_specialist import RecommendationSpecialist
from agent.lv4.state_specialist import StateSpecialist
from agent.lv4.behavior_adapter import read_behavior
from agent.lv4.state_context import StateContext
from agent.lv4.collaboration_context import Lv4CollaborationContext
from chat_persistence_service import require_active_chat_user
from lv4_shadow_service import _make_bridge
from private_model_access import (
    PrivateModelAccessDenied, private_model_access_scope, require_private_model_access,
)


def _emit(outcome, reason):
    """고정 상태만 기록합니다. 원문/ID/의견/예외 문자열이나 로깅 오류는 외부로 보내지 않습니다."""
    try:
        print("[noie] lv4_production " + json.dumps({"event": "reply_selected", "outcome": outcome, "reason": reason}), flush=True)
    except Exception:
        pass


def _run_pipeline(context):
    """새 판단 규칙 없이 기존 네 Specialist를 연결하고 SDK 전송 직전 소유권을 재검사합니다."""
    adapter = OpenAIRecommendationAdapter()

    def reasoner(request, evidence):
        """조회 세션이 닫힌 뒤 검사합니다. 계정 거부를 모델 장애 fallback으로 우회하지 않습니다."""
        require_private_model_access()
        return adapter(request, evidence)

    return Lv4CollaborationPipeline(
        state_agent=StateSpecialist(), recommendation_agent=RecommendationSpecialist(reasoner),
        critic_agent=CriticSpecialist(), arbitrator_agent=ArbitratorSpecialist(),
    ).run(context)


def format_lv4_reply(result, text):
    """완료된 Suggest만 표현합니다. 내부 evidence/confidence/risks는 변경하거나 공개하지 않습니다."""
    # model_construct/중첩 객체 변경도 재검사하고 None/누락/미정의 필드는 성공으로 사용하지 않습니다.
    checked = Lv4CollaborationResult.model_validate(
        result.model_dump() if isinstance(result, Lv4CollaborationResult) else result,
    )
    opinion = checked.arbitrator_opinion
    if checked.pipeline_status != "COMPLETED" or opinion is None:
        return None
    if opinion.result_status != "OK" or opinion.needs_user_input or not 1 <= len(opinion.suggested_actions) <= 2:
        return None
    if not any(item.source_type == "utterance" and item.summary == text for item in opinion.evidence):
        return None
    if any((item.type, item.intent, item.mode) != ("recommendation", "suggest_recommendation", "suggest")
           for item in opinion.suggested_actions):
        return None
    # raw 객체/근거 원문 대신 조정자가 확정한 결론과 후보만 하나의 일관된 답변으로 보입니다.
    return "\n".join([opinion.conclusion, *("- " + item.summary for item in opinion.suggested_actions)])


def try_lv4_production_reply(*, context, text, memories):
    """사용 가능한 reply 또는 None입니다. None이면 호출자가 이미 만든 Lv3 답변을 보존합니다."""
    # 승인되지 않은 운영 트래픽에는 추가 조회/모델 호출이 없습니다. 기본값/오타는 OFF입니다.
    if os.getenv("NOIE_LV4_PRODUCTION_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}:
        _emit("fallback", "disabled")
        return None
    if not recommendation_needed(text):
        _emit("fallback", "not_recommendation")
        return None
    if context is None or not isinstance(context.user_id, UUID) or not isinstance(context.user_message_id, UUID):
        _emit("fallback", "missing_context")
        return None
    try:
        # 기존 Shadow의 읽기 전용 Bridge factory만 재사용합니다. Shadow 예약/allowlist는 호출하지 않습니다.
        # 최초 소유자를 고정하며 dev-user로 재선택하거나 DB transaction을 모델 통신 중 유지하지 않습니다.
        with private_model_access_scope(lambda: require_active_chat_user(context.user_id)):
            require_private_model_access()
            selected = tuple({"content": item.content, "relevance": item.relevance,
                              "confidence": getattr(item, "confidence", None)} for item in memories[:4])
            bridge = _make_bridge(context.user_id, selected).build(
                user_id=context.user_id, current_utterance=text, reference_time=datetime.now(timezone.utc),
            )
            bridge = ContextBridgeResult.model_validate(bridge.model_dump())
            pipeline_context = bridge.context
            try:
                # 기존 feature flag/추천 gate 안에서만 현재 소유자의 메시지 하나를 읽습니다.
                behaviors = read_behavior(user_id=context.user_id, message_id=context.user_message_id, current_utterance=text)
                state = StateContext.model_validate({**pipeline_context.state_context.model_dump(), "behaviors": behaviors})
                pipeline_context = Lv4CollaborationContext.model_validate({**pipeline_context.model_dump(), "state_context": state})
            except Exception:
                # None/invalid/exception은 기존 Lv4 판단과 /chat을 중단하지 않습니다.
                pass
            result = _run_pipeline(pipeline_context)
            # pipeline의 partial 실패가 내부 권한 거부를 숨겨도 이 경계에서 다시 fail-closed합니다.
            require_private_model_access()
            reply = format_lv4_reply(result, text)
        _emit("adopted" if reply is not None else "fallback", "valid_suggest" if reply is not None else "unsupported_result")
        return reply
    except PrivateModelAccessDenied:
        # 기존 /chat의 안전한 403 처리로 전달하며 이전 private reply를 계속 반환하지 않습니다.
        _emit("fallback", "access_denied")
        raise
    except Exception:
        _emit("fallback", "unavailable_result")
        return None
