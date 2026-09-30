"""OpenAI structured output으로 장기 기억 후보를 보수적으로 판단합니다."""

from __future__ import annotations

import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from memory_schemas import MemoryExtractionDecision
from openai_analyzer import extract_output_text, print_openai_error


load_dotenv()


EXTRACTOR_VERSION = "memory-v1"

MEMORY_EXTRACTION_PROMPT = """
너는 NOIE의 장기 기억 추출기다. 사용자가 실제로 말한 한 문장만 근거로 판단한다.

기억 후보:
- goal: 장기 목표
- preference: 지속적인 선호
- project: 장기 프로젝트
- experience: 장기적으로 의미 있는 경험
- person: 반복적으로 중요하게 다룰 사람
- place: 반복적으로 의미가 있는 장소
- routine: 지속적인 습관
- decision: 중요한 결정
- other: 위 범주 밖이지만 장기 대화에 유용한 정보

보수적 판단 원칙:
- 확실하지 않으면 should_remember=false로 판단한다.
- 오늘 한 사소한 행동이나 순간적 감정은 저장하지 않는다.
- 사용자가 말하지 않은 성격, 정신 상태, 진단, 미래를 추론하지 않는다.
- 일시적 감정을 영구 성향으로 바꾸지 않는다.
- 한 번의 행동을 반복 습관으로 확대하지 않는다.
- content는 사용자의 표현보다 강하게 단정하지 않는 짧은 한국어 문장으로 쓴다.
- "오늘 공부하기 싫다"를 "사용자는 공부를 싫어한다"로 저장하면 안 된다.
- "요즘 매일 아침 러닝하고 있다"는 routine 후보가 될 수 있다.
- "오늘 라면 먹었다"는 일반적으로 기억하지 않는다.
- "나는 매운 음식을 정말 좋아한다"는 preference 후보가 될 수 있다.
- "나는 NOIE를 꼭 완성하고 싶다"는 goal 또는 project 후보가 될 수 있다.

should_remember=false이면 content는 빈 문자열, kind는 other, importance와 confidence는 0으로 반환한다.
reason은 기억 여부의 판단 근거를 내부 검증용으로 간결하게 설명한다.
반드시 지정된 JSON 구조만 반환한다.
""".strip()


MEMORY_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "should_remember": {"type": "boolean"},
        "reason": {"type": "string"},
        "content": {"type": "string"},
        "kind": {
            "type": "string",
            "enum": [
                "goal",
                "preference",
                "project",
                "experience",
                "person",
                "place",
                "routine",
                "decision",
                "other",
            ],
        },
        "importance": {"type": "integer", "minimum": 0, "maximum": 100},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "required": [
        "should_remember",
        "reason",
        "content",
        "kind",
        "importance",
        "confidence",
    ],
    "additionalProperties": False,
}


def extract_memory_with_openai(text: str) -> MemoryExtractionDecision:
    """원문 한 건을 분석하고 schema 검증을 통과한 판단만 반환합니다."""

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY가 설정되지 않았습니다.")

    model = os.getenv(
        "OPENAI_MEMORY_MODEL",
        os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
    )
    try:
        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": MEMORY_EXTRACTION_PROMPT},
                {"role": "user", "content": text},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "memory_extraction",
                    "description": "Conservative long-term memory extraction result.",
                    "schema": MEMORY_EXTRACTION_SCHEMA,
                    "strict": True,
                }
            },
        )
        decision = MemoryExtractionDecision.model_validate(
            json.loads(extract_output_text(response))
        )
        if decision.should_remember:
            if not decision.content.strip():
                raise ValueError("기억 생성 판단에 content 또는 kind가 없습니다.")
        return decision
    except Exception as error:
        print_openai_error(error)
        raise
