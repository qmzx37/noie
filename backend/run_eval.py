"""noie 감정 분석 품질을 확인하는 평가 스크립트입니다.

기본 실행:
    python run_eval.py

앞에서 3개만 실행:
    python run_eval.py --limit 3

실행 중인 FastAPI 서버로 테스트:
    python run_eval.py --api --limit 3

주의:
- API 키는 이 파일에 넣지 않습니다.
- OpenAI 분석은 `.env`의 OPENAI_API_KEY와 OPENAI_MODEL을 사용합니다.
"""

from __future__ import annotations

import argparse
import csv
import json
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, TypedDict

from dotenv import load_dotenv

from emotion_analyzer import analyze_with_rules
from main import build_response
from openai_analyzer import analyze_with_openai


DEFAULT_API_URL = "http://127.0.0.1:8000/analyze-emotion"
EMOTION_KEYS = ["F", "A", "D", "J", "C", "G", "T", "R"]
TEST_CASES_PATH = Path(__file__).with_name("test_cases.json")
RESULTS_DIR = Path(__file__).with_name("eval_results")


class TestCase(TypedDict):
    text: str
    memo: str


def load_test_cases() -> list[TestCase]:
    """test_cases.json에서 테스트 문장과 memo를 읽습니다."""

    data = json.loads(TEST_CASES_PATH.read_text(encoding="utf-8"))

    # 예전 구조 {"test_cases": [...]}와 새 구조 [...]를 둘 다 지원합니다.
    raw_cases = data.get("test_cases", []) if isinstance(data, dict) else data

    test_cases: list[TestCase] = []
    for case in raw_cases:
        if not isinstance(case, dict):
            continue

        text = case.get("text")
        if not isinstance(text, str) or not text.strip():
            continue

        memo = case.get("memo", "")
        test_cases.append(
            {
                "text": text,
                "memo": memo if isinstance(memo, str) else "",
            }
        )

    return test_cases


def apply_limit(test_cases: list[TestCase], limit: int | None) -> list[TestCase]:
    """--limit 값이 있으면 앞에서부터 지정한 개수만 평가합니다."""

    if limit is None:
        return test_cases

    if limit <= 0:
        return []

    return test_cases[:limit]


def analyze_internal(text: str) -> dict[str, Any]:
    """FastAPI 서버를 띄우지 않고 내부 분석 함수를 직접 호출합니다."""

    try:
        analysis = analyze_with_openai(text)
        source = "openai"
    except Exception as error:
        # OpenAI 호출이 실패해도 전체 평가가 멈추지 않게 rule_based로 이어갑니다.
        print(f"OpenAI 호출 실패, rule_based로 계속합니다: {error}", flush=True)
        analysis = analyze_with_rules(text)
        source = "rule_based"

    return build_response(text, analysis, source)


def analyze_api(text: str, api_url: str) -> dict[str, Any]:
    """실행 중인 /analyze-emotion API에 HTTP 요청을 보냅니다."""

    body = json.dumps({"text": text}).encode("utf-8")
    request = urllib.request.Request(
        api_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        response_body = response.read().decode("utf-8")
        return json.loads(response_body)


def make_error_result(text: str, error: Exception) -> dict[str, Any]:
    """한 문장 분석이 실패했을 때도 출력하고 저장할 수 있는 결과를 만듭니다."""

    return {
        "input": text,
        "user_view": {
            "primary_axis": {"like": "-", "dislike": "-"},
            "emotion_axis": {key: "-" for key in EMOTION_KEYS},
            "state_summary": f"분석 실패: {error}",
        },
        "admin_view": {
            "primary_axis": {"like": "-", "dislike": "-"},
            "emotion_axis": {key: "-" for key in EMOTION_KEYS},
        },
        "source": "error",
    }


def level_value(result: dict[str, Any], key: str) -> str:
    """결과에서 like/dislike 또는 8축 감정 값을 꺼냅니다."""

    if key in ["like", "dislike"]:
        return str(result["user_view"]["primary_axis"][key])

    return str(result["user_view"]["emotion_axis"][key])


def shorten(text: str, max_length: int) -> str:
    """마지막 표가 너무 넓어지지 않도록 긴 문장을 줄입니다."""

    if len(text) <= max_length:
        return text

    return text[: max_length - 1] + "…"


def print_result_detail(result: dict[str, Any]) -> None:
    """문장 하나의 분석 결과를 즉시 출력합니다."""

    values = [
        f"like={level_value(result, 'like')}",
        f"dislike={level_value(result, 'dislike')}",
        *[f"{key}={level_value(result, key)}" for key in EMOTION_KEYS],
        f"source={result['source']}",
        f"state_summary={result['user_view']['state_summary']}",
    ]
    print("결과: " + ", ".join(values), flush=True)


def print_table(results: list[dict[str, Any]]) -> None:
    """전체 분석 결과를 마지막에 표처럼 한 번 더 출력합니다."""

    if not results:
        print("평가할 문장이 없습니다.", flush=True)
        return

    headers = [
        "input",
        "memo",
        "like",
        "dislike",
        "F",
        "A",
        "D",
        "J",
        "C",
        "G",
        "T",
        "R",
        "state_summary",
        "source",
    ]

    rows = []
    for item in results:
        result = item["result"]
        rows.append(
            [
                shorten(item["text"], 28),
                shorten(item["memo"], 18),
                level_value(result, "like"),
                level_value(result, "dislike"),
                level_value(result, "F"),
                level_value(result, "A"),
                level_value(result, "D"),
                level_value(result, "J"),
                level_value(result, "C"),
                level_value(result, "G"),
                level_value(result, "T"),
                level_value(result, "R"),
                shorten(result["user_view"]["state_summary"], 36),
                result["source"],
            ]
        )

    widths = [
        max(len(str(row[index])) for row in [headers, *rows])
        for index in range(len(headers))
    ]

    def format_row(row: list[str]) -> str:
        return " | ".join(
            str(value).ljust(widths[index])
            for index, value in enumerate(row)
        )

    print()
    print("최종 요약 표")
    print(format_row(headers))
    print("-+-".join("-" * width for width in widths))
    for row in rows:
        print(format_row(row))


def csv_row(item: dict[str, Any]) -> dict[str, str]:
    """CSV에 저장할 한 줄을 만듭니다."""

    result = item["result"]
    return {
        "input": item["text"],
        "memo": item["memo"],
        "like": level_value(result, "like"),
        "dislike": level_value(result, "dislike"),
        "F": level_value(result, "F"),
        "A": level_value(result, "A"),
        "D": level_value(result, "D"),
        "J": level_value(result, "J"),
        "C": level_value(result, "C"),
        "G": level_value(result, "G"),
        "T": level_value(result, "T"),
        "R": level_value(result, "R"),
        "source": str(result["source"]),
        "state_summary": str(result["user_view"]["state_summary"]),
    }


def save_results(results: list[dict[str, Any]]) -> tuple[Path, Path]:
    """평가 결과를 JSON과 CSV 파일로 저장합니다."""

    RESULTS_DIR.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    json_path = RESULTS_DIR / f"eval_results_{timestamp}.json"
    csv_path = RESULTS_DIR / f"eval_results_{timestamp}.csv"

    json_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    fieldnames = [
        "input",
        "memo",
        "like",
        "dislike",
        "F",
        "A",
        "D",
        "J",
        "C",
        "G",
        "T",
        "R",
        "source",
        "state_summary",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for item in results:
            writer.writerow(csv_row(item))

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    """명령줄 옵션을 읽습니다."""

    parser = argparse.ArgumentParser(description="Run noie emotion analysis eval cases.")
    parser.add_argument(
        "--api",
        action="store_true",
        help="Use the running FastAPI /analyze-emotion endpoint.",
    )
    parser.add_argument(
        "--api-url",
        default=DEFAULT_API_URL,
        help="API URL used with --api.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Evaluate only the first N test cases.",
    )
    return parser.parse_args()


def print_start_message(total_count: int, run_count: int, has_limit: bool) -> None:
    """평가 시작 전에 몇 개를 평가하는지 출력합니다."""

    if has_limit:
        print(f"총 {total_count}개 중 {run_count}개 문장 평가 시작", flush=True)
    else:
        print(f"총 {total_count}개 문장 평가 시작", flush=True)


def main() -> None:
    """평가 스크립트의 시작점입니다."""

    load_dotenv()
    args = parse_args()

    all_test_cases = load_test_cases()
    selected_test_cases = apply_limit(all_test_cases, args.limit)
    total_count = len(all_test_cases)
    run_count = len(selected_test_cases)

    print_start_message(total_count, run_count, args.limit is not None)

    results: list[dict[str, Any]] = []
    for index, test_case in enumerate(selected_test_cases, start=1):
        text = test_case["text"]
        memo = test_case["memo"]
        print(f"[{index}/{run_count}] 분석 중: {text}", flush=True)

        try:
            result = (
                analyze_api(text, args.api_url)
                if args.api
                else analyze_internal(text)
            )
        except Exception as error:
            print(f"에러: {error}", flush=True)
            result = make_error_result(text, error)

        results.append(
            {
                "text": text,
                "memo": memo,
                "result": result,
            }
        )
        print_result_detail(result)

    print_table(results)
    json_path, csv_path = save_results(results)
    print("평가 완료", flush=True)
    print(f"저장 완료: {json_path.as_posix()}", flush=True)
    print(f"저장 완료: {csv_path.as_posix()}", flush=True)


if __name__ == "__main__":
    main()
