"""G1 최소 runtime closure를 검사합니다. 운영 DB/모델 대신 합성 SQLite와 SDK 대역만 사용합니다."""

from contextlib import contextmanager, redirect_stdout
from io import StringIO
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

if __name__ == "__main__":
    from evals.run_security_adversarial_verification import isolate
    isolate(legacy_fixtures=True)
if os.getenv("NOIE_SECURITY119_ISOLATED") != "1":
    raise RuntimeError("Use the isolated security runner; live resources are forbidden")

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import chat_persistence_service as persistence
import lv4_production_service as production
import main
import message_ownership
import private_model_access
import resource_budget
from agent.lv4.context_bridge import ContextProviders, Lv4ContextBridge
from agent.lv4.recommendation_specialist import RecommendationDecision
from agent.recommendation_schemas import RecommendationArguments
from private_model_access import (
    PrivateModelAccessDenied, private_model_access_scope, require_private_model_access,
)


@contextmanager
def active_users():
    """조회에 필요한 두 컬럼만 합성 DB에 만들며 repository 모델/운영 데이터를 변경하지 않습니다."""
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    owner, deleted = uuid4(), uuid4()
    sessions = []

    class ReadSession(Session):
        """권한 검사 세션이 SDK 대역 호출 전에 닫혔는지 관찰합니다."""

        def close(self):
            """기존 close를 실행하고 테스트용 완료 표시만 남깁니다."""
            super().close()
            self.was_closed = True

    def factory():
        """실제 SQLAlchemy SELECT를 수행하는 새 세션을 매번 반환합니다."""
        db = ReadSession(engine)
        db.was_closed = False
        sessions.append(db)
        return db

    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE users (id CHAR(32) PRIMARY KEY, deleted_at DATETIME)")
            connection.execute(text("INSERT INTO users (id, deleted_at) VALUES (:id, :deleted)"),
                               [{"id": owner.hex, "deleted": None},
                                {"id": deleted.hex, "deleted": "2026-10-08 00:00:00"}])
        with patch.object(persistence, "SessionLocal", side_effect=factory):
            yield SimpleNamespace(owner=owner, deleted=deleted, engine=engine, sessions=sessions)
    finally:
        for db in sessions:
            db.close()
        engine.dispose()


class RuntimeClosureTests(unittest.TestCase):
    """외부 모듈이나 dirty tree에서 몰래 import하지 않고 필요한 내부 계약을 확인합니다."""

    def test_runtime_imports_are_from_this_tree(self):
        """격리 archive에서 실행하면 모든 runtime import도 그 archive 내부여야 합니다."""
        root = Path(__file__).resolve().parents[1]
        for module in (main, production, persistence, resource_budget,
                       message_ownership, private_model_access):
            self.assertTrue(Path(module.__file__).resolve().is_relative_to(root))
        self.assertTrue(any(getattr(route, "path", None) == "/chat" for route in main.app.routes))

    def test_active_owner_real_query_closes_session(self):
        """활성 계정의 원래 UUID만 조회하고 transaction/세션을 반환 전에 닫습니다."""
        with active_users() as fixture:
            persistence.require_active_chat_user(fixture.owner)
            self.assertEqual(len(fixture.sessions), 1)
            self.assertTrue(fixture.sessions[0].was_closed)
            self.assertFalse(fixture.sessions[0].in_transaction())

    def test_missing_owner_has_no_dev_fallback(self):
        """존재하지 않는 계정은 개발 계정으로 바꾸거나 생성하지 않습니다."""
        with active_users() as fixture, patch.object(persistence, "create_user") as create, \
                patch.dict(os.environ, {"NOIE_DEV_USER_ID": str(fixture.owner)}):
            with self.assertRaises(persistence.AuthenticatedOwnershipError):
                persistence.require_active_chat_user(uuid4())
        create.assert_not_called()

    def test_deleted_owner_is_rejected(self):
        """실제 deleted_at 값이 있는 합성 계정은 SELECT 결과에서 제외됩니다."""
        with active_users() as fixture:
            with self.assertRaises(persistence.AuthenticatedOwnershipError):
                persistence.require_active_chat_user(fixture.deleted)
            self.assertTrue(fixture.sessions[0].was_closed)

    def test_unconfigured_database_or_invalid_owner_is_rejected(self):
        """DB 없음과 잘못된 내부 ID도 fail-closed이며 fallback 권한이 아닙니다."""
        with patch.object(persistence, "SessionLocal", None):
            with self.assertRaises(persistence.AuthenticatedOwnershipError):
                persistence.require_active_chat_user(uuid4())
        with patch.object(persistence, "SessionLocal") as factory:
            with self.assertRaises(persistence.AuthenticatedOwnershipError):
                persistence.require_active_chat_user("invalid")
            factory.assert_not_called()

    def test_database_failure_becomes_private_access_denial(self):
        """DB 예외는 private 데이터 전송을 허용하지 않으며 callback 종료 후 요청 간에 남지 않습니다."""
        with patch.object(persistence, "SessionLocal", side_effect=RuntimeError("synthetic-db-failure")), \
                private_model_access_scope(lambda: persistence.require_active_chat_user(uuid4())):
            with self.assertRaises(PrivateModelAccessDenied):
                require_private_model_access()
        require_private_model_access()

    def test_nested_scope_cannot_replace_parent_denial(self):
        """내부의 허용 callback이 상위 인증/권한 거부를 대체하지 못합니다."""
        denied = Mock(side_effect=PermissionError("synthetic-denial"))
        with private_model_access_scope(denied), private_model_access_scope(lambda: None):
            with self.assertRaises(PrivateModelAccessDenied):
                require_private_model_access()
        denied.assert_called_once()
        require_private_model_access()

    def test_message_owner_contract(self):
        """user는 같은 작성자여야 하고 assistant/system의 NULL은 기존 계약대로 허용합니다."""
        owner, other = uuid4(), uuid4()
        for role in ("user", "assistant", "system"):
            self.assertTrue(message_ownership.message_has_owner(SimpleNamespace(role=role, user_id=owner), owner))
            self.assertFalse(message_ownership.message_has_owner(SimpleNamespace(role=role, user_id=other), owner))
            self.assertEqual(message_ownership.message_has_owner(SimpleNamespace(role=role, user_id=None), owner),
                             role != "user")
        self.assertFalse(message_ownership.message_has_owner(None, owner))

    def test_model_budget_rejects_before_sdk(self):
        """closure에 포함하는 facade는 기존 모델 예산 초과를 provider 호출 전에 거부합니다."""
        create = Mock()
        sdk = SimpleNamespace(responses=SimpleNamespace(create=create))
        with resource_budget.model_budget_scope() as budget:
            budget.calls = resource_budget.MAX_MODEL_CALLS
            with self.assertRaises(resource_budget.ResourceBudgetExceeded):
                resource_budget.budgeted_client(sdk).responses.create(model="synthetic", input="synthetic")
        create.assert_not_called()


class Lv4ProductionClosureTests(unittest.TestCase):
    """/chat entrypoint는 바꾸지 않고 committed production service를 직접 검증합니다."""

    def run_production(self, fixture, reasoner, *, deactivate_in_bridge=False):
        """기존 네 Specialist를 실행하며 조회와 SDK 대역 사이에 DB lock을 유지하지 않습니다."""
        question = "지금 개발할까 쉴까?"
        bridge = Lv4ContextBridge(ContextProviders())

        def build(**kwargs):
            """실제 Bridge 이후 권한이 달라지는 경계를 합성 DB에서 재현합니다."""
            result = bridge.build(**kwargs)
            if deactivate_in_bridge:
                with fixture.engine.begin() as connection:
                    connection.execute(text("UPDATE users SET deleted_at = :deleted WHERE id = :id"),
                                       {"id": fixture.owner.hex, "deleted": "2026-10-08 00:00:00"})
            return result

        context = persistence.ChatPersistenceContext(fixture.owner, uuid4(), uuid4(), uuid4())
        with patch.dict(os.environ, {"NOIE_LV4_PRODUCTION_ENABLED": "true"}), \
                patch.object(production, "_make_bridge", return_value=SimpleNamespace(build=build)), \
                patch.object(production, "read_behavior", return_value=[]), \
                patch.object(production, "OpenAIRecommendationAdapter", return_value=reasoner), \
                redirect_stdout(StringIO()):
            return production.try_lv4_production_reply(context=context, text=question, memories=[])

    def test_active_production_pipeline_returns_suggest(self):
        """활성 계정은 기존 Suggest 결과를 반환하고 권한 검사 세션은 생성기 호출 전에 닫힙니다."""
        with active_users() as fixture:
            def generate(context, evidence):
                """모델 대역의 입력은 실제 네 Specialist가 준비하며 외부 통신은 하지 않습니다."""
                self.assertTrue(all(db.was_closed for db in fixture.sessions))
                return RecommendationDecision(recommendation=RecommendationArguments(
                    primary_action="잠깐 쉬어볼까요?", rationale="현재 선택 질문의 후보입니다.",
                    confidence=.7, recommendation_kind="direct"), used_evidence_refs=["current"])
            reasoner = Mock(side_effect=generate)
            reply = self.run_production(fixture, reasoner)
            self.assertIsInstance(reply, str)
            self.assertIn("잠깐 쉬어볼까요?", reply)
            reasoner.assert_called_once()
            self.assertGreaterEqual(len(fixture.sessions), 3)

    def test_production_deactivation_before_model_blocks_generation(self):
        """Bridge 구성 중 비활성화되면 모델 대역도 호출하지 않고 권한 거부를 전파합니다."""
        with active_users() as fixture:
            reasoner = Mock()
            with self.assertRaises(PrivateModelAccessDenied):
                self.run_production(fixture, reasoner, deactivate_in_bridge=True)
            reasoner.assert_not_called()

    def test_production_off_does_not_query_or_generate(self):
        """기존 기본 OFF 정책에서는 개인 context나 모델을 준비하지 않습니다."""
        with patch.dict(os.environ, {"NOIE_LV4_PRODUCTION_ENABLED": "false"}), \
                patch.object(production, "require_active_chat_user") as owner, \
                patch.object(production, "_make_bridge") as bridge, \
                redirect_stdout(StringIO()):
            self.assertIsNone(production.try_lv4_production_reply(context=None, text="synthetic", memories=[]))
        owner.assert_not_called()
        bridge.assert_not_called()


if __name__ == "__main__":
    unittest.main()
