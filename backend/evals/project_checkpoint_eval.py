"""Checkpoint regression eval for the noie project workspace.

Run explicitly:

    cd C:\noie\backend
    python -m evals.project_checkpoint_eval

This module intentionally reuses the production checkpoint structured call and
is not wired into pytest, so normal test runs do not spend API calls.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from typing import Any, Callable

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

from openai_analyzer import generate_project_chat_reply_with_checkpoint_openai


PROJECT_CONTEXT = {
    "id": "checkpoint-eval-project",
    "title": "로그인 기능 프로젝트",
    "goal": "로그인과 회원가입 흐름을 안정적으로 구현한다.",
    "nextAction": None,
    "status": "in_progress",
}

USER_VIEW = {
    "primary_emotion": "neutral",
    "state_summary": "프로젝트 작업을 차분히 이어가는 상태입니다.",
    "emotion_axis": {
        "F": 0.0,
        "A": 0.0,
        "D": 0.0,
        "J": 0.3,
        "C": 0.5,
        "G": 0.6,
        "T": 0.2,
        "R": 0.5,
    },
}


@dataclass(frozen=True)
class EvalCase:
    name: str
    messages: list[str]
    evaluator: Callable[[dict[str, Any] | None], list[str]]
    latest_checkpoint: dict[str, Any] | None = None


def flatten(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(str(item) for item in value)
    return str(value)


def contains_all(text: str, keywords: list[str]) -> bool:
    return all(keyword in text for keyword in keywords)


def contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def require_checkpoint(draft: dict[str, Any] | None) -> list[str]:
    if not draft:
        return ["expected checkpoint_draft, got null"]
    if draft.get("intent") != "checkpoint":
        return [f"expected intent checkpoint, got {draft.get('intent')}"]
    return []


def field_contains_all(
    draft: dict[str, Any] | None,
    field: str,
    keywords: list[str],
    label: str,
) -> list[str]:
    text = flatten((draft or {}).get(field))
    return [] if contains_all(text, keywords) else [f"expected {field}: {label}"]


def field_contains_any(
    draft: dict[str, Any] | None,
    field: str,
    keywords: list[str],
    label: str,
) -> list[str]:
    text = flatten((draft or {}).get(field))
    return [] if contains_any(text, keywords) else [f"expected {field}: {label}"]


def field_not_contains_any(
    draft: dict[str, Any] | None,
    field: str,
    keywords: list[str],
    label: str,
) -> list[str]:
    text = flatten((draft or {}).get(field))
    return [f"unexpected {field}: {label}"] if contains_any(text, keywords) else []


def next_action_contains(
    draft: dict[str, Any] | None,
    required_keywords: list[str],
    action_keywords: list[str],
    label: str,
) -> list[str]:
    next_action = flatten((draft or {}).get("nextAction"))
    failures: list[str] = []
    if not contains_all(next_action, required_keywords):
        failures.append(f"expected nextAction: {label}")
    if action_keywords and not contains_any(next_action, action_keywords):
        failures.append(f"expected nextAction meaning: {label}")
    return failures


def evaluate_test_1(draft: dict[str, Any] | None) -> list[str]:
    failures = require_checkpoint(draft)
    failures += field_contains_all(draft, "completed", ["로그인", "UI"], "로그인 UI 완료")
    failures += field_contains_all(draft, "decisions", ["회원가입", "로그인"], "회원가입은 로그인 이후")
    failures += next_action_contains(draft, ["이메일", "로그인"], ["연결", "구현", "완성"], "이메일 로그인 연결")
    failures += field_not_contains_any(draft, "nextAction", ["회원가입"], "회원가입이 nextAction이면 안 됨")
    return failures


def evaluate_test_2(draft: dict[str, Any] | None) -> list[str]:
    failures = require_checkpoint(draft)
    failures += field_contains_all(draft, "completed", ["이메일", "로그인"], "이메일 로그인 연결 완료")
    failures += field_contains_all(draft, "decisions", ["소셜", "나중"], "소셜 로그인은 나중")
    failures += next_action_contains(draft, ["회원가입"], ["구현", "만들", "작업"], "회원가입 구현")
    return failures


def evaluate_test_3(draft: dict[str, Any] | None) -> list[str]:
    failures = require_checkpoint(draft)
    failures += field_contains_all(draft, "decisions", ["로그인"], "로그인 우선")
    failures += field_contains_all(draft, "decisions", ["회원가입", "로그인"], "회원가입은 로그인 이후")
    failures += next_action_contains(draft, ["로그인"], ["완성", "구현"], "로그인 완성/구현")
    failures += field_not_contains_any(draft, "nextAction", ["회원가입"], "회원가입이 nextAction이면 안 됨")
    return failures


def evaluate_test_4(draft: dict[str, Any] | None) -> list[str]:
    failures = require_checkpoint(draft)
    failures += field_contains_all(draft, "decisions", ["소셜"], "소셜 로그인 보류")
    failures += field_contains_any(draft, "decisions", ["나중", "미루", "보류", "진행하지", "하지 않"], "소셜 로그인 보류")
    failures += field_contains_all(draft, "decisions", ["이메일", "로그인"], "이메일 로그인 우선")
    failures += field_contains_any(draft, "decisions", ["우선", "집중", "완성", "먼저"], "이메일 로그인 우선")
    failures += next_action_contains(draft, ["이메일", "로그인"], ["완료", "완성", "연결", "끝", "구현", "계속", "마무리", "진행", "개발"], "이메일 로그인 완료/연결")
    failures += field_not_contains_any(draft, "nextAction", ["소셜"], "소셜 로그인이 nextAction이면 안 됨")
    return failures


def evaluate_test_5(draft: dict[str, Any] | None) -> list[str]:
    failures = require_checkpoint(draft)
    failures += field_contains_all(draft, "blocked", ["토큰", "저장"], "토큰 저장 문제")
    failures += field_contains_all(draft, "decisions", ["회원가입", "해결"], "회원가입은 문제 해결 이후")
    failures += next_action_contains(draft, ["토큰", "저장"], ["점검", "해결", "확인"], "토큰 저장 문제 해결")
    failures += field_not_contains_any(draft, "nextAction", ["회원가입"], "회원가입이 nextAction이면 안 됨")
    return failures


def evaluate_test_6(draft: dict[str, Any] | None) -> list[str]:
    failures = require_checkpoint(draft)
    failures += field_contains_all(draft, "completed", ["로그인", "UI"], "로그인 UI 완료")
    failures += field_contains_all(draft, "decisions", ["회원가입", "이메일", "로그인"], "회원가입은 이메일 로그인 이후")
    failures += next_action_contains(draft, ["이메일", "로그인"], ["연결", "구현"], "이메일 로그인 연결")
    for field in ["completed", "blocked", "decisions", "nextAction"]:
        failures += field_not_contains_any(draft, field, ["배고프", "ㅋㅋ"], f"{field}에 잡담 저장 금지")
    return failures


def evaluate_test_7(draft: dict[str, Any] | None) -> list[str]:
    failures = require_checkpoint(draft)
    failures += field_contains_all(draft, "decisions", ["날짜"], "날짜 버그 보류")
    failures += field_contains_any(draft, "decisions", ["미룰", "미루", "미뤘", "미룸", "보류", "나중", "우선순위"], "날짜 버그 보류")
    failures += field_contains_all(draft, "decisions", ["로그인"], "로그인 우선")
    failures += field_contains_any(draft, "decisions", ["우선", "먼저", "시작"], "로그인 우선")
    failures += field_contains_all(draft, "decisions", ["이메일", "로그인"], "이메일 로그인 먼저 시작")
    failures += next_action_contains(draft, ["이메일", "로그인"], ["시작", "구현", "연결", "계속", "개발", "진행", "완성"], "이메일 로그인")
    failures += field_not_contains_any(draft, "nextAction", ["날짜", "버그"], "이전 날짜 버그를 nextAction으로 복사하면 안 됨")
    return failures


CASES = [
    EvalCase(
        name="1. 선행 작업 우선",
        messages=[
            "로그인 UI는 끝났어",
            "이메일 로그인 연결부터 해야 해",
            "회원가입은 로그인 끝나고 만들자",
            "오늘은 여기까지 하자",
        ],
        evaluator=evaluate_test_1,
    ),
    EvalCase(
        name="2. 완료 후 다음 단계",
        messages=[
            "이메일 로그인 연결까지 끝냈어",
            "이제 회원가입 만들면 돼",
            "소셜 로그인은 나중에 할래",
            "오늘은 여기까지 하자",
        ],
        evaluator=evaluate_test_2,
    ),
    EvalCase(
        name="3. 계획 변경",
        messages=[
            "처음에는 회원가입부터 하려고 했어",
            "근데 로그인부터 완성하는 게 낫겠어",
            "회원가입은 로그인 끝난 다음에 하자",
            "오늘은 여기까지 하자",
        ],
        evaluator=evaluate_test_3,
    ),
    EvalCase(
        name="4. 보류 작업 제외",
        messages=[
            "로그인 API 연결 중이야",
            "소셜 로그인은 당분간 안 할래",
            "지금은 이메일 로그인만 끝내자",
            "오늘은 여기까지 하자",
        ],
        evaluator=evaluate_test_4,
    ),
    EvalCase(
        name="5. 막힌 작업 우선",
        messages=[
            "이메일 로그인 연결하다가 토큰 저장에서 막혔어",
            "회원가입은 그거 해결하고 나서 하자",
            "오늘은 여기까지 하자",
        ],
        evaluator=evaluate_test_5,
    ),
    EvalCase(
        name="6. 잡담 제외",
        messages=[
            "오늘 많이 했네 ㅋㅋ",
            "로그인 UI는 끝냈어",
            "다음에는 이메일 로그인 연결할래",
            "배고프다",
            "회원가입은 그 다음에 하자",
            "오늘은 여기까지 하자",
        ],
        evaluator=evaluate_test_6,
    ),
    EvalCase(
        name="7. latest checkpoint 덮어쓰기",
        messages=[
            "날짜 버그는 일단 미룰래",
            "로그인 기능부터 하자",
            "이메일 로그인부터 시작할게",
            "오늘은 여기까지 하자",
        ],
        latest_checkpoint={
            "id": "checkpoint-previous",
            "projectId": PROJECT_CONTEXT["id"],
            "completed": [],
            "blocked": [],
            "decisions": [],
            "nextAction": "날짜 버그 점검",
            "createdAt": "2026-08-17T21:00:00",
        },
        evaluator=evaluate_test_7,
    ),
]


def build_recent_messages(lines: list[str]) -> list[dict[str, str]]:
    return [
        {
            "id": f"eval-message-{index}",
            "role": "user",
            "content": line,
        }
        for index, line in enumerate(lines[:-1], start=1)
    ]


def call_checkpoint_eval(case: EvalCase) -> tuple[dict[str, Any], dict[str, Any] | None]:
    result = generate_project_chat_reply_with_checkpoint_openai(
        text=case.messages[-1],
        state_summary=USER_VIEW["state_summary"],
        user_view=USER_VIEW,
        project_context=PROJECT_CONTEXT,
        messages=build_recent_messages(case.messages),
        latest_checkpoint=case.latest_checkpoint,
    )
    draft = result.get("checkpoint_draft")
    return result, draft


def print_checkpoint_fields(draft: dict[str, Any] | None) -> None:
    if not draft:
        print("       checkpoint_draft: null")
        return
    print(f"       completed: {draft.get('completed')}")
    print(f"       blocked: {draft.get('blocked')}")
    print(f"       decisions: {draft.get('decisions')}")
    print(f"       nextAction: {draft.get('nextAction')}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run project checkpoint regression eval.")
    parser.add_argument("--verbose", action="store_true", help="Print checkpoint fields for PASS cases too.")
    parser.add_argument("--limit", type=int, default=None, help="Run only the first N cases.")
    args = parser.parse_args()

    if load_dotenv is not None:
        load_dotenv()

    print("이 테스트는 실제 AI API를 호출합니다.")
    if not os.getenv("OPENAI_API_KEY"):
        print("[SKIP] OPENAI_API_KEY가 없어 checkpoint eval을 실행하지 않았습니다.")
        return 0

    selected_cases = CASES[: args.limit] if args.limit else CASES
    passed = 0
    failed = 0
    api_calls = 0
    failure_details: list[tuple[str, dict[str, Any] | None, list[str]]] = []

    for case in selected_cases:
        try:
            _result, draft = call_checkpoint_eval(case)
            api_calls += 1
            failures = case.evaluator(draft)
        except Exception as error:
            api_calls += 1
            draft = None
            failures = [f"AI call failed: {error}"]

        if failures:
            failed += 1
            failure_details.append((case.name, draft, failures))
            print(f"[FAIL] {case.name}")
            for failure in failures:
                print(f"       {failure}")
            print_checkpoint_fields(draft)
        else:
            passed += 1
            print(f"[PASS] {case.name}")
            if args.verbose:
                print_checkpoint_fields(draft)

    print(f"{passed} passed / {failed} failed")
    print(f"AI calls: {api_calls}")

    if failure_details and args.verbose:
        print("\n[DETAILS]")
        for name, draft, failures in failure_details:
            print(f"- {name}")
            for failure in failures:
                print(f"  {failure}")
            print_checkpoint_fields(draft)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
