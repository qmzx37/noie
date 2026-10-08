"""Phase 8.4의 한정된 재평가입니다. 프롬프트/기대값/DB를 변경하지 않습니다."""

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path

from evals.run_lv4_real_eval import plan, run_suite, summarize
from evals.run_lv4_relationship_calibration import targeted_cases as baseline_cases

ROOT = Path(__file__).resolve().parents[2]
# 기존 네 purpose 지시의 AST 지문입니다. 예전 지문에는 user payload/SDK 호출까지 섞여 있었습니다.
# HEAD의 변경 전 네 지시에서 계산했으며 Behavior 전송 계약은 별도 adapter 테스트가 검사합니다.
PROMPT_BASELINE = "f5b046561edf9b1778dadb02dcd9e98fe04a1f1c2a67e533a2850689b1344ca9"


def prompt_fingerprint(source=None):
    """주석/진단 코드가 아니라 Phase 8.3 purpose 문자열의 AST 자체를 비교합니다."""
    tree = ast.parse(source if source is not None else
        (ROOT / "backend/agent/lv4/recommendation_adapter.py").read_text(encoding="utf-8-sig"))
    nodes = [ast.dump(node, include_attributes=False) for node in ast.walk(tree)
        if (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "purpose"
            for target in node.targets)) or
        (isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name) and node.target.id == "purpose")]
    return hashlib.sha256("\n".join(nodes).encode()).hexdigest()


def targeted_cases():
    """예외 두 입력과 일반론/관계/시간/현재 의사만 선택합니다. 전체 suite는 실행하지 않습니다."""
    by_id = {case.case_id: case for case in baseline_cases()}
    return [by_id[ident] for ident in ("missing_choices", "temporary_decision", "choice", "sufficient_choices",
        "relationship_observation", "irrelevant_relationship", "current_positive", "schedule_conflict",
        "past_time", "visit_only", "intent_rest", "temporary_observation")]


def historical_exceptions(runs=()):
    """과거 누락된 예외 정보는 복구했다고 주장하지 않습니다. 새 재현과 별도로 표시합니다."""
    report = json.loads((ROOT / "docs/LV4_PHASE8_3_RESULTS.json").read_text(encoding="utf-8"))
    cases = {case.case_id: case for case in baseline_cases()}
    records = []
    for row in report["runs"]:
        result = row.get("pipeline_result")
        if result is None or result.get("failure_kind") != "exception":
            continue
        case = cases[row["case_id"]]
        reproduced = [run for run in runs if run.case_id == case.case_id and run.failure_diagnostic]
        records.append({"case_id": case.case_id, "run_number": row["iteration"], "input": case.user_message,
            "context": "synthetic current utterance only; no personal context", "last_normal_stage": "STATE",
            "failed_stage": result["failed_stage"], "typed_parsing": "before completed RecommendationDecision",
            "historical_exception_class": "NOT_RECORDED", "historical_safe_message": "NOT_RECORDED",
            "historical_stack_location": "NOT_RECORDED",
            "classification": "NON_REPRODUCIBLE",
            "same_input_failure_reproduced": bool(reproduced),
            "new_diagnostics": [run.failure_diagnostic.model_dump(mode="json") for run in reproduced],
            "note": "Historical raw output/exception was not retained. A new case failure is not proof of the exact historical exception."})
    return records


def manual_review():
    """대표 REVIEW_REQUIRED 12건을 사람이 분류한 기록입니다. 자동 grader 점수로 가장하지 않습니다."""
    rows = json.loads((ROOT / "docs/LV4_PHASE8_3_RESULTS.json").read_text(encoding="utf-8"))["runs"]
    labels = [
        ("choice", 1, "SEMANTIC_FAIL", "product", "제시된 개발/운동 후보 대신 중요한 하나를 사용자에게 다시 고르게 함"),
        ("choice", 2, "SEMANTIC_PASS", "none", "개발/운동 각각 작은 시작 행동을 제시함"),
        ("choice", 3, "SEMANTIC_FAIL", "product", "하고 싶은 활동부터 정하라는 일반론이며 후보 비교 없음"),
        ("sufficient_choices", 1, "SEMANTIC_PASS", "none", "입력창/운동을 명시하고 30분 범위 안의 후보 유지"),
        ("relationship_observation", 1, "EVAL_AMBIGUOUS", "product_and_evaluator", "문제 해결의 조건부 가능성과 미해결 갈등 전제의 경계가 애매함"),
        ("relationship_observation", 2, "SEMANTIC_FAIL", "product", "만남 선택에 필수라고 입증되지 않은 관계 상태 질문"),
        ("relationship_observation", 3, "SEMANTIC_FAIL", "product", "과거 싸움의 여파를 현재 상황으로 확대함"),
        ("irrelevant_relationship", 1, "SEMANTIC_PASS", "none", "무관한 관계 근거 없이 내 개발/운동 선택 지원"),
        ("irrelevant_relationship", 3, "SEMANTIC_FAIL", "product", "좋아하는 활동부터 고르라는 일반론"),
        ("meaning_not_social", 2, "EVAL_AMBIGUOUS", "product_and_evaluator", "친구 추론은 없으나 처음 시작이라는 확인되지 않은 전제가 있음"),
        ("current_positive", 1, "ACCEPTABLE_VARIATION", "evaluator", "좋은 관계라는 표현은 친밀도 사실 단정으로 보지 않는 한 긍정 사건의 약한 제안 표현"),
        ("current_positive", 3, "SEMANTIC_PASS", "none", "현재 영화 경험을 대화 주제로 쓰고 과거 싸움을 배제함"),
    ]
    result = []
    for ident, iteration, label, source, reason in labels:
        row = next(r for r in rows if r["case_id"] == ident and r["iteration"] == iteration)
        assert row["outcome"] == "REVIEW_REQUIRED"
        decision = row["recommendation_decision"]
        result.append({"case_id": ident, "run_number": iteration, "classification": label,
            "problem_owner": source, "reason": reason, "synthetic_decision": decision,
            "note": "Manual interpretation, not a deterministic natural-language quality guarantee"})
    return result


def main(argv=None):
    """명시적 live만 호출합니다. 기존 model/프롬프트를 유지하고 DB에 접근하지 않습니다."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--repeat", type=int, choices=(1, 2, 3), default=3)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    cases = targeted_cases()
    assert prompt_fingerprint() == PROMPT_BASELINE, "Phase 8.3 prompt baseline changed"
    print(json.dumps({"cases": len(cases), "max_OpenAI_calls": plan(cases, args.repeat),
        "context_source": "SYNTHETIC_EVAL_CONTEXT", "DB_access": False, "prompt_unchanged": True}), flush=True)
    if not args.live:
        return 0
    from dotenv import load_dotenv
    from openai import OpenAI
    from agent.lv4.recommendation_adapter import OpenAIRecommendationAdapter
    load_dotenv(ROOT / "backend/.env")
    client = OpenAI(timeout=60, max_retries=0) if os.getenv("OPENAI_API_KEY", "").strip() else None
    try:
        runs, calls = run_suite(cases, repeat=args.repeat,
            reasoner=OpenAIRecommendationAdapter(client) if client else None, emit=True)
    finally:
        if client:
            client.close()
    report = {"context_source": "SYNTHETIC_EVAL_CONTEXT", "DB_access": False,
        "model": os.getenv("OPENAI_AGENT_MODEL", os.getenv("OPENAI_MODEL", "gpt-4.1-mini")),
        "prompt_fingerprint": prompt_fingerprint(), "OpenAI_calls": calls,
        "historical_exceptions": historical_exceptions(runs), "manual_review_phase8_3": manual_review(),
        "summary": summarize(runs), "runs": [run.model_dump(mode="json") for run in runs]}
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"OpenAI_calls": calls, "summary": report["summary"]}, ensure_ascii=False, indent=2))
    return int(any(run.outcome in {"FAIL", "SKIPPED"} for run in runs))


if __name__ == "__main__":
    raise SystemExit(main())
