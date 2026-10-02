"""실제 OpenAI Orchestrator부터 PostgreSQL Emotion Event까지 검증합니다."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402
from agent.orchestrator import orchestrate_with_openai  # noqa: E402
from agent.tool_gateway import create_tool_plan  # noqa: E402
from agent.tool_schemas import GatewayAction, ToolPlanRequest  # noqa: E402
from database import SessionLocal  # noqa: E402
from models.conversation import Conversation  # noqa: E402
from models.emotion_event import EmotionEvent  # noqa: E402
from models.message import Message  # noqa: E402
from models.user import User  # noqa: E402


CASES = (
    ("mixed_tension_joy", "오늘 발표 전에 엄청 긴장했는데 끝나고 나니까 기분 좋았어."),
    ("ordinary_day", "오늘 그냥 평범한 하루였어."),
    ("schedule_only", "내일 운동 일정 잡아줘."),
    ("anger", "오늘 화가 많이 났어."),
    ("relaxed", "지금은 마음이 편안하고 안정돼."),
)


def run() -> None:
    run_id = uuid4().hex
    with SessionLocal() as db:
        user = User(name=f"__noie_emotion_e2e__{run_id}", metadata_={"test_run": run_id})
        db.add(user)
        db.flush()
        conversation = Conversation(user_id=user.id, title="record emotion e2e", metadata_={"test_run": run_id})
        db.add(conversation)
        db.commit()
        user_id, conversation_id = user.id, conversation.id

    client = TestClient(main.app)
    passed = 0
    for case_id, text in CASES:
        with SessionLocal() as db:
            message = Message(
                conversation_id=conversation_id,
                user_id=user_id,
                role="user",
                content=text,
                metadata_={"test_run": run_id, "case": case_id},
            )
            db.add(message)
            db.commit()
            message_id = message.id

        result = orchestrate_with_openai(text)
        emotion_actions = [
            action for action in result.actions
            if action.type == "emotion" and action.mode == "record"
        ]
        if case_id in {"ordinary_day", "schedule_only"}:
            condition = not emotion_actions
            detail = f"emotion_actions={len(emotion_actions)}"
        else:
            condition = len(emotion_actions) == 1 and emotion_actions[0].arguments is not None
            detail = f"emotion_actions={len(emotion_actions)}"
            if condition:
                action = emotion_actions[0]
                arguments = action.arguments
                if case_id == "mixed_tension_joy":
                    condition = arguments.T >= 0.5 and arguments.J >= 0.5
                elif case_id == "anger":
                    condition = arguments.A == max(getattr(arguments, key) for key in "FADJCGTR")
                elif case_id == "relaxed":
                    condition = arguments.R == max(getattr(arguments, key) for key in "FADJCGTR")

                gateway_action = GatewayAction.model_validate(action.model_dump())
                plan = create_tool_plan(ToolPlanRequest(actions=[gateway_action])).plans[0]
                saved = client.post(
                    "/agent/actions/plan",
                    json={
                        "user_id": str(user_id),
                        "conversation_id": str(conversation_id),
                        "message_id": str(message_id),
                        "plans": [plan.model_dump(mode="json")],
                    },
                )
                executed = client.post(
                    f"/agent/actions/{plan.action_id}/execute",
                    json={"user_id": str(user_id)},
                )
                with SessionLocal() as db:
                    event = db.scalar(
                        select(EmotionEvent).where(EmotionEvent.message_id == message_id)
                    )
                condition = condition and saved.status_code == 201 and executed.status_code == 200 and event is not None
                detail += f", status={executed.status_code}, axis={arguments.model_dump()}"

        if not condition:
            raise AssertionError(f"{case_id}: {detail}")
        passed += 1
        print(f"[PASS] {case_id}: {detail}")

    print(f"TEST_USER_ID={user_id}")
    print(f"SUMMARY={passed}/{len(CASES)}")


if __name__ == "__main__":
    run()
