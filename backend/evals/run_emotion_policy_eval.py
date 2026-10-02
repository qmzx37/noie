"""Emotion v0.2의 중립·저신뢰·현재 발화 우선 정책을 실제 OpenAI로 평가합니다."""

from __future__ import annotations

import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agent.orchestrator import orchestrate_with_openai  # noqa: E402
from agent.schemas import OrchestratorMemoryContext  # noqa: E402


def emotion_action(result):
    return next(
        (action for action in result.actions if action.type == "emotion" and action.mode == "record"),
        None,
    )


def check(name: str, condition: bool, detail: str) -> None:
    if not condition:
        raise AssertionError(f"{name}: {detail}")
    print(f"[PASS] {name}: {detail}")


def run() -> None:
    anger = emotion_action(orchestrate_with_openai("오늘 너무 화났어."))
    check("1 명시적 분노", anger is not None and anger.arguments.A == max(getattr(anger.arguments, key) for key in "FADJCGTR"), str(anger))

    relaxed = emotion_action(orchestrate_with_openai("지금 마음이 편안해."))
    check("2 명시적 안정", relaxed is not None and relaxed.arguments.R == max(getattr(relaxed.arguments, key) for key in "FADJCGTR"), str(relaxed))

    ordinary = emotion_action(orchestrate_with_openai("오늘 그냥 평범했어."))
    check("3 평범한 사실 미기록", ordinary is None, str(ordinary))

    schedule = emotion_action(orchestrate_with_openai("내일 3시에 운동 일정 넣어줘."))
    check("4 일정 요청 미기록", schedule is None, str(schedule))

    ambiguous = emotion_action(orchestrate_with_openai("그냥 좀 그런 것 같아."))
    check(
        "5 애매한 감정 확정 방지",
        ambiguous is None or ambiguous.confidence < 0.40,
        str(ambiguous),
    )

    current_positive = emotion_action(
        orchestrate_with_openai(
            "오늘은 기분이 정말 좋아.",
            [OrchestratorMemoryContext(content="요즘 계속 우울하고 힘들다고 말했다.", relevance=0.9)],
        )
    )
    check(
        "6 현재 긍정 발화 우선",
        current_positive is not None
        and current_positive.arguments.J > current_positive.arguments.D,
        str(current_positive),
    )
    print("SUMMARY=6/6")


if __name__ == "__main__":
    run()
