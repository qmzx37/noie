"""API 요청/응답 타입을 모아둔 파일입니다.

처음 백엔드를 볼 때는 이 파일부터 보면 좋습니다.
여기에는 "클라이언트가 무엇을 보내고", "서버가 무엇을 돌려주는지"가
한눈에 보이도록 타입을 정의해 둡니다.
"""

from __future__ import annotations

from typing import Dict, Literal, Optional, TypedDict

from pydantic import BaseModel, Field


# 감정축은 프로젝트 전체에서 항상 같은 8개를 사용합니다.
EmotionKey = Literal["F", "A", "D", "J", "C", "G", "T", "R"]

# 사용자가 보는 화면에는 숫자 대신 High/Mid/Low만 보여줍니다.
Level = Literal["High", "Mid", "Low"]

# 8축 순서를 한곳에서 관리합니다.
EMOTION_KEYS: list[EmotionKey] = ["F", "A", "D", "J", "C", "G", "T", "R"]


class PrimaryAxisScore(TypedDict):
    """관리자용 1차 관계축 원점수입니다."""

    like: float
    dislike: float


EmotionAxisScore = Dict[EmotionKey, float]


class EmotionAnalysis(TypedDict):
    """OpenAI 분석기와 규칙 기반 분석기가 공통으로 반환하는 내부 형식입니다."""

    primary_axis: PrimaryAxisScore
    emotion_axis: EmotionAxisScore
    state_summary: str


class AnalyzeEmotionRequest(BaseModel):
    """POST /analyze-emotion 요청 본문입니다."""

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
    emotionOwner: Optional["EmotionOwner"] = None
    analysisPerspective: Optional["AnalysisPerspective"] = None
    subjectScope: Optional["SubjectScope"] = None
    selfRelevance: Optional["SelfRelevance"] = None


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


MemoryType = Literal[
    "sensitive_event",
    "achievement",
    "goal",
    "dream",
    "idea",
    "relationship",
    "schedule",
    "todo",
    "task",
    "note",
    "daily_plan",
    "daily_context",
    "important_note",
    "none",
]

SavePolicy = Literal["ask", "auto", "none"]

SaveTarget = Literal[
    "daily_piece",
    "daily_trace",
    "dream_piece",
]

IntentCategory = Literal[
    "identity_goal",
    "future_dream",
    "action_todo",
    "scheduled_event",
    "completed_achievement",
    "sensitive_negative_event",
    "relationship_positive",
    "daily_note",
    "casual_none",
    "other_person_info",
]

EventTense = Literal["future", "present", "past", "unknown"]

UiType = Literal[
    "dream_confirm",
    "trace_confirm",
    "sensitive_confirm",
    "auto_saved",
    "none",
]

SubjectScope = Literal["self", "other_person", "shared", "unknown"]

SelfRelevance = Literal[
    "direct",
    "indirect",
    "none",
    "explicit_store_request",
    "unknown",
]

EmotionOwner = Literal["user", "other_person", "unknown"]

AnalysisPerspective = Literal[
    "self_emotion",
    "observed_other_info",
    "shared_event",
    "neutral_info",
]


class SaveDecision(BaseModel):
    """noie가 사용자 문장을 저장할지 결정한 결과입니다."""

    memoryType: MemoryType
    savePolicy: SavePolicy
    saveTargets: list[SaveTarget] = Field(default_factory=list)
    importance: int = 0
    displayCategory: str = ""
    reason: str = ""
    askText: Optional[str] = None
    confidence: float = 0.0
    intentCategory: IntentCategory = "casual_none"
    eventTense: EventTense = "unknown"
    userActionRequired: bool = False
    uiType: UiType = "none"
    subjectScope: SubjectScope = "unknown"
    selfRelevance: SelfRelevance = "unknown"
    shouldStore: bool = True


class AnalyzeEmotionResponse(BaseModel):
    """POST /analyze-emotion 최종 응답 형식입니다."""

    input: str
    user_view: UserView
    admin_view: AdminView
    source: Literal["openai", "rule_based"]
    save_decision: Optional[SaveDecision] = None
    emotionOwner: Optional[EmotionOwner] = None
    analysisPerspective: Optional[AnalysisPerspective] = None
    subjectScope: Optional[SubjectScope] = None
    selfRelevance: Optional[SelfRelevance] = None


class GenerateTitleRequest(BaseModel):
    """POST /generate-title 요청 본문입니다."""

    text: str = Field(min_length=1, examples=["나 오늘 친구랑 싸웠는데 기분이 이상해"])


class GenerateTitleResponse(BaseModel):
    """POST /generate-title 응답 형식입니다."""

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


DailyTraceItemType = Literal[
    "schedule",
    "record",
    "todo",
    "quote",
    "goal",
    "dream",
    "achievement",
    "important_note",
    "note",
    "daily_plan",
    "task",
    "relationship",
]


class ExtractDailyTraceRequest(BaseModel):
    text: str = Field(min_length=1, examples=["7월 12일 친구 만나기로 했어"])
    current_date: str = Field(examples=["2026-07-08"])


class ExtractDailyTraceResponse(BaseModel):
    has_trace: bool
    type: Optional[DailyTraceItemType] = None
    date: Optional[str] = None
    time: Optional[str] = None
    title: Optional[str] = None
    memo: Optional[str] = None
    targetDate: Optional[str] = None
    targetYear: Optional[str] = None
    targetText: Optional[str] = None
