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
# 구현된 Record/Schedule Tool과 미래 planning Tool을 각각 명시적으로 구분합니다.
TOOL_REGISTRY: tuple[ToolDefinition, ...] = (
    ToolDefinition("record_emotion", "emotion", ("record_emotion", "record_emotion_event"), ("record",), False, True, True),
    ToolDefinition("record_daily_trace", "daily_life", ("record_daily_life", "record_daily_trace", "record_completed_action"), ("record",), False, True, True),
    ToolDefinition("record_routine_event", "routine", ("record_routine", "record_routine_event", "record_exercise_event"), ("record",), False, True, False),
    ToolDefinition("create_memory_candidate", "memory", ("record_memory_candidate", "record_goal_memory", "record_preference_change"), ("record",), False, True, False),
    ToolDefinition("record_dream_goal", "dream_goal", ("record_dream_goal",), ("record",), False, True, True),
    ToolDefinition("review_dream_goal_link", "dream_goal", ("link_action_to_dream_hypothesis", "confirm_action_dream_link"), ("record",), False, True, False),
    ToolDefinition("update_dream_progress", "dream_goal", ("update_dream_progress", "change_dream_goal"), ("execute",), True, True, False),
    ToolDefinition("create_schedule", "schedule", ("create_schedule",), ("execute",), True, True, True),
    ToolDefinition("update_schedule", "schedule", ("update_schedule",), ("execute",), True, True, False),
    ToolDefinition("delete_schedule", "schedule", ("delete_schedule",), ("execute",), True, True, False),
    ToolDefinition("record_hobby", "hobby", ("record_hobby", "record_content_attention"), ("record",), False, False, False),
    ToolDefinition("record_place", "place", ("record_place", "record_place_interest"), ("record",), False, False, False),
    # 기존 관심 planning entry는 유지하고 명시적 사실/선호만 실행 가능한 Tool로 분리합니다.
    ToolDefinition("record_place_event", "place", ("record_place_event",), ("record",), False, True, True),
    # Body는 감정/인지와 분리된 현재 신체 상태 Record입니다.
    ToolDefinition("record_body_state", "body_state", ("record_body_state",), ("record",), False, True, True),
    # 기존 Record 신뢰도 기준과 공통 Executor를 재사용합니다.
    ToolDefinition("record_cognitive_state", "cognitive_state", ("record_cognitive_state",), ("record",), False, True, True),
    # 사람 근거 묶음만 기록하며 current resolver/update는 활성화하지 않습니다.
    ToolDefinition("record_relationship_event", "relationship", ("record_relationship_event",), ("record",), False, True, True),
    ToolDefinition("update_relationship_status", "relationship", ("update_relationship_status",), ("execute",), True, True, False),
    ToolDefinition("create_recommendation", "recommendation", ("request_recommendation", "create_recommendation"), ("suggest",), False, True, False),
    # 기존 미래 planning 이름은 유지하고 구현된 추천 이력 Tool만 별도 등록합니다.
    ToolDefinition("suggest_recommendation", "recommendation", ("suggest_recommendation",), ("suggest",), False, True, True),
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
