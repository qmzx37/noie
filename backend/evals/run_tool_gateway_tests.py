"""Tool Gateway v0.1의 정책과 dry-run 계약을 20개 사례로 검증합니다."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402
from agent.tool_gateway import create_tool_plan  # noqa: E402
from agent.tool_schemas import GatewayAction, ToolPlanRequest  # noqa: E402


PASSED = 0


def action(
    action_type: str,
    intent: str,
    mode: str,
    order: int = 1,
    confidence: float = 0.95,
    confirmation: bool = False,
    action_id=None,
) -> GatewayAction:
    return GatewayAction(
        action_id=action_id,
        type=action_type,
        intent=intent,
        mode=mode,
        reason="gateway test",
        confidence=confidence,
        requires_confirmation=confirmation,
        execution_order=order,
    )


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        raise AssertionError(f"{name}: {detail}")
    PASSED += 1
    print(f"[PASS] {name}: {detail}")


def plan_for(item: GatewayAction):
    return create_tool_plan(ToolPlanRequest(actions=[item])).plans[0]


def main_test() -> None:
    emotion = plan_for(action("emotion", "record_emotion", "record"))
    check("1 emotion record ready", emotion.status == "ready")

    daily = plan_for(action("daily_life", "record_completed_action", "record"))
    check("2 daily_life record ready", daily.status == "ready")

    routine = plan_for(action("routine", "record_routine_event", "record"))
    check("3 routine record ready", routine.status == "ready")

    recommendation = plan_for(action("recommendation", "request_recommendation", "suggest"))
    check("4 recommendation suggest ready", recommendation.status == "ready")

    schedule = plan_for(action("schedule", "create_schedule", "execute", confirmation=True))
    check(
        "5 create schedule pending",
        schedule.status == "pending_confirmation"
        and not schedule.implemented
        and "executor_not_connected" in schedule.policy_messages,
    )

    delete = plan_for(action("schedule", "delete_schedule", "execute", confirmation=True))
    check("6 delete schedule pending", delete.status == "pending_confirmation")

    dream = plan_for(action("dream_goal", "change_dream_goal", "execute", confirmation=True))
    check("7 dream change pending", dream.status == "pending_confirmation")

    relationship = plan_for(action("relationship", "update_relationship_status", "execute", confirmation=True))
    check(
        "8 relationship change confirmation",
        relationship.requires_confirmation and relationship.confirmation_id is not None,
        relationship.status,
    )

    hobby = plan_for(action("hobby", "record_hobby", "record"))
    check("9 hobby not implemented", hobby.status == "not_implemented")

    unsupported = plan_for(action("emotion", "invent_unknown_intent", "record"))
    check("10 unsupported intent rejected", unsupported.status == "rejected")

    mode_conflict = plan_for(action("schedule", "delete_schedule", "record"))
    check("11 mode conflict rejected", mode_conflict.status == "rejected")

    forced = plan_for(action("schedule", "create_schedule", "execute", confirmation=False))
    check(
        "12 execute confirmation forced",
        forced.status == "pending_confirmation"
        and forced.requires_confirmation
        and "confirmation_forced_by_gateway" in forced.policy_messages,
    )

    low = plan_for(action("schedule", "create_schedule", "execute", confidence=0.5))
    check("13 low confidence execute review", low.status == "needs_review")

    multi = create_tool_plan(
        ToolPlanRequest(
            actions=[
                action("emotion", "record_emotion", "record", order=2),
                action("daily_life", "record_daily_trace", "record", order=1),
                action("recommendation", "request_recommendation", "suggest", order=3),
            ]
        )
    )
    check("14 multi action order", [item.execution_order for item in multi.plans] == [1, 2, 3])

    duplicate = create_tool_plan(
        ToolPlanRequest(
            actions=[
                action("emotion", "record_emotion", "record", order=1),
                action("daily_life", "record_daily_trace", "record", order=1),
            ]
        )
    )
    check("15 duplicate order rejected", all(item.status == "rejected" for item in duplicate.plans))

    stable_id = uuid4()
    first = plan_for(action("emotion", "record_emotion", "record", action_id=stable_id))
    second = plan_for(action("emotion", "record_emotion", "record", action_id=stable_id))
    check(
        "16 action id idempotency contract",
        first.action_id == second.action_id and first.idempotency_key == second.idempotency_key,
    )

    check("17 record no confirmation", not emotion.requires_confirmation and emotion.confirmation_id is None)
    check("18 suggest never executes", recommendation.status == "ready" and not recommendation.can_execute)

    empty = create_tool_plan(ToolPlanRequest(actions=[]))
    check("19 empty actions empty plan", empty.plans == [] and empty.all_valid)

    malformed = TestClient(main.app).post(
        "/agent/tool-plan",
        json={
            "actions": [
                {
                    "type": "schedule",
                    "intent": "create_schedule",
                    "mode": "dangerous",
                    "reason": "invalid",
                    "confidence": 2,
                    "requires_confirmation": False,
                    "execution_order": 0,
                }
            ]
        },
    )
    check("20 malformed action rejected", malformed.status_code == 422, str(malformed.status_code))

    print(f"SUMMARY={PASSED}/20")


if __name__ == "__main__":
    main_test()
