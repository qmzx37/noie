"""NOIE Memory OFF/ON을 같은 질문으로 비교하는 read-only 평가 runner입니다."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from dotenv import load_dotenv
from openai import OpenAI
from sqlalchemy import func, select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import SessionLocal  # noqa: E402
from memory_retriever import (  # noqa: E402
    MAX_MEMORY_CANDIDATES,
    MAX_SELECTED_MEMORIES,
    MIN_RELEVANCE,
    resolve_selected_memories,
    select_relevant_memories,
)
from memory_schemas import MemoryRetrievalCandidate  # noqa: E402
from models.chat_request import ChatRequestRecord  # noqa: E402
from models.memory import Memory, MemoryEvidence  # noqa: E402
from models.memory_extraction import MemoryExtraction  # noqa: E402
from models.message import Message  # noqa: E402
from openai_analyzer import (  # noqa: E402
    extract_output_text,
    generate_chat_reply_with_openai,
)


load_dotenv(BACKEND_DIR / ".env")

DEFAULT_CASES_PATH = Path(__file__).with_name("memory_eval_cases.json")
DEFAULT_RESULTS_DIR = Path(__file__).with_name("results")
TABLE_MODELS = {
    "messages": Message,
    "memories": Memory,
    "memory_evidence": MemoryEvidence,
    "memory_extractions": MemoryExtraction,
    "chat_requests": ChatRequestRecord,
}

NEUTRAL_USER_VIEW = {
    "primary_axis": {"like": "Low", "dislike": "Low"},
    "emotion_axis": {
        "F": "Low",
        "A": "Low",
        "D": "Low",
        "J": "Low",
        "C": "Low",
        "G": "Low",
        "T": "Low",
        "R": "Low",
    },
    "state_summary": "현재 질문을 중심으로 답변할 상태입니다.",
}


def fixture_uuid(case_id: str, fixture_key: str) -> UUID:
    """DB UUID 대신 case/key에서 항상 같은 평가용 UUID를 만듭니다."""

    return uuid5(NAMESPACE_URL, f"noie-memory-eval:{case_id}:{fixture_key}")


def load_cases(path: Path, limit: int | None) -> list[dict[str, Any]]:
    cases = json.loads(path.read_text(encoding="utf-8"))
    return cases[:limit] if limit else cases


def database_counts() -> dict[str, int] | None:
    """평가가 production 데이터를 바꾸지 않았음을 전후 row count로 확인합니다."""

    if SessionLocal is None:
        return None
    with SessionLocal() as db:
        return {
            name: db.scalar(select(func.count()).select_from(model)) or 0
            for name, model in TABLE_MODELS.items()
        }


def prepare_candidates(case: dict[str, Any]) -> tuple[list[MemoryRetrievalCandidate], dict[UUID, str]]:
    """fixture를 production 후보 제한과 같은 우선순위로 정리합니다."""

    user_key = case.get("user_key", "user-a")
    active = [
        memory
        for memory in case.get("memories", [])
        if memory.get("user_key", user_key) == user_key
        and memory.get("status", "active") == "active"
        and not memory.get("deleted", False)
    ]
    active.sort(
        key=lambda memory: (
            memory.get("importance") is not None,
            memory.get("importance") or -1,
            memory.get("confidence") is not None,
            memory.get("confidence") or -1,
            memory.get("recency", 0),
        ),
        reverse=True,
    )
    active = active[:MAX_MEMORY_CANDIDATES]

    id_to_key: dict[UUID, str] = {}
    candidates: list[MemoryRetrievalCandidate] = []
    for memory in active:
        memory_id = fixture_uuid(case["id"], memory["fixture_key"])
        id_to_key[memory_id] = memory["fixture_key"]
        candidates.append(
            MemoryRetrievalCandidate(
                memory_id=memory_id,
                content=memory["content"],
                kind=memory.get("kind", "other"),
                importance=memory.get("importance"),
                confidence=memory.get("confidence"),
            )
        )
    return candidates, id_to_key


def normalize(value: str) -> str:
    return "".join(value.lower().split())


def fact_coverage(answer: str, expected_facts: list[list[str]]) -> tuple[int, int, list[bool]]:
    """각 fact의 대체 표현 중 하나라도 있으면 해당 사실을 포함한 것으로 봅니다."""

    normalized_answer = normalize(answer)
    hits = [
        any(normalize(alternative) in normalized_answer for alternative in fact)
        for fact in expected_facts
    ]
    return sum(hits), len(hits), hits


def contains_forbidden_fact(answer: str, forbidden_facts: list[str]) -> bool:
    normalized_answer = normalize(answer)
    return any(normalize(fact) in normalized_answer for fact in forbidden_facts)


def generate_answer(query: str, memories: list[str]) -> str:
    """production 일반 답변 함수를 사용하며 Memory context만 OFF/ON으로 바꿉니다."""

    return generate_chat_reply_with_openai(
        text=query,
        state_summary=NEUTRAL_USER_VIEW["state_summary"],
        user_view=NEUTRAL_USER_VIEW,
        messages=[],
        relevant_memories=memories,
    )


def judge_answers(
    case: dict[str, Any],
    memory_off_answer: str,
    memory_on_answer: str,
    selected_contents: list[str],
) -> dict[str, Any]:
    """선택적 LLM Judge이며 deterministic metrics와 별도로 저장합니다."""

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY가 설정되지 않았습니다.")
    schema = {
        "type": "object",
        "properties": {
            "factual_correctness": {"type": "integer", "minimum": 1, "maximum": 5},
            "relevance": {"type": "integer", "minimum": 1, "maximum": 5},
            "personalization": {"type": "integer", "minimum": 1, "maximum": 5},
            "unnecessary_memory_leakage": {"type": "integer", "minimum": 1, "maximum": 5},
            "current_utterance_priority": {"type": "integer", "minimum": 1, "maximum": 5},
            "preferred_answer": {"type": "string", "enum": ["off", "on", "tie"]},
            "reason": {"type": "string"},
        },
        "required": [
            "factual_correctness",
            "relevance",
            "personalization",
            "unnecessary_memory_leakage",
            "current_utterance_priority",
            "preferred_answer",
            "reason",
        ],
        "additionalProperties": False,
    }
    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model=os.getenv("OPENAI_MEMORY_MODEL", os.getenv("OPENAI_MODEL", "gpt-4.1-mini")),
        input=[
            {
                "role": "system",
                "content": (
                    "너는 Memory OFF/ON 답변을 비교하는 평가자다. 길이가 아니라 사실 정확성, "
                    "관련성, 필요한 개인화, 불필요한 기억 노출, 현재 발화 우선을 평가한다. "
                    "Memory는 AI 해석일 수 있으므로 절대적 사실로 취급하지 않는다."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "query": case["query"],
                        "expected_facts": case.get("expected_facts", []),
                        "forbidden_answer_facts": case.get("forbidden_answer_facts", []),
                        "selected_memories": selected_contents,
                        "memory_off_answer": memory_off_answer,
                        "memory_on_answer": memory_on_answer,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "memory_eval_judge",
                "schema": schema,
                "strict": True,
            }
        },
    )
    return json.loads(extract_output_text(response))


def evaluate_case(case: dict[str, Any], use_judge: bool) -> dict[str, Any]:
    candidates, id_to_key = prepare_candidates(case)
    raw_selected = select_relevant_memories(case["query"], candidates)
    selected = resolve_selected_memories(raw_selected, candidates)
    selected_keys = [id_to_key[memory.memory_id] for memory in selected]
    selected_contents = [memory.content for memory in selected]

    memory_off_answer = generate_answer(case["query"], [])
    memory_on_answer = generate_answer(case["query"], selected_contents)

    expected_keys = set(case.get("expected_memory_keys", []))
    forbidden_keys = set(case.get("forbidden_memory_keys", []))
    selected_key_set = set(selected_keys)
    retrieval_pass = expected_keys.issubset(selected_key_set)
    irrelevant_selected = sorted(selected_key_set & forbidden_keys)
    retrieval_pass = retrieval_pass and not irrelevant_selected

    expected_facts = case.get("expected_facts", [])
    off_hits, fact_total, off_fact_results = fact_coverage(memory_off_answer, expected_facts)
    on_hits, _fact_total, on_fact_results = fact_coverage(memory_on_answer, expected_facts)
    forbidden_answer_facts = case.get("forbidden_answer_facts", [])
    off_forbidden = contains_forbidden_fact(memory_off_answer, forbidden_answer_facts)
    on_forbidden = contains_forbidden_fact(memory_on_answer, forbidden_answer_facts)
    answer_pass = on_hits == fact_total and not on_forbidden

    current_priority_case = case.get("category") == "current_utterance_priority"
    current_priority_pass = answer_pass if current_priority_case else None

    result: dict[str, Any] = {
        "id": case["id"],
        "category": case["category"],
        "query": case["query"],
        "notes": case.get("notes", ""),
        "candidate_memories": [
            {**candidate.model_dump(mode="json"), "fixture_key": id_to_key[candidate.memory_id]}
            for candidate in candidates
        ],
        "selected_memories": [
            {**memory.model_dump(mode="json"), "fixture_key": id_to_key[memory.memory_id]}
            for memory in selected
        ],
        "expected_memory_keys": sorted(expected_keys),
        "forbidden_memory_keys": sorted(forbidden_keys),
        "irrelevant_selected_keys": irrelevant_selected,
        "retrieval_pass": retrieval_pass,
        "expect_no_memory": case.get("expect_no_memory", False),
        "memory_off_answer": memory_off_answer,
        "memory_on_answer": memory_on_answer,
        "off_fact_hits": off_hits,
        "on_fact_hits": on_hits,
        "fact_total": fact_total,
        "off_fact_results": off_fact_results,
        "on_fact_results": on_fact_results,
        "off_forbidden_fact": off_forbidden,
        "on_forbidden_fact": on_forbidden,
        "answer_pass": answer_pass,
        "current_priority_pass": current_priority_pass,
        "memory_improved": on_hits > off_hits and not on_forbidden,
        "memory_regressed": on_hits < off_hits or (on_forbidden and not off_forbidden),
    }
    result["llm_judge"] = (
        judge_answers(case, memory_off_answer, memory_on_answer, selected_contents)
        if use_judge
        else None
    )
    return result


def safe_rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    retrieval_cases = [result for result in results if result["expected_memory_keys"]]
    retrieval_hits = sum(result["retrieval_pass"] for result in retrieval_cases)
    total_selected = sum(len(result["selected_memories"]) for result in results)
    irrelevant_selected = sum(len(result["irrelevant_selected_keys"]) for result in results)
    no_memory_cases = [result for result in results if result["expect_no_memory"]]
    no_memory_hits = sum(not result["selected_memories"] for result in no_memory_cases)
    priority_cases = [
        result for result in results if result["current_priority_pass"] is not None
    ]
    priority_hits = sum(bool(result["current_priority_pass"]) for result in priority_cases)
    off_hits = sum(result["off_fact_hits"] for result in results)
    on_hits = sum(result["on_fact_hits"] for result in results)
    facts = sum(result["fact_total"] for result in results)

    return {
        "cases": len(results),
        "retrieval_hit_rate": {
            "hits": retrieval_hits,
            "total": len(retrieval_cases),
            "rate": safe_rate(retrieval_hits, len(retrieval_cases)),
        },
        "irrelevant_retrieval_rate": {
            "irrelevant_selected": irrelevant_selected,
            "total_selected": total_selected,
            "rate": safe_rate(irrelevant_selected, total_selected),
        },
        "no_memory_precision": {
            "hits": no_memory_hits,
            "total": len(no_memory_cases),
            "rate": safe_rate(no_memory_hits, len(no_memory_cases)),
        },
        "current_utterance_priority": {
            "hits": priority_hits,
            "total": len(priority_cases),
            "rate": safe_rate(priority_hits, len(priority_cases)),
        },
        "answer_fact_coverage": {
            "memory_off_hits": off_hits,
            "memory_on_hits": on_hits,
            "total_facts": facts,
            "memory_off_rate": safe_rate(off_hits, facts),
            "memory_on_rate": safe_rate(on_hits, facts),
            "improvement_points": round(
                (safe_rate(on_hits, facts) - safe_rate(off_hits, facts)) * 100,
                2,
            ),
        },
        "memory_improved_cases": sum(result["memory_improved"] for result in results),
        "memory_regressed_cases": sum(result["memory_regressed"] for result in results),
        "retrieval_failed_case_ids": [
            result["id"] for result in results if not result["retrieval_pass"]
        ],
    }


def write_results(
    results_dir: Path,
    results: list[dict[str, Any]],
    summary: dict[str, Any],
    metadata: dict[str, Any],
) -> tuple[Path, Path]:
    results_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = results_dir / f"memory_eval_{timestamp}.json"
    csv_path = results_dir / f"memory_eval_{timestamp}.csv"
    json_path.write_text(
        json.dumps(
            {"metadata": metadata, "summary": summary, "cases": results},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    with csv_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        fieldnames = [
            "id",
            "category",
            "query",
            "memory_off_answer",
            "memory_on_answer",
            "candidate_memories",
            "selected_memories",
            "expected_memory_keys",
            "retrieval_pass",
            "answer_pass",
            "off_fact_hits",
            "on_fact_hits",
            "fact_total",
            "memory_improved",
            "memory_regressed",
            "llm_judge",
        ]
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for result in results:
            row = {key: result.get(key) for key in fieldnames}
            for key in [
                "candidate_memories",
                "selected_memories",
                "expected_memory_keys",
                "llm_judge",
            ]:
                row[key] = json.dumps(row[key], ensure_ascii=False)
            writer.writerow(row)
    return json_path, csv_path


def print_summary(summary: dict[str, Any]) -> None:
    print("\n=== NOIE Memory Evaluation Summary ===")
    print(f"Cases: {summary['cases']}")
    for key in [
        "retrieval_hit_rate",
        "irrelevant_retrieval_rate",
        "no_memory_precision",
        "current_utterance_priority",
    ]:
        metric = summary[key]
        numerator = metric.get("hits", metric.get("irrelevant_selected", 0))
        denominator = metric.get("total", metric.get("total_selected", 0))
        print(f"{key}: {numerator} / {denominator} = {metric['rate']:.1%}")
    coverage = summary["answer_fact_coverage"]
    print(
        "answer_fact_coverage: "
        f"OFF={coverage['memory_off_rate']:.1%}, "
        f"ON={coverage['memory_on_rate']:.1%}, "
        f"improvement={coverage['improvement_points']:+.2f} percentage points"
    )
    print(f"memory_improved_cases: {summary['memory_improved_cases']}")
    print(f"memory_regressed_cases: {summary['memory_regressed_cases']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES_PATH)
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--limit", type=int, default=None)
    judge_group = parser.add_mutually_exclusive_group()
    judge_group.add_argument("--judge", action="store_true")
    judge_group.add_argument("--no-judge", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cases = load_cases(args.cases, args.limit)
    use_judge = bool(args.judge and not args.no_judge)
    estimated_calls = sum(2 + bool(case.get("memories")) + use_judge for case in cases)
    print(
        f"Cases={len(cases)}, judge={use_judge}, "
        f"estimated OpenAI calls<={estimated_calls}"
    )

    before_counts = database_counts()
    results = []
    for index, case in enumerate(cases, start=1):
        print(f"[{index}/{len(cases)}] {case['id']}: {case['category']}")
        try:
            results.append(evaluate_case(case, use_judge))
        except Exception as error:
            print(f"  failed: {type(error).__name__}: {error}")
            results.append(
                {
                    "id": case["id"],
                    "category": case["category"],
                    "query": case["query"],
                    "expected_memory_keys": case.get("expected_memory_keys", []),
                    "selected_memories": [],
                    "irrelevant_selected_keys": [],
                    "retrieval_pass": False,
                    "expect_no_memory": case.get("expect_no_memory", False),
                    "memory_off_answer": "",
                    "memory_on_answer": "",
                    "off_fact_hits": 0,
                    "on_fact_hits": 0,
                    "fact_total": len(case.get("expected_facts", [])),
                    "current_priority_pass": False
                    if case.get("category") == "current_utterance_priority"
                    else None,
                    "memory_improved": False,
                    "memory_regressed": False,
                    "error": type(error).__name__,
                }
            )

    after_counts = database_counts()
    database_unchanged = before_counts == after_counts
    if not database_unchanged:
        raise RuntimeError(
            f"Evaluation changed database row counts: before={before_counts}, after={after_counts}"
        )

    summary = summarize(results)
    metadata = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "judge_enabled": use_judge,
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "memory_model": os.getenv("OPENAI_MEMORY_MODEL", os.getenv("OPENAI_MODEL", "gpt-4.1-mini")),
        "candidate_limit": MAX_MEMORY_CANDIDATES,
        "top_k": MAX_SELECTED_MEMORIES,
        "relevance_threshold": MIN_RELEVANCE,
        "estimated_openai_calls": estimated_calls,
        "database_counts_before": before_counts,
        "database_counts_after": after_counts,
        "database_unchanged": database_unchanged,
    }
    json_path, csv_path = write_results(args.results_dir, results, summary, metadata)
    print_summary(summary)
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    print(f"Database unchanged: {database_unchanged}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
