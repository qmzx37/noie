"""noie 백엔드 요청/응답 타입 모음입니다."""

from __future__ import annotations

from typing import Dict, Literal, TypedDict

from pydantic import BaseModel, Field


EmotionKey = Literal["F", "A", "D", "J", "C", "G", "T", "R"]
Level = Literal["High", "Mid", "Low"]
EMOTION_KEYS: list[EmotionKey] = ["F", "A", "D", "J", "C", "G", "T", "R"]


class PrimaryAxisScore(TypedDict):
    like: float
    dislike: float


EmotionAxisScore = Dict[EmotionKey, float]


class EmotionAnalysis(TypedDict):
    primary_axis: PrimaryAxisScore
    emotion_axis: EmotionAxisScore
    state_summary: str


class AnalyzeEmotionRequest(BaseModel):
    text: str = Field(min_length=1, examples=["개발은 하고 싶은데 좀 부담돼"])


class PrimaryAxisLevel(BaseModel):
    like: Level
    dislike: Level


class EmotionAxisLevel(BaseModel):
    F: Level
    A: Level
    D: Level
    J: Level
    C: Level
    G: Level
    T: Level
    R: Level


class UserView(BaseModel):
    primary_axis: PrimaryAxisLevel
    emotion_axis: EmotionAxisLevel
    state_summary: str


class PrimaryAxisRaw(BaseModel):
    like: float
    dislike: float


class EmotionAxisRaw(BaseModel):
    F: float
    A: float
    D: float
    J: float
    C: float
    G: float
    T: float
    R: float


class AdminView(BaseModel):
    primary_axis: PrimaryAxisRaw
    emotion_axis: EmotionAxisRaw


class AnalyzeEmotionResponse(BaseModel):
    input: str
    user_view: UserView
    admin_view: AdminView
    source: Literal["openai", "rule_based"]


class GenerateTitleRequest(BaseModel):
    text: str = Field(min_length=1, examples=["나 오늘 친구랑 싸웠는데 기분이 이상해"])


class GenerateTitleResponse(BaseModel):
    title: str


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, examples=["나 오늘 친구랑 싸워서 힘들어"])
    messages: list[ChatHistoryMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    state_summary: str
    analysis: AnalyzeEmotionResponse
    source: Literal["openai", "rule_based"]
