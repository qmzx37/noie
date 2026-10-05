"""기존 Place v0.1의 관찰/선호를 최소화합니다. 좌표/ID/metadata는 없습니다."""

import re
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from agent.recommendation_context import HOME_PATTERN, question_topics, recommendation_needed
from .schemas import ContractModel, Score


class PlaceContext(ContractModel):
    """방문은 선호가 아니며 occurred_at 미상과 기록 생성 시각을 분리합니다."""

    place_name: Annotated[str, Field(strict=True, min_length=1, max_length=120, pattern=r"\S")]
    kind: Literal["visit", "context", "preference"]
    preference: Literal["like", "dislike"] | None = None
    occurred_at: AwareDatetime | None = None
    created_at: AwareDatetime
    confidence: Score | None = None
    relevance: Score

    @model_validator(mode="after")
    def validate_preference(self) -> "PlaceContext":
        """기존 Place의 kind/preference 조합을 그대로 강제합니다."""
        if (self.kind == "preference") != (self.preference is not None):
            raise ValueError("preference 방향은 kind=preference에만 필요합니다.")
        return self


def place_question(question: str) -> bool:
    """기존 필요성/주제 helper와 작은 장소 표현 경계만 사용합니다. NLP router가 아닙니다."""
    return recommendation_needed(question) and (bool(re.search(r"어디|장소|갈까|카페|도서관|산책", question)) or bool(re.search(HOME_PATTERN, question)))


def related_place(item: PlaceContext, question: str) -> bool:
    """명시적 장소/기존 주제 일치 또는 일반 어디 질문만 인정합니다. 선호를 추측하지 않습니다."""
    return place_question(question) and (item.place_name in question or "어디" in question or any(
        bool(re.search(HOME_PATTERN, item.place_name)) if topic == "집" else topic in item.place_name.lower()
        for topic in question_topics(question)))
