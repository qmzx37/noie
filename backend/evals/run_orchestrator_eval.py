"""NOIE Orchestrator v0.1 routing을 20개 고정 사례로 평가합니다."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import func, select


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agent.orchestrator import orchestrate_with_openai  # noqa: E402
from agent.schemas import OrchestratorMemoryContext  # noqa: E402
from database import SessionLocal  # noqa: E402
from models.chat_request import ChatRequestRecord  # noqa: E402
from models.memory import Memory, MemoryEvidence  # noqa: E402
from models.memory_extraction import MemoryExtraction  # noqa: E402
from models.message import Message  # noqa: E402


DEFAULT_CASES = Path(__file__).with_name("orchestrator_eval_cases.json")
TABLE_MODELS = [Message, Memory, MemoryEvidence, MemoryExtraction, ChatRequestRecord]


def database_counts() -> dict[str, int] | None:
    if SessionLocal is None:
        return None
    with SessionLocal() as db:
        return {
            model.__tablename__: db.scalar(select(func.count()).select_from(model)) or 0
            for model in TABLE_MODELS
        }


def evaluate_case(case: dict[str, Any]) -> dict[str, Any]:
    memories = [
        OrchestratorMemoryContext.model_validate(memory)
        for memory in case.get("memories", [])
    ]
    result = orchestrate_with_openai(case["text"], memories)
    actions_by_type: dict[str, list] = {}
    for action in result.actions:
        actions_by_type.setdefault(action.type, []).append(action)

    failures: list[str] = []
    expected_needs_action = case.get("needs_action", bool(case.get("expected")))
    if result.needs_action != expected_needs_action:
        failures.append(f"needs_action={result.needs_action}")

    type_checks: list[bool] = []
    mode_checks: list[bool] = []
    confirmation_checks: list[bool] = []
    for expected in case.get("expected", []):
        candidates = actions_by_type.get(expected["type"], [])
        type_checks.append(bool(candidates))
        if not candidates:
            failures.append(f"missing:{expected['type']}")
            if "mode" in expected:
                mode_checks.append(False)
            if "requires_confirmation" in expected:
                confirmation_checks.append(False)
            continue
        if "mode" in expected:
            mode_checks.append(any(action.mode == expected["mode"] for action in candidates))
        if "requires_confirmation" in expected:
            confirmation_checks.append(
                any(
                    action.requires_confirmation == expected["requires_confirmation"]
                    for action in candidates
                )
            )
        matching = [
            action
            for action in candidates
            if ("mode" not in expected or action.mode == expected["mode"])
            and ("intent" not in expected or action.intent == expected["intent"])
            and (
                "requires_confirmation" not in expected
                or action.requires_confirmation == expected["requires_confirmation"]
            )
            and action.confidence >= expected.get("min_confidence", 0.0)
            and action.confidence <= expected.get("max_confidence", 1.0)
        ]
        if not matching:
            failures.append(f"mismatch:{expected['type']}")

    actual_types = set(actions_by_type)
    forbidden = actual_types & set(case.get("forbidden_types", []))
    if forbidden:
        failures.append(f"forbidden:{sorted(forbidden)}")
    if len(result.actions) < case.get("min_actions", 0):
        failures.append(f"too_few:{len(result.actions)}")
    if len(result.actions) > case.get("max_actions", 12):
        failures.append(f"too_many:{len(result.actions)}")

    reasons = " ".join(action.reason for action in result.actions)
    required_terms = case.get("reason_must_include_any", [])
    if required_terms and not any(term in reasons for term in required_terms):
        failures.append("current_utterance_not_reflected")
    forbidden_terms = case.get("reason_forbidden_terms", [])
    leaked_terms = [term for term in forbidden_terms if term in reasons]
    if leaked_terms:
        failures.append(f"overclaim:{leaked_terms}")

    multi_expected = case.get("min_actions", 0) > 1
    multi_pass = not multi_expected or len(result.actions) >= case["min_actions"]
    priority_expected = bool(case.get("current_utterance_priority"))
    priority_pass = not priority_expected or "current_utterance_not_reflected" not in failures
    overselection_case = case.get("max_actions") == 0
    overselection_pass = not overselection_case or not result.actions

    return {
        "id": case["id"],
        "text": case["text"],
        "passed": not failures,
        "failures": failures,
        "result": result.model_dump(),
        "metrics": {
            "type_checks": type_checks,
            "mode_checks": mode_checks,
            "confirmation_checks": confirmation_checks,
            "forbidden_pass": not forbidden,
            "multi_expected": multi_expected,
            "multi_pass": multi_pass,
            "priority_expected": priority_expected,
            "priority_pass": priority_pass,
            "overselection_case": overselection_case,
            "overselection_pass": overselection_pass,
        },
    }


def rate(hits: int, total: int) -> float:
    return round(hits / total, 4) if total else 1.0


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    metric_rows = [result.get("metrics", {}) for result in results]
    type_checks = [value for row in metric_rows for value in row.get("type_checks", [])]
    mode_checks = [value for row in metric_rows for value in row.get("mode_checks", [])]
    confirmation_checks = [
        value for row in metric_rows for value in row.get("confirmation_checks", [])
    ]
    multi = [row for row in metric_rows if row.get("multi_expected")]
    priority = [row for row in metric_rows if row.get("priority_expected")]
    overselection = [row for row in metric_rows if row.get("overselection_case")]
    return {
        "cases": {"hits": sum(result["passed"] for result in results), "total": len(results)},
        "action_type_accuracy": {"hits": sum(type_checks), "total": len(type_checks), "rate": rate(sum(type_checks), len(type_checks))},
        "mode_accuracy": {"hits": sum(mode_checks), "total": len(mode_checks), "rate": rate(sum(mode_checks), len(mode_checks))},
        "confirmation_accuracy": {"hits": sum(confirmation_checks), "total": len(confirmation_checks), "rate": rate(sum(confirmation_checks), len(confirmation_checks))},
        "forbidden_type_pass_rate": {"hits": sum(row.get("forbidden_pass", False) for row in metric_rows), "total": len(metric_rows), "rate": rate(sum(row.get("forbidden_pass", False) for row in metric_rows), len(metric_rows))},
        "multi_action_accuracy": {"hits": sum(row["multi_pass"] for row in multi), "total": len(multi), "rate": rate(sum(row["multi_pass"] for row in multi), len(multi))},
        "current_utterance_priority": {"hits": sum(row["priority_pass"] for row in priority), "total": len(priority), "rate": rate(sum(row["priority_pass"] for row in priority), len(priority))},
        "overselection_avoidance": {"hits": sum(row["overselection_pass"] for row in overselection), "total": len(overselection), "rate": rate(sum(row["overselection_pass"] for row in overselection), len(overselection))},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    if args.limit:
        cases = cases[: args.limit]

    before = database_counts()
    results = []
    for index, case in enumerate(cases, start=1):
        try:
            result = evaluate_case(case)
        except Exception as error:
            result = {
                "id": case["id"],
                "text": case["text"],
                "passed": False,
                "failures": [type(error).__name__],
                "result": None,
            }
        results.append(result)
        print(
            f"[{index}/{len(cases)}] {result['id']}: "
            f"{'PASS' if result['passed'] else 'FAIL'} {result['failures']}"
        )

    after = database_counts()
    if before != after:
        raise RuntimeError(f"Evaluation changed DB counts: before={before}, after={after}")
    summary = summarize(results)
    passed = summary["cases"]["hits"]
    print(json.dumps({"summary": summary, "db_unchanged": True}, ensure_ascii=False))
    print("FAILED_CASES=" + ",".join(result["id"] for result in results if not result["passed"]))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
