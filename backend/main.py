"""noie FastAPI 백엔드 진입점입니다."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from daily_trace_analyzer import extract_daily_trace_with_openai
from emotion_analyzer import analyze_with_rules
from openai_analyzer import (
    fallback_chat_reply,
    generate_chat_reply_with_openai,
    generate_title_with_openai,
    analyze_with_openai,
)
from schemas import (
    EMOTION_KEYS,
    AnalyzeEmotionRequest,
    AnalyzeEmotionResponse,
    ChatRequest,
    ChatResponse,
    EmotionAnalysis,
    ExtractDailyTraceRequest,
    ExtractDailyTraceResponse,
    GenerateTitleRequest,
    GenerateTitleResponse,
)


app = FastAPI(
    title="noie",
    description="noie emotion analysis chat MVP.",
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


def analyze_text(text: str) -> tuple[dict, str]:
    """OpenAI 분석을 먼저 시도하고 실패하면 rule_based로 fallback합니다."""

    try:
        analysis = analyze_with_openai(text)
        source = "openai"
    except Exception:
        print("[noie] OpenAI 분석 실패, rule_based fallback 사용")
        analysis = analyze_with_rules(text)
        source = "rule_based"

    return build_response(text, analysis, source), source


def fallback_title(text: str) -> str:
    cleaned = " ".join(text.strip().split())
    for character in ['"', "'", "“", "”", "‘", "’", ".", "!", "?"]:
        cleaned = cleaned.replace(character, "")
    return cleaned[:15] or "새 채팅"


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "noie"}


@app.post("/generate-title", response_model=GenerateTitleResponse)
def generate_title(request: GenerateTitleRequest) -> dict[str, str]:
    text = request.text.strip()

    try:
        title = generate_title_with_openai(text)
    except Exception:
        title = fallback_title(text)

    return {"title": title}


@app.post("/analyze-emotion", response_model=AnalyzeEmotionResponse)
def analyze_emotion(request: AnalyzeEmotionRequest) -> dict:
    text = request.text.strip()
    response, _source = analyze_text(text)
    return response


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> dict:
    text = request.text.strip()
    analysis_response, source = analyze_text(text)
    state_summary = analysis_response["user_view"]["state_summary"]

    history = [
        {"role": message.role, "content": message.content}
        for message in request.messages
    ]

    try:
        reply = generate_chat_reply_with_openai(
            text=text,
            state_summary=state_summary,
            user_view=analysis_response["user_view"],
            messages=history,
        )
    except Exception:
        reply = fallback_chat_reply(state_summary)

    return {
        "reply": reply,
        "state_summary": state_summary,
        "analysis": analysis_response,
        "source": source,
    }


@app.post("/extract-daily-trace", response_model=ExtractDailyTraceResponse)
def extract_daily_trace(request: ExtractDailyTraceRequest) -> dict:
    text = request.text.strip()
    current_date = request.current_date.strip()

    try:
        candidate = extract_daily_trace_with_openai(
            text=text,
            current_date=current_date,
        )
    except Exception:
        return {"has_trace": False}

    if not candidate.get("has_trace"):
        return {"has_trace": False}

    trace_type = candidate.get("type")
    date = candidate.get("date")
    title = candidate.get("title")

    if trace_type not in ["schedule", "record", "todo", "quote", "goal"]:
        return {"has_trace": False}
    if not isinstance(date, str) or len(date) != 10:
        return {"has_trace": False}
    if not isinstance(title, str) or not title.strip():
        return {"has_trace": False}

    time = candidate.get("time")
    memo = candidate.get("memo")
    target_date = candidate.get("targetDate")
    target_year = candidate.get("targetYear")
    target_text = candidate.get("targetText")

    return {
        "has_trace": True,
        "type": trace_type,
        "date": date,
        "time": time if isinstance(time, str) and time.strip() else None,
        "title": title.strip()[:40],
        "memo": memo if isinstance(memo, str) and memo.strip() else text,
        "targetDate": target_date
        if isinstance(target_date, str) and target_date.strip()
        else None,
        "targetYear": target_year
        if isinstance(target_year, str) and target_year.strip()
        else None,
        "targetText": target_text
        if isinstance(target_text, str) and target_text.strip()
        else None,
    }
