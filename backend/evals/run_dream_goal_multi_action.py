"""실제 OpenAI의 Daily + Dream 계획을 PostgreSQL에 독립 저장합니다."""

import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))

import main
from agent.orchestrator import orchestrate_with_openai
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import ToolPlanRequest
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.daily_life_event import DailyLifeEvent
from models.dream_goal import DreamGoal
from models.message import Message
from models.user import User


def run() -> None:
    text = "오늘 NOIE 개발했고, 나는 사람들의 목표를 돕는 AI를 만들고 싶어."
    routing = orchestrate_with_openai(text)
    actions = [action for action in routing.actions if action.intent in {"record_daily_trace", "record_dream_goal"}]
    if {action.intent for action in actions} != {"record_daily_trace", "record_dream_goal"}: raise AssertionError(actions)
    plans = create_tool_plan(ToolPlanRequest(actions=[action.model_dump(mode="json") for action in actions])).plans
    with SessionLocal() as db:
        user = User(name=f"__dream_multi__{uuid4().hex}", metadata_={"test": "dream-multi"}); db.add(user); db.flush()
        conversation = Conversation(user_id=user.id, title="dream-multi", metadata_={}); db.add(conversation); db.flush()
        message = Message(conversation_id=conversation.id, user_id=user.id, role="user", content=text, metadata_={}); db.add(message); db.commit()
        user_id, conversation_id, message_id = user.id, conversation.id, message.id
    client = TestClient(main.app)
    response = client.post("/agent/actions/plan", json={"user_id": str(user_id), "conversation_id": str(conversation_id), "message_id": str(message_id), "plans": [plan.model_dump(mode="json") for plan in plans]})
    if response.status_code != 201: raise AssertionError(response.text)
    for plan in sorted(plans, key=lambda item: item.execution_order):
        executed = client.post(f"/agent/actions/{plan.action_id}/execute", json={"user_id": str(user_id)})
        if executed.status_code != 200 or executed.json()["action"]["status"] != "completed": raise AssertionError(executed.text)
    with SessionLocal() as db:
        action_rows = list(db.scalars(select(AgentAction).where(AgentAction.user_id == user_id).order_by(AgentAction.execution_order)).all())
        daily = list(db.scalars(select(DailyLifeEvent).where(DailyLifeEvent.user_id == user_id)).all())
        dream = list(db.scalars(select(DreamGoal).where(DreamGoal.user_id == user_id)).all())
    if len(daily) != 1 or len(dream) != 1 or daily[0].agent_action_id == dream[0].agent_action_id: raise AssertionError("domain rows")
    if [row.execution_order for row in action_rows] != sorted(row.execution_order for row in action_rows): raise AssertionError("order")
    print("[PASS] OpenAI Daily + Dream routing")
    print("[PASS] independent AgentAction and domain rows")
    print("[PASS] execution_order preserved")
    print(f"TEST_USER_ID={user_id}")


if __name__ == "__main__": run()
