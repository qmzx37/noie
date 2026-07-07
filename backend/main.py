"""감정 분석 채팅 MVP의 FastAPI 진입점입니다.

이 파일의 역할:
1. FastAPI 앱을 만듭니다.
2. POST /analyze-emotion API를 엽니다.
3. OpenAI 분석을 메인 분석기로 먼저 시도합니다.
4. OpenAI가 실패할 때만 규칙 기반 분석기로 fallback합니다.
5. 사용자용 user_view와 관리자용 admin_view를 나누어 반환합니다.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from emotion_analyzer import analyze_with_rules
from openai_analyzer import analyze_with_openai
from schemas import (
    EMOTION_KEYS,
    AnalyzeEmotionRequest,
    AnalyzeEmotionResponse,
    EmotionAnalysis,
)


app = FastAPI(
    title="noie",
    description="noie emotion analysis chat MVP with OpenAI as the main analyzer.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def to_level(score: float) -> str:
    """0~1 숫자 점수를 사용자용 Low/Mid/High 단계로 바꿉니다."""

    if score >= 0.7:
        return "High"
    if score >= 0.4:
        return "Mid"
    return "Low"


def build_response(
    text: str,
    analysis: EmotionAnalysis,
    source: str,
) -> dict:
    """API 최종 응답 구조를 만듭니다.

    user_view는 Low/Mid/High 문자열을 담고,
    admin_view는 0~1 숫자 원점수를 그대로 담습니다.
    """

    primary_axis = analysis["primary_axis"]
    emotion_axis = analysis["emotion_axis"]

    return {
        "input": text,
        "user_view": {
            "primary_axis": {
                "like": to_level(primary_axis["like"]),
                "dislike": to_level(primary_axis["dislike"]),
            },
            "emotion_axis": {
                key: to_level(emotion_axis[key])
                for key in EMOTION_KEYS
            },
            "state_summary": analysis["state_summary"],
        },
        "admin_view": {
            "primary_axis": primary_axis,
            "emotion_axis": emotion_axis,
        },
        "source": source,
    }


@app.get("/")
def health_check() -> dict[str, str]:
    """서버가 켜져 있는지 확인하는 간단한 API입니다."""

    return {"status": "ok", "service": "noie"}


@app.post("/analyze-emotion", response_model=AnalyzeEmotionResponse)
def analyze_emotion(request: AnalyzeEmotionRequest) -> dict:
    """사용자의 채팅 문장 하나를 감정 분석합니다."""

    text = request.text.strip()

    try:
        # OpenAI API를 메인 감정 분석기로 먼저 사용합니다.
        analysis = analyze_with_openai(text)
        source = "openai"
    except Exception:
        # OpenAI가 실패할 때만 rule_based fallback을 사용합니다.
        # 이 문구가 보이면 위쪽 openai_analyzer.py 로그에서 실제 실패 원인을 같이 확인하면 됩니다.
        print("[noie] OpenAI 실패 → rule_based fallback 사용")
        analysis = analyze_with_rules(text)
        source = "rule_based"

    return build_response(text, analysis, source)
