"""API 요청/응답 타입을 모아둔 파일입니다.

처음 백엔드를 볼 때는 이 파일부터 보면 좋습니다.
여기에는 "클라이언트가 무엇을 보내고", "서버가 무엇을 돌려주는지"가
한눈에 보이도록 타입을 정의해 둡니다.
"""

from __future__ import annotations

from typing import Dict, Literal, TypedDict

from pydantic import BaseModel, Field


# 감정축은 프로젝트 전체에서 항상 같은 8개를 사용합니다.
# Literal을 쓰면 오타가 났을 때 타입 검사기가 잡아줄 수 있습니다.
EmotionKey = Literal["F", "A", "D", "J", "C", "G", "T", "R"]

# 사용자가 보는 화면에는 숫자 대신 High/Mid/Low만 보여줍니다.
Level = Literal["High", "Mid", "Low"]

# 8축 순서를 한곳에서 관리합니다.
# main.py와 emotion_analyzer.py가 이 순서를 같이 사용합니다.
EMOTION_KEYS: list[EmotionKey] = ["F", "A", "D", "J", "C", "G", "T", "R"]


class PrimaryAxisScore(TypedDict):
    """관리자용 1차 관계축 원점수입니다."""

    like: float
    dislike: float


# 감정축 원점수입니다.
# 예: {"F": 0.1, "A": 0.2, ...}
EmotionAxisScore = Dict[EmotionKey, float]


class EmotionAnalysis(TypedDict):
    """OpenAI 분석기와 규칙 기반 분석기가 공통으로 반환하는 내부 형식입니다."""

    primary_axis: PrimaryAxisScore
    emotion_axis: EmotionAxisScore
    state_summary: str


class AnalyzeEmotionRequest(BaseModel):
    """POST /analyze-emotion 요청 본문입니다."""

    # min_length=1은 빈 문자열 요청을 막기 위한 최소 검증입니다.
    text: str = Field(
        min_length=1,
        examples=["나 개발은 하고 싶은데 너무 부담되고 지쳐"],
    )


class PrimaryAxisLevel(BaseModel):
    """사용자용 1차 관계축 레벨입니다."""

    like: Level
    dislike: Level


class EmotionAxisLevel(BaseModel):
    """사용자용 8축 감정 레벨입니다."""

    F: Level
    A: Level
    D: Level
    J: Level
    C: Level
    G: Level
    T: Level
    R: Level


class UserView(BaseModel):
    """실제 채팅 UI에 보여주기 좋은 응답입니다."""

    primary_axis: PrimaryAxisLevel
    emotion_axis: EmotionAxisLevel
    state_summary: str


class PrimaryAxisRaw(BaseModel):
    """관리자/디버깅용 1차 관계축 숫자 점수입니다."""

    like: float
    dislike: float


class EmotionAxisRaw(BaseModel):
    """관리자/디버깅용 8축 감정 숫자 점수입니다."""

    F: float
    A: float
    D: float
    J: float
    C: float
    G: float
    T: float
    R: float


class AdminView(BaseModel):
    """튜닝할 때 확인할 수 있는 숫자 응답입니다."""

    primary_axis: PrimaryAxisRaw
    emotion_axis: EmotionAxisRaw


class AnalyzeEmotionResponse(BaseModel):
    """POST /analyze-emotion 최종 응답 형식입니다."""

    input: str
    user_view: UserView
    admin_view: AdminView
    # source는 어떤 분석기가 최종 응답을 만들었는지 알려줍니다.
    # openai: OpenAI API 분석 성공
    # rule_based: OpenAI 실패 후 규칙 기반 분석기로 fallback
    source: Literal["openai", "rule_based"]
