"""
Run explicitly:

    cd C:\noie\backend
    python -m evals.emotion_analysis_eval

This eval intentionally reuses the production emotion analysis call and is not
wired into pytest, so normal test runs do not spend API calls.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Any, Callable

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

from openai_analyzer import analyze_with_openai


def to_level(score: float) -> str:
    if score >= 0.7:
        return "High"
    if score >= 0.4:
        return "Mid"
    return "Low"


@dataclass(frozen=True)
class EvalCase:
    name: str
    text: str
    evaluator: Callable[[dict[str, Any]], list[str]]


def level_of(result: dict[str, Any], key: str) -> str:
    return to_level(float(result["emotion_axis"][key]))


def primary_level(result: dict[str, Any], key: str) -> str:
    return to_level(float(result["primary_axis"][key]))


def require_level_in(
    result: dict[str, Any],
    axis: str,
    allowed: list[str],
    label: str,
) -> list[str]:
    level = level_of(result, axis)
    return [] if level in allowed else [f"expected {axis} in {allowed}: {label}, got {level}"]


def require_primary_in(
    result: dict[str, Any],
    axis: str,
    allowed: list[str],
    label: str,
) -> list[str]:
    level = primary_level(result, axis)
    return [] if level in allowed else [f"expected primary {axis} in {allowed}: {label}, got {level}"]


def require_summary_not_contains(
    result: dict[str, Any],
    keywords: list[str],
    label: str,
) -> list[str]:
    summary = str(result.get("state_summary") or "")
    hits = [keyword for keyword in keywords if keyword in summary]
    return [] if not hits else [f"unexpected state_summary keywords {hits}: {label}"]


def count_mid_or_high(result: dict[str, Any], axes: list[str]) -> int:
    return sum(1 for axis in axes if level_of(result, axis) in {"Mid", "High"})


def evaluate_test_1(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for axis in ["F", "A", "D", "J"]:
        failures += require_level_in(result, axis, ["Low"], "기술적 중립 문장")
    failures += require_level_in(result, "T", ["Low"], "긴장 과잉 추론 금지")
    failures += require_level_in(result, "C", ["Low", "Mid"], "호기심은 과하지 않게")
    failures += require_level_in(result, "G", ["Low"], "기술 작업 사실만으로 욕구 상승 금지")
    failures += require_level_in(result, "R", ["Low"], "기술 작업 사실만으로 안정 상승 금지")
    return failures


def evaluate_test_2(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    failures += require_level_in(result, "D", ["Low", "Mid"], "우울 High 금지")
    failures += require_level_in(result, "F", ["Low", "Mid"], "공포 High 금지")
    if count_mid_or_high(result, ["F", "A", "D", "T"]) > 2:
        failures.append("약한 부정 표현에서 여러 부정 축이 동시에 Mid/High로 과장됨")
    return failures


def evaluate_test_3(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    failures += require_level_in(result, "J", ["Mid", "High"], "명확한 기쁨")
    for axis in ["F", "A", "D"]:
        failures += require_level_in(result, axis, ["Low"], "긍정 성취에서 불필요한 부정 감정 금지")
    return failures


def evaluate_test_4(result: dict[str, Any]) -> list[str]:
    return require_level_in(result, "A", ["High"], "강한 분노 표현")


def evaluate_test_5(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    failures += require_level_in(result, "A", ["Low", "Mid"], "약한 짜증은 과도한 High 금지")
    return failures


def evaluate_test_6(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    failures += require_level_in(result, "D", ["Low", "Mid"], "애매한 힘듦에서 우울 High 금지")
    if count_mid_or_high(result, ["F", "A", "D", "T"]) > 2:
        failures.append("애매한 힘듦에서 여러 부정 축이 동시에 과장됨")
    return failures


def evaluate_test_7(result: dict[str, Any]) -> list[str]:
    return require_level_in(result, "D", ["High"], "명확한 우울 표현")


def evaluate_test_8(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    failures += require_level_in(result, "F", ["High"], "명확한 공포 표현")
    failures += require_level_in(result, "D", ["Low"], "공포 표현에서 우울 자동 부착 금지")
    return failures


def evaluate_test_9(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for axis in ["F", "A", "D", "J", "G", "T", "R"]:
        failures += require_level_in(result, axis, ["Low"], "중립 정보 질문")
    failures += require_level_in(result, "C", ["Low", "Mid"], "호기심은 Low~Mid")
    return failures


def evaluate_test_10(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    failures += require_level_in(result, "J", ["Low", "Mid"], "단순 완료 사실에서 기쁨 High 금지")
    failures += require_level_in(result, "G", ["Low"], "단순 완료 사실에서 욕구 상승 금지")
    return failures


def evaluate_test_11(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    failures += require_level_in(result, "J", ["High", "Mid"], "강한 성취감")
    failures += require_level_in(result, "J", ["High"], "TEST 10보다 강한 긍정 감정")
    return failures


def evaluate_test_12(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for axis in ["F", "A", "D", "J", "C", "G", "T", "R"]:
        failures += require_level_in(result, axis, ["Low"], "단순 웃음")
    failures += require_summary_not_contains(result, ["우울", "분노", "불안", "긴장"], "단순 웃음에서 과장 요약 금지")
    return failures


CASES = [
    EvalCase("1. 기술적 중립", "날짜 버그 잡는 중이야", evaluate_test_1),
    EvalCase("2. 기술 문제 지속", "아직 안돼", evaluate_test_2),
    EvalCase("3. 명확한 기쁨", "드디어 고쳤어! 진짜 기분 좋다", evaluate_test_3),
    EvalCase("4. 명확한 분노", "진짜 너무 화나. 계속 오류 나잖아", evaluate_test_4),
    EvalCase("5. 약한 짜증", "좀 짜증나네", evaluate_test_5),
    EvalCase("6. 애매한 힘듦", "나 오늘 좀 힘들어", evaluate_test_6),
    EvalCase("7. 명확한 우울", "오늘 너무 우울하고 아무것도 하기 싫어", evaluate_test_7),
    EvalCase("8. 명확한 공포", "너무 무서워. 진짜 겁나", evaluate_test_8),
    EvalCase("9. 중립 정보 질문", "TypeScript에서 interface랑 type 차이가 뭐야?", evaluate_test_9),
    EvalCase("10. 단순 완료 사실", "로그인 UI 만들었어", evaluate_test_10),
    EvalCase("11. 강한 성취감", "로그인 UI 드디어 완성했다! 너무 뿌듯해", evaluate_test_11),
    EvalCase("12. 웃음", "ㅋㅋ", evaluate_test_12),
]


def print_result(case: EvalCase, result: dict[str, Any], failures: list[str]) -> None:
    status = "PASS" if not failures else "FAIL"
    primary = {
        key: primary_level(result, key) for key in ["like", "dislike"]
    }
    emotions = {axis: level_of(result, axis) for axis in ["F", "A", "D", "J", "C", "G", "T", "R"]}
    print(f"[{status}] {case.name}")
    print(f"text: {case.text}")
    print(f"primary: {primary}")
    print(f"emotion: {emotions}")
    print(f"state_summary: {result.get('state_summary')}")
    if failures:
        for failure in failures:
            print(f"- {failure}")
    print("---")


def main() -> int:
    if load_dotenv:
        load_dotenv()

    if not os.getenv("OPENAI_API_KEY"):
        print("SKIP: OPENAI_API_KEY is not set")
        return 0

    passed = 0
    failed = 0

    for case in CASES:
        result = analyze_with_openai(case.text)
        failures = case.evaluator(result)
        print_result(case, result, failures)
        if failures:
            failed += 1
        else:
            passed += 1

    print(f"RESULT: {passed} passed / {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
