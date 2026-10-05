"""Agent/Domain 인증 경계 검사입니다. 격리 SQLite와 테스트 executor만 사용합니다."""

import os
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from uuid import uuid4

from sqlalchemy import DefaultClause, JSON, MetaData, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from evals import run_auth_surface_tests as core
import auth_context as auth
import main
from agent import action_router, action_service, executor_service
from agent.executor_registry import ExecutorResult
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction, ToolPlanRequest
from models.agent_action import AgentAction
from models.body_state_event import BodyStateEvent
from models.cognitive_state_event import CognitiveStateEvent
from models.daily_life_event import DailyLifeEvent
from models.dream_goal import DreamGoal
from models.emotion_event import EmotionEvent
from models.place_event import PlaceEvent
from models.recommendation import Recommendation
from models.relationship_event import RelationshipEvent
from models.schedule import Schedule
from models.user import User
from models.conversation import Conversation
from models.message import Message


# 모델/서비스/응답 검증은 실제 코드를 사용하고 원격 DB나 OpenAI를 호출하지 않습니다.
DOMAINS = [
    ("body-state-events", BodyStateEvent, {"fatigue": .5, "confidence": .9}),
    ("cognitive-state-events", CognitiveStateEvent, {"focus": .5, "confidence": .9}),
    ("daily-life-events", DailyLifeEvent, {"summary": "fixture"}),
    ("dream-goals", DreamGoal, {"statement": "fixture", "kind": "goal"}),
    ("emotion-events", EmotionEvent, {**{axis: .5 for axis in "fadjcgtr"}, "confidence": .9}),
    ("place-events", PlaceEvent, {"place_name": "fixture", "kind": "visit"}),
    ("recommendations", Recommendation, {"primary_action": "fixture", "rationale": "fixture",
        "confidence": .9, "recommendation_kind": "direct"}),
    ("relationship-events", RelationshipEvent, {"person_label": "민수", "identity_kind": "named",
        "record_kind": "social_relation", "relationship_type": "friend", "record_index": 0,
        "relationship_statement": "민수는 친구다", "temporal_scope": "current", "confidence": .9}),
    ("schedules", Schedule, {"title": "fixture", "start_at": datetime(2026, 10, 6, tzinfo=timezone.utc)}),
]


class AuthAgentSurfaceTests(unittest.TestCase):
    """AUTH ON에서는 client UUID만으로 다른 사용자의 action/domain에 접근할 수 없습니다."""

    def setUp(self):
        # Phase 10.7의 A/B 사용자·대화·메시지 fixture와 외부 호출 방어를 재사용합니다.
        core.AuthSurfaceTests.setUp(self)
        schema = MetaData()
        for model in (User, Conversation, Message, AgentAction, *(model for _, model, _ in DOMAINS)):
            table = model.__table__.to_metadata(schema)
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
                    column.server_default = None
                elif column.server_default is not None and "gen_random_uuid" in str(column.server_default.arg):
                    column.server_default = None
                elif column.server_default is not None and str(column.server_default.arg) == "now()":
                    column.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
        schema.create_all(self.engine)
        self.action_a = self.seed_action(self.a.id, self.ca.id, self.ma.id)
        self.action_b = self.seed_action(self.b.id, self.cb.id, self.mb.id)
        self.events = {}
        for domain, model, values in DOMAINS:
            rows = []
            for owner, conversation, message, action in ((self.a, self.ca, self.ma, self.action_a),
                                                        (self.b, self.cb, self.mb, self.action_b)):
                row = model(user_id=owner.id, conversation_id=conversation.id, message_id=message.id,
                            agent_action_id=action.id, metadata_={}, **values)
                self.db.add(row)
                rows.append(row)
            self.events[domain] = rows
        self.db.commit()
        self.executor = patch.object(executor_service, "SessionLocal", lambda: Session(self.engine, expire_on_commit=False))
        self.executor.start()

    def tearDown(self):
        self.executor.stop()
        core.AuthSurfaceTests.tearDown(self)

    def seed_action(self, user_id, conversation_id=None, message_id=None, **changes):
        values = dict(user_id=user_id, conversation_id=conversation_id, message_id=message_id,
            action_id=uuid4(), tool_name="test_success_tool", action_type="emotion", intent="record_emotion",
            mode="execute", status="pending_confirmation", confidence=.9, requires_confirmation=True,
            execution_order=1, idempotency_key=uuid4().hex, confirmation_status="pending", confirmation_id=uuid4())
        row = AgentAction(**{**values, **changes})
        self.db.add(row)
        self.db.flush()
        return row

    def plan_body(self, user_id=None, conversation_id=None, message_id=None):
        plans = create_tool_plan(ToolPlanRequest(actions=[GatewayAction(type="emotion", intent="record_emotion",
            mode="record", reason="fixture", confidence=.95, requires_confirmation=False, execution_order=1)])).plans
        return {"user_id": str(user_id or self.a.id), "conversation_id": str(conversation_id or self.ca.id),
                "message_id": str(message_id or self.ma.id), "plans": [p.model_dump(mode="json") for p in plans]}

    def endpoints(self):
        aid = self.action_a.action_id
        confirm = {"user_id": str(self.a.id), "confirmation_id": str(self.action_a.confirmation_id)}
        result = [
            ("POST", "/agent/actions/plan", self.plan_body()),
            ("GET", f"/agent/actions/{aid}?user_id={self.a.id}", None),
            ("POST", f"/agent/actions/{aid}/confirm", confirm),
            ("POST", f"/agent/actions/{aid}/reject", confirm),
            ("POST", f"/agent/actions/{aid}/execute", {"user_id": str(self.a.id)}),
            ("GET", f"/users/{self.a.id}/agent-actions", None),
        ]
        for domain, _, _ in DOMAINS:
            result += [("GET", f"/{domain}/{self.events[domain][0].id}?user_id={self.a.id}", None),
                       ("GET", f"/users/{self.a.id}/{domain}", None)]
        return result

    def test_all_24_agent_domain_surfaces_require_token(self):
        main.app.dependency_overrides.pop(auth.resolve_auth_principal)
        endpoints = self.endpoints()
        self.assertEqual(len(endpoints), 24)
        for method, url, body in endpoints:
            with self.subTest(url=url):
                self.assertEqual(self.client.request(method, url, json=body).status_code, 401)

    def test_all_24_surfaces_reject_invalid_token(self):
        from supabase_auth_verifier import TokenVerificationError
        main.app.dependency_overrides.pop(auth.resolve_auth_principal)
        with patch("supabase_auth_verifier.verify_supabase_token", side_effect=TokenVerificationError("private")):
            for method, url, body in self.endpoints():
                with self.subTest(url=url):
                    result = self.client.request(method, url, json=body, headers={"Authorization": "Bearer invalid"})
                    self.assertEqual(result.status_code, 401)
                    self.assertNotIn("private", result.text)

    def test_none_principal_on_cannot_fall_back_to_dev(self):
        self.principal = None
        for method, url, body in self.endpoints():
            with self.subTest(url=url):
                self.assertEqual(self.client.request(method, url, json=body).status_code, 401)

    def test_explicit_other_user_id_403_on_all_24_surfaces(self):
        # Authenticated principal is the authority; client-supplied user_id is only a consistency check.
        for method, url, body in self.endpoints():
            url = url.replace(str(self.a.id), str(self.b.id))
            body = {**body, "user_id": str(self.b.id)} if body else None
            with self.subTest(url=url):
                result = self.client.request(method, url, json=body)
                self.assertEqual(result.status_code, 403)
                self.assertNotIn(str(self.b.id), result.text)

    def test_own_action_get_and_list_success(self):
        result = self.client.get(f"/agent/actions/{self.action_a.action_id}?user_id={self.a.id}")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["user_id"], str(self.a.id))
        listed = self.client.get(f"/users/{self.a.id}/agent-actions")
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(all(row["user_id"] == str(self.a.id) for row in listed.json()))

    def test_only_principal_may_confirm_reject_execute_own_persisted_action(self):
        # Only the authenticated Principal may confirm, reject, or execute its own persisted AgentAction.
        self.principal = auth.AuthPrincipal(self.b.id)
        aid = self.action_a.action_id
        with patch.object(executor_service, "get_executor") as tool:
            self.assertEqual(self.client.get(f"/agent/actions/{aid}?user_id={self.b.id}").status_code, 404)
            for operation in ("confirm", "reject", "execute"):
                body = {"user_id": str(self.b.id)}
                if operation != "execute":
                    body["confirmation_id"] = str(self.action_a.confirmation_id)
                result = self.client.post(f"/agent/actions/{aid}/{operation}", json=body)
                self.assertEqual(result.status_code, 404)
                self.assertNotIn(str(self.a.id), result.text)
            tool.assert_not_called()
        self.db.refresh(self.action_a)
        self.assertEqual(self.action_a.status, "pending_confirmation")
        self.assertEqual(self.action_a.attempt_count, 0)

    def test_own_confirm_execute_idempotent_and_reject(self):
        aid = self.action_a.action_id
        body = {"user_id": str(self.a.id), "confirmation_id": str(self.action_a.confirmation_id)}
        self.assertEqual(self.client.post(f"/agent/actions/{aid}/confirm", json=body).status_code, 200)
        tool = Mock(return_value=ExecutorResult(outcome="test_success", data={"safe": True}))
        with patch.object(executor_service, "get_executor", return_value=tool):
            for expected_called in (True, False):
                result = self.client.post(f"/agent/actions/{aid}/execute", json={"user_id": str(self.a.id)})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()["action"]["status"], "completed")
                self.assertEqual(result.json()["executor_called"], expected_called)
            tool.assert_called_once()
        reject = self.seed_action(self.a.id)
        self.db.commit()
        result = self.client.post(f"/agent/actions/{reject.action_id}/reject", json={
            "user_id": str(self.a.id), "confirmation_id": str(reject.confirmation_id)})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["status"], "rejected")

    def test_wrong_confirmation_existing_policy_preserved(self):
        result = self.client.post(f"/agent/actions/{self.action_a.action_id}/confirm", json={
            "user_id": str(self.a.id), "confirmation_id": str(uuid4())})
        self.assertEqual(result.status_code, 403)

    def test_plan_other_conversation_or_message_rejected_by_existing_owner_validation(self):
        count = len(self.db.scalars(select(AgentAction)).all())
        for body in (self.plan_body(conversation_id=self.cb.id), self.plan_body(message_id=self.mb.id)):
            with self.subTest(body=body):
                result = self.client.post("/agent/actions/plan", json=body)
                # 기존 context 검증의 동일한 안전한 400 계약을 유지합니다.
                self.assertEqual(result.status_code, 400)
                self.assertNotIn(str(self.b.id), result.text)
                self.assertEqual(len(self.db.scalars(select(AgentAction)).all()), count)

    def test_plan_own_context_persists_and_duplicate_reuses_row(self):
        body = self.plan_body()
        ids = []
        for _ in range(2):
            result = self.client.post("/agent/actions/plan", json=body)
            self.assertEqual(result.status_code, 201)
            row = result.json()[0]
            self.assertEqual(row["user_id"], str(self.a.id))
            self.assertEqual(row["conversation_id"], str(self.ca.id))
            self.assertEqual(row["message_id"], str(self.ma.id))
            ids.append(row["id"])
        self.assertEqual(ids[0], ids[1])

    def test_domain_read_own_success_and_other_or_unknown_404(self):
        for domain, _, _ in DOMAINS:
            with self.subTest(domain=domain):
                rid = self.events[domain][0].id
                self.principal = auth.AuthPrincipal(self.a.id)
                result = self.client.get(f"/{domain}/{rid}?user_id={self.a.id}")
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()["user_id"], str(self.a.id))
                self.principal = auth.AuthPrincipal(self.b.id)
                denied = self.client.get(f"/{domain}/{rid}?user_id={self.b.id}")
                missing = self.client.get(f"/{domain}/{uuid4()}?user_id={self.b.id}")
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(denied.json(), missing.json())

    def test_domain_lists_only_principal_data_limits_preserved(self):
        for domain, _, _ in DOMAINS:
            with self.subTest(domain=domain):
                self.principal = auth.AuthPrincipal(self.b.id)
                result = self.client.get(f"/users/{self.b.id}/{domain}?limit=1")
                self.assertEqual(result.status_code, 200)
                self.assertEqual(len(result.json()), 1)
                self.assertTrue(all(row["user_id"] == str(self.b.id) for row in result.json()))
                self.assertEqual(self.client.get(f"/users/{self.b.id}/{domain}?limit=101").status_code, 422)

    def test_auth_off_keeps_all_action_and_domain_operations(self):
        self.principal = None
        os.environ["NOIE_AUTH_ENABLED"] = "false"
        self.assertEqual(self.client.get(f"/agent/actions/{self.action_b.action_id}?user_id={self.b.id}").status_code, 200)
        confirm = {"user_id": str(self.b.id), "confirmation_id": str(self.action_b.confirmation_id)}
        self.assertEqual(self.client.post(f"/agent/actions/{self.action_b.action_id}/confirm", json=confirm).status_code, 200)
        result = self.client.post(f"/agent/actions/{self.action_b.action_id}/execute", json={"user_id": str(self.b.id)})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["action"]["status"], "completed")
        reject = self.seed_action(self.b.id)
        self.db.commit()
        self.assertEqual(self.client.post(f"/agent/actions/{reject.action_id}/reject", json={
            "user_id": str(self.b.id), "confirmation_id": str(reject.confirmation_id)}).status_code, 200)
        self.assertEqual(self.client.post("/agent/actions/plan", json=self.plan_body(self.b.id, self.cb.id, self.mb.id)).status_code, 201)
        self.assertEqual(self.client.get(f"/users/{self.b.id}/agent-actions").status_code, 200)
        for domain, _, _ in DOMAINS:
            with self.subTest(domain=domain):
                rid = self.events[domain][1].id
                self.assertEqual(self.client.get(f"/{domain}/{rid}?user_id={self.b.id}").status_code, 200)
                self.assertEqual(self.client.get(f"/users/{self.b.id}/{domain}").status_code, 200)


if __name__ == "__main__":
    unittest.main()
