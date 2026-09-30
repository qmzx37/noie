"""새 Memory 후보와 기존 active Memory를 OpenAI structured output으로 비교합니다."""

from __future__ import annotations

import json
import os
from typing import Any
from uuid import UUID

from dotenv import load_dotenv
from openai import OpenAI

from memory_schemas import MemoryExtractionDecision, MemoryReconciliationDecision
from openai_analyzer import extract_output_text, print_openai_error


load_dotenv()


RECONCILER_VERSION = "memory-reconcile-v1"

RECONCILIATION_PROMPT = """
너는 NOIE의 장기 기억 조정기다. 새 Memory 후보와 같은 사용자의 기존 active Memory만 비교한다.

행동:
- new: 의미상 다른 새로운 정보다.
- reinforce: 사실상 같은 의미이며 새 원문이 기존 Memory의 추가 근거가 된다.
- supersede: 사용자가 이전 목표, 선호, 결정 등을 명확히 바꾸거나 수정했다.

보수적 원칙:
- 같은 주제라는 이유만으로 reinforce하지 않는다.
- "AI를 좋아한다"와 "AI 회사에 취업하고 싶다"는 같은 기억이 아니다.
- supersede는 "이제는", "생각이 바뀌었다", "더 이상", "예전에는 ~였지만 지금은",
  "~보다 ~가 더 맞다", "이전 결정을 바꿨다"처럼 변화가 명확할 때만 선택한다.
- 순간적인 감정이나 "오늘은 하기 싫다" 같은 표현으로 장기 목표를 supersede하지 않는다.
- new이면 matched_memory_id는 빈 문자열이어야 한다.
- reinforce 또는 supersede이면 제공된 후보 ID 중 정확히 하나를 사용한다.
- 존재하지 않는 ID를 만들지 않는다.
- 반드시 지정된 JSON 구조만 반환한다.
""".strip()


def reconcile_memory_candidate(
    candidate: MemoryExtractionDecision,
    existing_memories: list[dict[str, Any]],
) -> MemoryReconciliationDecision:
    """후보 목록 안의 ID만 선택할 수 있는 동적 JSON schema로 판단합니다."""

    if not existing_memories:
        return MemoryReconciliationDecision(
            action="new",
            matched_memory_id=None,
            reason="비교할 기존 active Memory가 없습니다.",
            confidence=1.0,
        )

    candidate_ids = [str(memory["id"]) for memory in existing_memories]
    schema = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["new", "reinforce", "supersede"]},
            # strict schema 안정성을 위해 NEW는 null 대신 빈 문자열을 사용합니다.
            "matched_memory_id": {"type": "string", "enum": ["", *candidate_ids]},
            "reason": {"type": "string"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["action", "matched_memory_id", "reason", "confidence"],
        "additionalProperties": False,
    }

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
                {"role": "system", "content": RECONCILIATION_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "new_memory_candidate": candidate.model_dump(),
                            "existing_active_memories": existing_memories,
                        },
                        ensure_ascii=False,
                        default=str,
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "memory_reconciliation",
                    "description": "How a new memory candidate relates to active memories.",
                    "schema": schema,
                    "strict": True,
                }
            },
        )
        raw = json.loads(extract_output_text(response))
        raw["matched_memory_id"] = raw.get("matched_memory_id") or None
        return MemoryReconciliationDecision.model_validate(raw)
    except Exception as error:
        print_openai_error(error)
        raise
