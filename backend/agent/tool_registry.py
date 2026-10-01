"""현재와 미래 NOIE Tool의 허용 범위를 metadata로 선언합니다."""

from __future__ import annotations

from dataclasses import dataclass

from agent.schemas import ActionMode, AgentType


@dataclass(frozen=True)
class ToolDefinition:
    tool_name: str
    action_type: AgentType
    allowed_intents: tuple[str, ...]
    allowed_modes: tuple[ActionMode, ...]
    requires_confirmation: bool
    planning_supported: bool
    implemented: bool


# planning_supported는 v0.1 계획 계약 준비 여부, implemented는 실제 executor 존재 여부입니다.
# 이번 단계에는 실제 executor가 없으므로 모든 Tool의 implemented는 false입니다.
TOOL_REGISTRY: tuple[ToolDefinition, ...] = (
    ToolDefinition("record_emotion", "emotion", ("record_emotion", "record_emotion_event"), ("record",), False, True, False),
    ToolDefinition("record_daily_trace", "daily_life", ("record_daily_life", "record_daily_trace", "record_completed_action"), ("record",), False, True, False),
    ToolDefinition("record_routine_event", "routine", ("record_routine", "record_routine_event", "record_exercise_event"), ("record",), False, True, False),
    ToolDefinition("create_memory_candidate", "memory", ("record_memory_candidate", "record_goal_memory", "record_preference_change"), ("record",), False, True, False),
    ToolDefinition("record_dream_goal", "dream_goal", ("record_dream_goal", "link_action_to_dream_hypothesis", "confirm_action_dream_link"), ("record",), False, True, False),
    ToolDefinition("update_dream_progress", "dream_goal", ("update_dream_progress", "change_dream_goal"), ("execute",), True, True, False),
    ToolDefinition("create_schedule", "schedule", ("create_schedule",), ("execute",), True, True, False),
    ToolDefinition("update_schedule", "schedule", ("update_schedule",), ("execute",), True, True, False),
    ToolDefinition("delete_schedule", "schedule", ("delete_schedule",), ("execute",), True, True, False),
    ToolDefinition("record_hobby", "hobby", ("record_hobby", "record_content_attention"), ("record",), False, False, False),
    ToolDefinition("record_place", "place", ("record_place", "record_place_interest"), ("record",), False, False, False),
    ToolDefinition("record_relationship_event", "relationship", ("record_relationship_event",), ("record",), False, False, False),
    ToolDefinition("update_relationship_status", "relationship", ("update_relationship_status",), ("execute",), True, True, False),
    ToolDefinition("create_recommendation", "recommendation", ("request_recommendation", "create_recommendation"), ("suggest",), False, True, False),
    ToolDefinition("suggest_reflection", "reflection", ("suggest_reflection", "suggest_rest", "reflect_emotion"), ("suggest",), False, True, False),
)


def find_tool(action_type: AgentType, intent: str) -> ToolDefinition | None:
    """type과 intent가 모두 일치하는 Tool만 반환합니다."""

    return next(
        (
            tool
            for tool in TOOL_REGISTRY
            if tool.action_type == action_type and intent in tool.allowed_intents
        ),
        None,
    )
