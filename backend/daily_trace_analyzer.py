"""noie 하루의 흔적 후보 추출기입니다.

모바일 앱은 OpenAI API 키를 갖지 않고, 이 백엔드 API만 호출합니다.
"""

from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv

from openai_analyzer import extract_output_text, print_openai_error


load_dotenv()


DAILY_TRACE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "has_trace",
        "type",
        "date",
        "time",
        "title",
        "memo",
        "targetDate",
        "targetYear",
        "targetText",
    ],
    "properties": {
        "has_trace": {"type": "boolean"},
        "type": {
            "anyOf": [
                {
                    "type": "string",
                    "enum": ["schedule", "record", "todo", "quote", "goal"],
                },
                {"type": "null"},
            ]
        },
        "date": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "time": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "title": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "memo": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "targetDate": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "targetYear": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "targetText": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    },
}


def extract_daily_trace_with_openai(text: str, current_date: str) -> dict[str, Any]:
    """채팅 문장에서 달력에 저장할 수 있는 후보를 추출합니다."""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("[noie] OPENAI_API_KEY가 없어 하루의 흔적 추출을 건너뜁니다.")
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "너는 한국어 채팅 문장에서 로컬 달력 기록 후보만 추출하는 분류기다. "
                        "감정 점수나 상담 답변은 만들지 않는다. "
                        "사용자가 일정, 오늘 한 일, 해야 할 일, 저장하고 싶은 문장을 말한 경우에만 has_trace를 true로 둔다. "
                        "schedule은 특정 날짜나 시간이 있는 약속, 병원, 제출, 만남 같은 일정이다. "
                        "record는 오늘 했던 일이나 남기고 싶은 하루 기록이다. "
                        "todo는 해야 한다, 만들어야 한다, 정리해야겠다처럼 앞으로 할 일이다. "
                        "quote는 이 말 저장해줘, 이 문장 남겨줘처럼 문장 보관 요청이다. "
                        "goal은 장기 목표나 미래 목표다. 예: 2년 뒤쯤에 개발자가 될 거야, 내년에는 취업하고 싶어, 6개월 안에 앱 하나 완성할 거야, 올해 안에 포트폴리오 만들 거야, 나중에 개인 AI 만들고 싶어. "
                        "goal은 특정 하루 일정이 아니므로 date에는 저장 기준일인 current_date를 넣는다. "
                        "goal의 목표 시점이 정확한 날짜면 targetDate를 YYYY-MM-DD로 넣고, 연도만 자연스러우면 targetYear를 넣고, '2년 뒤쯤', '6개월 안에', '나중에'처럼 애매하면 targetText를 보존한다. "
                        "예: current_date가 2026-07-08이고 '2년 뒤쯤'이면 targetYear는 '2028', targetText는 '2년 뒤쯤'이 자연스럽다. "
                        "기존 일정 추출과 목표 추출을 구분한다. '내일 예비군 훈련가'는 schedule, '2년 뒤쯤 개발자가 될 거야'는 goal, '내일 README 정리해야 해'는 todo다. "
                        "자동 저장이 아니라 후보 추출용이므로 과하게 추측하지 않는다. "
                        "해당 사항이 없으면 has_trace false이고 나머지는 null이다. "
                        "date는 반드시 YYYY-MM-DD 형식으로 쓴다. 상대 날짜는 current_date 기준으로 계산한다. "
                        "time은 알 수 있을 때만 HH:mm 형식으로 쓰고, 없으면 null이다. goal에서는 보통 time은 null이다. "
                        "title은 한국어로 짧고 명확하게 만든다. memo에는 원문을 짧게 보존한다."
                    ),
                },
                {
                    "role": "user",
                    "content": f"current_date: {current_date}\ntext: {text}",
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "daily_trace_candidate",
                    "description": "Candidate item for noie daily traces.",
                    "schema": DAILY_TRACE_SCHEMA,
                    "strict": True,
                }
            },
        )

        return json.loads(extract_output_text(response))
    except Exception as error:
        print_openai_error(error)
        raise
