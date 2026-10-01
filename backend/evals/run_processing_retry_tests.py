"""실제 PostgreSQL에서 Memory extraction lease/retry 동작을 검증합니다.

OpenAI 판단 함수만 결정론적인 응답으로 바꾸며, 상태 전이와 Memory 저장은
실제 서비스 코드와 PostgreSQL transaction을 그대로 사용합니다.
"""

from __future__ import annotations

import os
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402
import memory_extraction_service as extraction_service  # noqa: E402
from database import SessionLocal  # noqa: E402
from memory_extractor import EXTRACTOR_VERSION  # noqa: E402
from memory_retriever import fetch_memory_candidates, resolve_selected_memories  # noqa: E402
from memory_schemas import (  # noqa: E402
    MemoryExtractionDecision,
    MemoryReconciliationDecision,
)
from models.chat_request import ChatRequestRecord  # noqa: E402
from models.conversation import Conversation  # noqa: E402
from models.memory import Memory, MemoryEvidence  # noqa: E402
from models.memory_extraction import MemoryExtraction  # noqa: E402
from models.message import Message  # noqa: E402
from models.user import User  # noqa: E402


RUN_ID = uuid4().hex
PREFIX = f"__noie_processing_retry_test__{RUN_ID}"
PAST = datetime.now(timezone.utc) - timedelta(minutes=10)
FUTURE = datetime.now(timezone.utc) + timedelta(minutes=10)
RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, condition, detail))
    print(f"[{'PASS' if condition else 'FAIL'}] {name}: {detail}")
    if not condition:
        raise AssertionError(f"{name}: {detail}")


def extraction_decision(
    *,
    remember: bool,
    content: str = "테스트 기억",
    kind: str = "other",
    reason: str = "processing retry test",
) -> MemoryExtractionDecision:
    return MemoryExtractionDecision(
        should_remember=remember,
        reason=reason,
        content=content,
        kind=kind,
        importance=50,
        confidence=0.9,
    )


def reconciliation_decision(
    action: str,
    matched_memory_id: UUID | None = None,
) -> MemoryReconciliationDecision:
    return MemoryReconciliationDecision(
        action=action,
        matched_memory_id=matched_memory_id,
        reason=f"test {action}",
        confidence=0.95,
    )


def create_message(conversation_id: UUID, user_id: UUID, role: str = "user") -> Message:
    with SessionLocal() as db:
        message = Message(
            conversation_id=conversation_id,
            user_id=user_id if role == "user" else None,
            role=role,
            content=f"{PREFIX}:{role}:{uuid4()}",
            metadata_={"test_run": RUN_ID},
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message


def seed_extraction(message_id: UUID, attempts: int, lease_expires_at: datetime) -> UUID:
    with SessionLocal() as db:
        row = MemoryExtraction(
            message_id=message_id,
            extractor_version=EXTRACTOR_VERSION,
            status="processing",
            attempt_count=attempts,
            processing_started_at=PAST,
            lease_expires_at=lease_expires_at,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id


def create_base_memory(user_id: UUID, message_id: UUID, content: str) -> Memory:
    with SessionLocal() as db:
        memory = Memory(
            user_id=user_id,
            content=content,
            kind="other",
            importance=50,
            confidence=0.9,
            metadata_={"test_run": RUN_ID},
        )
        db.add(memory)
        db.flush()
        db.add(MemoryEvidence(memory_id=memory.id, message_id=message_id))
        db.commit()
        db.refresh(memory)
        return memory


def configure_extraction(
    decision: MemoryExtractionDecision,
    reconciliation: MemoryReconciliationDecision | None = None,
    candidates: list[dict] | None = None,
    counter: dict[str, int] | None = None,
) -> None:
    def fake_extract(_content: str) -> MemoryExtractionDecision:
        if counter is not None:
            counter["calls"] = counter.get("calls", 0) + 1
        return decision

    extraction_service.extract_memory_with_openai = fake_extract
    extraction_service.find_reconciliation_candidates = (
        lambda _user_id, _kind: candidates or []
    )
    extraction_service.reconcile_memory_candidate = (
        lambda _candidate, _candidates: reconciliation
        or reconciliation_decision("new")
    )


def row_for(message_id: UUID) -> MemoryExtraction:
    with SessionLocal() as db:
        return db.scalar(
            select(MemoryExtraction).where(
                MemoryExtraction.message_id == message_id,
                MemoryExtraction.extractor_version == EXTRACTOR_VERSION,
            )
        )


def memory_count_for_message(message_id: UUID) -> int:
    with SessionLocal() as db:
        return db.scalar(
            select(func.count(MemoryEvidence.id)).where(
                MemoryEvidence.message_id == message_id
            )
        )


def run() -> None:
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is required")

    with SessionLocal() as db:
        user = User(name=PREFIX, metadata_={"test_run": RUN_ID})
        other_user = User(name=f"{PREFIX}:other", metadata_={"test_run": RUN_ID})
        db.add_all([user, other_user])
        db.flush()
        conversation = Conversation(
            user_id=user.id,
            title=PREFIX,
            metadata_={"test_run": RUN_ID},
        )
        db.add(conversation)
        db.commit()
        db.refresh(user)
        db.refresh(other_user)
        db.refresh(conversation)
        user_id, other_user_id, conversation_id = user.id, other_user.id, conversation.id

    # 1-2. 정상 완료 후 재호출은 OpenAI를 다시 부르지 않습니다.
    normal_message = create_message(conversation_id, user_id)
    calls = {"calls": 0}
    configure_extraction(extraction_decision(remember=False), counter=calls)
    first = extraction_service.extract_memory_for_message(normal_message.id, user_id)
    second = extraction_service.extract_memory_for_message(normal_message.id, user_id)
    record("1. 새 extraction 정상 완료", first.status == "completed", first.status)
    record(
        "2. completed 결과 재사용",
        second.id == first.id and calls["calls"] == 1,
        f"calls={calls['calls']}",
    )

    # 3. 만료 전 processing은 선점하지 않습니다.
    active_message = create_message(conversation_id, user_id)
    seed_extraction(active_message.id, 1, FUTURE)
    calls = {"calls": 0}
    configure_extraction(extraction_decision(remember=False), counter=calls)
    active = extraction_service.extract_memory_for_message(active_message.id, user_id)
    record(
        "3. 유효 lease 유지",
        active.status == "processing" and active.attempt_count == 1 and calls["calls"] == 0,
        f"attempt={active.attempt_count}, calls={calls['calls']}",
    )

    # 4-5. stale processing은 새 attempt로 완료됩니다.
    stale_message = create_message(conversation_id, user_id)
    seed_extraction(stale_message.id, 1, PAST)
    configure_extraction(extraction_decision(remember=False, reason="stale recovered"))
    stale = extraction_service.extract_memory_for_message(stale_message.id, user_id)
    record("4. stale processing retry", stale.attempt_count == 2, f"attempt={stale.attempt_count}")
    record("5. stale retry 완료", stale.status == "completed", stale.status)

    # 6. 실패는 안전하게 failed가 되고 다음 호출에서 재시도할 수 있습니다.
    failure_message = create_message(conversation_id, user_id)
    seed_extraction(failure_message.id, 1, PAST)
    extraction_service.extract_memory_with_openai = lambda _text: (_ for _ in ()).throw(RuntimeError("forced"))
    failed = extraction_service.extract_memory_for_message(failure_message.id, user_id)
    configure_extraction(extraction_decision(remember=False))
    recovered = extraction_service.extract_memory_for_message(failure_message.id, user_id)
    record(
        "6. 강제 실패 후 retry",
        failed.status == "failed" and recovered.status == "completed" and recovered.attempt_count == 3,
        f"failed={failed.status}, recovered={recovered.status}, attempt={recovered.attempt_count}",
    )

    # 7. 최대 횟수에서는 OpenAI를 호출하지 않습니다.
    max_message = create_message(conversation_id, user_id)
    seed_extraction(max_message.id, 3, PAST)
    calls = {"calls": 0}
    configure_extraction(extraction_decision(remember=False), counter=calls)
    maxed = extraction_service.extract_memory_for_message(max_message.id, user_id)
    maxed_again = extraction_service.extract_memory_for_message(max_message.id, user_id)
    record(
        "7. 최대 attempt 중단",
        maxed.status == "failed" and maxed_again.attempt_count == 3 and calls["calls"] == 0,
        f"status={maxed.status}, calls={calls['calls']}",
    )

    # 8-9. 첫 worker가 lease를 가진 동안 두 번째 worker는 NEW를 중복 생성하지 않습니다.
    concurrent_message = create_message(conversation_id, user_id)
    seed_extraction(concurrent_message.id, 1, PAST)
    entered, release = threading.Event(), threading.Event()
    calls = {"calls": 0}

    def blocking_extract(_text: str) -> MemoryExtractionDecision:
        calls["calls"] += 1
        entered.set()
        release.wait(timeout=10)
        return extraction_decision(remember=True, content=f"{PREFIX}:new")

    extraction_service.extract_memory_with_openai = blocking_extract
    extraction_service.find_reconciliation_candidates = lambda _uid, _kind: []
    extraction_service.reconcile_memory_candidate = lambda _candidate, _candidates: reconciliation_decision("new")
    holder: dict[str, MemoryExtraction] = {}
    worker = threading.Thread(
        target=lambda: holder.setdefault(
            "first",
            extraction_service.extract_memory_for_message(concurrent_message.id, user_id),
        )
    )
    worker.start()
    entered.wait(timeout=10)
    concurrent_second = extraction_service.extract_memory_for_message(concurrent_message.id, user_id)
    release.set()
    worker.join(timeout=15)
    concurrent_final = row_for(concurrent_message.id)
    record(
        "8. 동시 retry 단일 lease",
        calls["calls"] == 1 and concurrent_second.status == "processing" and concurrent_final.status == "completed",
        f"calls={calls['calls']}, attempt={concurrent_final.attempt_count}",
    )
    record(
        "9. NEW retry 중복 방지",
        memory_count_for_message(concurrent_message.id) == 1,
        f"evidence={memory_count_for_message(concurrent_message.id)}",
    )

    # 10. REINFORCE retry는 동일 evidence를 한 번만 연결합니다.
    base_evidence = create_message(conversation_id, user_id)
    base_memory = create_base_memory(user_id, base_evidence.id, f"{PREFIX}:base-reinforce")
    reinforce_message = create_message(conversation_id, user_id)
    seed_extraction(reinforce_message.id, 1, PAST)
    candidate = {"id": str(base_memory.id), "content": base_memory.content, "kind": "other", "importance": 50, "confidence": 0.9}
    configure_extraction(
        extraction_decision(remember=True, content=base_memory.content),
        reconciliation_decision("reinforce", base_memory.id),
        [candidate],
    )
    extraction_service.extract_memory_for_message(reinforce_message.id, user_id)
    extraction_service.extract_memory_for_message(reinforce_message.id, user_id)
    record(
        "10. REINFORCE evidence 중복 방지",
        memory_count_for_message(reinforce_message.id) == 1,
        f"evidence={memory_count_for_message(reinforce_message.id)}",
    )

    # 11. SUPERSEDE retry는 successor 하나만 만들고 이전 Memory 행을 보존합니다.
    supersede_evidence = create_message(conversation_id, user_id)
    old_memory = create_base_memory(user_id, supersede_evidence.id, f"{PREFIX}:old")
    supersede_message = create_message(conversation_id, user_id)
    seed_extraction(supersede_message.id, 1, PAST)
    old_candidate = {"id": str(old_memory.id), "content": old_memory.content, "kind": "other", "importance": 50, "confidence": 0.9}
    configure_extraction(
        extraction_decision(remember=True, content=f"{PREFIX}:successor"),
        reconciliation_decision("supersede", old_memory.id),
        [old_candidate],
    )
    extraction_service.extract_memory_for_message(supersede_message.id, user_id)
    extraction_service.extract_memory_for_message(supersede_message.id, user_id)
    with SessionLocal() as db:
        old = db.get(Memory, old_memory.id)
        successors = db.scalar(
            select(func.count(Memory.id)).where(Memory.supersedes_memory_id == old_memory.id)
        )
    record(
        "11. SUPERSEDE successor 중복 방지",
        old is not None and old.status == "superseded" and successors == 1,
        f"old={old.status if old else None}, successors={successors}",
    )

    # 12. 이전 attempt의 늦은 결과는 새 attempt 결과를 덮어쓰지 못합니다.
    fencing_message = create_message(conversation_id, user_id)
    extraction_id = seed_extraction(fencing_message.id, 2, FUTURE)
    new_decision = extraction_decision(remember=False, reason="new attempt wins")
    extraction_service._complete_without_memory(extraction_id, 2, new_decision)
    old_decision = extraction_decision(remember=False, reason="old stale result")
    extraction_service._complete_without_memory(extraction_id, 1, old_decision)
    fenced = row_for(fencing_message.id)
    record(
        "12. attempt fencing",
        fenced.reason == "new attempt wins" and fenced.attempt_count == 2,
        f"reason={fenced.reason}, attempt={fenced.attempt_count}",
    )

    # 13-15. API 접근 및 role 정책을 실제 DB와 라우터에서 확인합니다.
    assistant_message = create_message(conversation_id, user_id, "assistant")
    system_message = create_message(conversation_id, user_id, "system")
    client = TestClient(main.app)
    other_access = client.post(
        f"/messages/{normal_message.id}/extract-memory",
        json={"user_id": str(other_user_id)},
    )
    assistant_access = client.post(
        f"/messages/{assistant_message.id}/extract-memory",
        json={"user_id": str(user_id)},
    )
    system_access = client.post(
        f"/messages/{system_message.id}/extract-memory",
        json={"user_id": str(user_id)},
    )
    missing_access = client.post(
        f"/messages/{uuid4()}/extract-memory",
        json={"user_id": str(user_id)},
    )
    record("13. 다른 사용자 접근 차단", other_access.status_code == 403, str(other_access.status_code))
    record(
        "14. assistant/system 정책",
        assistant_access.status_code == 400 and system_access.status_code == 400,
        f"assistant={assistant_access.status_code}, system={system_access.status_code}",
    )
    record("15. 없는 message 404", missing_access.status_code == 404, str(missing_access.status_code))

    # 16-18. 테스트 전용 conversation으로 /chat, DB health, request_id 재사용을 확인합니다.
    os.environ["NOIE_DEV_USER_ID"] = str(user_id)
    os.environ["NOIE_DEV_CONVERSATION_ID"] = str(conversation_id)
    main.analyze_text = lambda text: (
        {
            "input": text,
            "user_view": {
                "primary_axis": {"like": "Mid", "dislike": "Low"},
                "emotion_axis": {key: "Low" for key in "FADJCGTR"},
                "state_summary": "processing retry test",
            },
            "admin_view": {
                "primary_axis": {"like": 0.5, "dislike": 0.1},
                "emotion_axis": {key: 0.1 for key in "FADJCGTR"},
            },
            "source": "rule_based",
        },
        "rule_based",
    )
    main.generate_chat_reply_with_openai = lambda **_kwargs: "processing retry test reply"
    main.retrieve_relevant_memories_safe = lambda _uid, _text: []
    main.run_memory_extraction_background = lambda _message_id: None
    request_id = uuid4()
    payload = {"text": f"{PREFIX}:chat", "request_id": str(request_id), "messages": []}
    chat_first = client.post("/chat", json=payload)
    chat_second = client.post("/chat", json=payload)
    db_health = client.get("/db-health")
    with SessionLocal() as db:
        chat_record = db.get(ChatRequestRecord, request_id)
        request_messages = db.scalar(
            select(func.count(Message.id)).where(
                Message.metadata_["request_id"].as_string() == str(request_id)
            )
        )
    record("16. /chat 정상", chat_first.status_code == 200, str(chat_first.status_code))
    record("17. /db-health 200", db_health.status_code == 200, str(db_health.status_code))
    record(
        "18. request_id idempotency",
        chat_second.status_code == 200
        and chat_second.json() == chat_first.json()
        and chat_record.status == "completed"
        and request_messages == 2,
        f"messages={request_messages}, status={chat_record.status}",
    )

    # 19. 실제 DB 후보 조회와 기존 threshold/Top-K 선택 로직을 함께 확인합니다.
    candidates = fetch_memory_candidates(user_id)
    selected = resolve_selected_memories(
        [
            {
                "memory_id": str(candidates[0].memory_id),
                "relevance": 0.9,
                "reason": "processing retry test",
            }
        ],
        candidates,
    )
    record(
        "19. Memory Retrieval 정상",
        bool(candidates) and len(selected) == 1 and selected[0].relevance == 0.9,
        f"candidates={len(candidates)}, selected={len(selected)}",
    )

    print(f"TEST_RUN_ID={RUN_ID}")
    print(f"TEST_USER_ID={user_id}")
    print(f"TEST_CONVERSATION_ID={conversation_id}")
    print(f"SUMMARY={sum(ok for _, ok, _ in RESULTS)}/{len(RESULTS)}")


if __name__ == "__main__":
    run()
