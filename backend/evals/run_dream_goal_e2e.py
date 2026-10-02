"""Dream Goal 명시성 경계를 실제 OpenAI routing으로 평가합니다."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))

from agent.orchestrator import orchestrate_with_openai

CASES = [
    ("나는 AI 개발자가 되고 싶어.", True, False),
    ("올해 안에 NOIE를 실제 서비스로 만들고 싶어.", True, False),
    ("오늘 NOIE 개발했어.", False, True),
    ("내일 운동 갈 거야.", False, False),
    ("AI 개발자가 될 수 있을까?", False, False),
    ("예전에 개발자가 되고 싶었는데 지금은 아니야.", False, False),
    ("친구는 개발자가 되고 싶대.", False, False),
    ("오늘 NOIE 개발했고, 나는 사람들의 목표를 돕는 AI를 만들고 싶어.", True, True),
]


def run() -> None:
    passed = 0
    for index, (text, expect_dream, expect_daily) in enumerate(CASES, 1):
        result = orchestrate_with_openai(text)
        dream_actions = [action for action in result.actions if action.type == "dream_goal" and action.intent == "record_dream_goal"]
        daily_actions = [action for action in result.actions if action.type == "daily_life" and action.intent == "record_daily_trace"]
        valid_arguments = all(action.arguments is not None and action.arguments.statement.strip() and action.arguments.kind in {"dream", "goal"} for action in dream_actions)
        ok = bool(dream_actions) == expect_dream and (not expect_daily or bool(daily_actions)) and valid_arguments
        if not ok: raise AssertionError(f"case {index}: actions={result.actions}")
        passed += 1
        print(f"[PASS] {index}: dream={bool(dream_actions)} daily={bool(daily_actions)}")
    print(f"SUMMARY={passed}/{len(CASES)}")


if __name__ == "__main__": run()
