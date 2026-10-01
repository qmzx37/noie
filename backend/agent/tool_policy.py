"""Orchestrator 판단을 신뢰 경계에서 다시 검증하는 단순 정책입니다."""

from __future__ import annotations

from dataclasses import dataclass

from agent.schemas import ActionMode
from agent.tool_registry import ToolDefinition


CONFIDENCE_THRESHOLDS: dict[ActionMode, float] = {
    "record": 0.40,
    "suggest": 0.50,
    "execute": 0.80,
}


@dataclass(frozen=True)
class PolicyDecision:
    status: str
    requires_confirmation: bool
    messages: tuple[str, ...]


def validate_tool_policy(
    *,
    tool: ToolDefinition | None,
    mode: ActionMode,
    confidence: float,
    orchestrator_requires_confirmation: bool,
) -> PolicyDecision:
    """mode, confirmation, confidence, 구현 여부를 순서대로 검증합니다."""

    if tool is None:
        return PolicyDecision("rejected", False, ("unsupported_intent",))
    if mode not in tool.allowed_modes:
        return PolicyDecision("rejected", tool.requires_confirmation, ("mode_not_allowed",))

    requires_confirmation = tool.requires_confirmation or mode == "execute"
    messages: list[str] = []
    if requires_confirmation and not orchestrator_requires_confirmation:
        messages.append("confirmation_forced_by_gateway")
    if not requires_confirmation and orchestrator_requires_confirmation:
        messages.append("unnecessary_confirmation_removed")

    if confidence < CONFIDENCE_THRESHOLDS[mode]:
        messages.append("confidence_below_policy_threshold")
        return PolicyDecision("needs_review", requires_confirmation, tuple(messages))
    if not tool.planning_supported:
        messages.append("tool_not_implemented")
        return PolicyDecision("not_implemented", requires_confirmation, tuple(messages))
    if requires_confirmation:
        if not tool.implemented:
            messages.append("executor_not_connected")
        return PolicyDecision("pending_confirmation", True, tuple(messages))
    if not tool.implemented:
        messages.append("executor_not_connected")
    return PolicyDecision("ready", False, tuple(messages))
