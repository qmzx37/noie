"""검증된 Orchestrator action을 실행 없는 Tool plan으로 변환합니다."""

from __future__ import annotations

import hashlib
from collections import Counter
from uuid import UUID, uuid4

from agent.tool_policy import validate_tool_policy
from agent.tool_registry import find_tool
from agent.tool_schemas import (
    GatewayAction,
    ToolExecutionPlan,
    ToolPlanRequest,
    ToolPlanResponse,
)


def _idempotency_key(action_id: UUID, tool_name: str | None) -> str:
    """동일 action_id와 Tool 조합에서 항상 같은 키를 만듭니다."""

    value = f"noie-tool-action:{action_id}:{tool_name or 'unsupported'}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _confirmation_id(action_id: UUID) -> UUID:
    """예측할 수 없는 승인 ID를 만들고 DB에서 action_id와 함께 검증합니다."""

    return uuid4()


def _build_plan(action: GatewayAction, duplicate_order: bool) -> ToolExecutionPlan:
    action_id = action.action_id or uuid4()
    tool = find_tool(action.type, action.intent)
    decision = validate_tool_policy(
        tool=tool,
        mode=action.mode,
        confidence=action.confidence,
        orchestrator_requires_confirmation=action.requires_confirmation,
    )
    status = "rejected" if duplicate_order else decision.status
    messages = list(decision.messages)
    if duplicate_order:
        messages.append("duplicate_execution_order")
    requires_confirmation = decision.requires_confirmation
    confirmation_id = _confirmation_id(action_id) if requires_confirmation else None
    return ToolExecutionPlan(
        action_id=action_id,
        action_type=action.type,
        intent=action.intent,
        tool_name=tool.tool_name if tool else None,
        mode=action.mode,
        status=status,
        confidence=action.confidence,
        requires_confirmation=requires_confirmation,
        confirmation_status="pending" if requires_confirmation else "not_required",
        confirmation_id=confirmation_id,
        execution_order=action.execution_order,
        idempotency_key=_idempotency_key(action_id, tool.tool_name if tool else None),
        implemented=bool(tool and tool.implemented),
        # v0.1은 정책 계획 전용이므로 ready여도 실제 Tool 실행은 비활성화합니다.
        can_execute=False,
        policy_messages=messages,
    )


def create_tool_plan(request: ToolPlanRequest) -> ToolPlanResponse:
    """각 action을 독립 검증하고 입력 execution_order 순서로 계획을 반환합니다."""

    order_counts = Counter(action.execution_order for action in request.actions)
    plans = [
        _build_plan(action, order_counts[action.execution_order] > 1)
        for action in sorted(request.actions, key=lambda item: item.execution_order)
    ]
    invalid_statuses = {"rejected", "needs_review", "not_implemented"}
    return ToolPlanResponse(
        plans=plans,
        all_valid=all(plan.status not in invalid_statuses for plan in plans),
        execution_enabled=False,
    )
