"""noie FastAPI 백엔드 진입점입니다."""

from __future__ import annotations

import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from daily_trace_analyzer import extract_daily_trace_with_openai
from emotion_analyzer import analyze_with_rules
from openai_analyzer import (
    fallback_chat_reply,
    generate_chat_reply_with_openai,
    generate_save_decision_with_openai,
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
        "save_decision": build_fallback_save_decision(text, {
            "primary_axis": {
                "like": to_level(primary_axis["like"]),
                "dislike": to_level(primary_axis["dislike"]),
            },
            "emotion_axis": {
                key: to_level(emotion_axis[key])
                for key in EMOTION_KEYS
            },
            "state_summary": analysis["state_summary"],
        }),
    }


def build_save_decision(
    text: str,
    user_view: dict,
) -> dict:
    try:
        return normalize_save_decision(
            generate_save_decision_with_openai(text=text, user_view=user_view),
            text=text,
            user_view=user_view,
        )
    except Exception:
        return build_fallback_save_decision(text, user_view)


def normalize_save_decision(decision: dict, text: str, user_view: dict) -> dict:
    fallback = build_fallback_save_decision(text, user_view)
    memory_type = decision.get("memoryType")
    save_policy = decision.get("savePolicy")
    save_targets = decision.get("saveTargets")

    valid_types = {
        "sensitive_event",
        "achievement",
        "goal",
        "dream",
        "idea",
        "relationship",
        "schedule",
        "todo",
        "daily_context",
        "none",
    }
    valid_policies = {"ask", "auto", "none"}
    valid_targets = {"daily_piece", "daily_trace", "dream_piece"}

    if memory_type not in valid_types or save_policy not in valid_policies:
        return fallback
    if not isinstance(save_targets, list) or any(
        target not in valid_targets for target in save_targets
    ):
        return fallback

    if memory_type == "sensitive_event":
        save_policy = "ask"
        save_targets = ["daily_piece"]

    return {
        "memoryType": memory_type,
        "savePolicy": save_policy,
        "saveTargets": save_targets,
        "importance": int(decision.get("importance", fallback["importance"])),
        "displayCategory": str(
            decision.get("displayCategory") or fallback["displayCategory"]
        ),
        "reason": str(decision.get("reason") or fallback["reason"]),
        "askText": decision.get("askText")
        if decision.get("askText")
        else ("최근 사건을 저장할까요?" if memory_type == "sensitive_event" else None),
    }


def make_save_decision(
    memory_type: str,
    save_policy: str,
    save_targets: list[str],
    importance: int,
    display_category: str,
    reason: str,
    ask_text: str | None = None,
) -> dict:
    return {
        "memoryType": memory_type,
        "savePolicy": save_policy,
        "saveTargets": save_targets,
        "importance": importance,
        "displayCategory": display_category,
        "reason": reason,
        "askText": ask_text,
    }


def build_fallback_save_decision(text: str, user_view: dict) -> dict:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    summary = str(user_view.get("state_summary", ""))
    emotion_axis = user_view.get("emotion_axis", {})
    primary_axis = user_view.get("primary_axis", {})

    sensitive_pattern = re.compile(
        r"내\s*욕|욕을\s*해|뒷담|괴롭|싸움|싸웠|싸웟|다퉜|다툼|갈등|차단|상처|배신|"
        r"헤어졌|이별|손절|실패|실패햇|떨어졌|떨어졋|탈락|불합격|망했|망쳣|망침|"
        r"못했|안\s*됐|안됐|안됏|거절|거절당|취직\s*실패|면접\s*떨어|시험\s*망|"
        r"프로젝트\s*실패|코딩\s*테스트\s*떨어|서류\s*탈락|무너졌|좌절|포기하고\s*싶|"
        r"절망|잃었|잃어버렸|해고|퇴사당|버림받|불안|무서|무서운\s*꿈|악몽|공포|"
        r"놀랐|충격|멘붕|긴장돼|숨\s*막혀|우울|힘들|힘들엇|지쳤|지침|번아웃|"
        r"아무것도\s*하기\s*싫|눈물|울었|울엇|울음"
    )
    sensitive_summary_pattern = re.compile(
        r"상처|욕설|욕|불안|갈등|실패|탈락|거절|우울|힘듦|힘들|공포|충격|괴롭"
    )

    high_negative = any(
        emotion_axis.get(key) == "High" for key in ["F", "A", "D", "T"]
    )
    high_dislike = primary_axis.get("dislike") == "High"

    if (
        sensitive_pattern.search(normalized)
        or sensitive_summary_pattern.search(summary)
        or high_negative
        or high_dislike
    ):
        return make_save_decision(
            "sensitive_event",
            "ask",
            ["daily_piece"],
            100,
            "최근 사건",
            "문장 전체 의미상 상처, 불안, 갈등, 실패 또는 힘든 사건이 포함된 민감 사건입니다.",
            "최근 사건을 저장할까요?",
        )

    if re.search(r"새로\s*사귀|친해|화해|좋은\s*대화|도움\s*받", normalized):
        return make_save_decision(
            "relationship",
            "auto",
            ["daily_piece"],
            80,
            "관계",
            "긍정적이거나 중립적인 관계 변화입니다.",
        )

    if re.search(r"되고\s*싶|목표|취직하고\s*싶|개발자가\s*되|해야\s*할\s*방향", normalized):
        return make_save_decision(
            "goal",
            "auto",
            ["daily_piece", "daily_trace"],
            88 if re.search(r"목표|개발자가\s*되", normalized) else 78,
            "목표",
            "장기 목표나 앞으로의 방향이 드러난 문장입니다.",
        )

    if re.search(r"꿈|만들고\s*싶|언젠가|나중에|개인\s*ai", normalized):
        return make_save_decision(
            "dream",
            "auto",
            ["daily_piece", "daily_trace", "dream_piece"],
            85,
            "꿈",
            "미래에 되고 싶거나 만들고 싶은 바람입니다.",
        )

    if re.search(r"완성|완료|성공|구현|해결|시작|통과|배포|고침|수정", normalized):
        return make_save_decision(
            "achievement",
            "auto",
            ["daily_piece", "daily_trace"],
            90,
            "성과",
            "진전이나 성과가 드러난 문장입니다.",
        )

    if re.search(r"내일|오늘|이번\s*주|다음\s*주|\d{1,2}월|\d{1,2}일|예비군|병원|약속", normalized):
        return make_save_decision(
            "schedule",
            "auto",
            ["daily_trace"],
            75,
            "일정",
            "날짜나 일정 정보가 포함된 문장입니다.",
        )

    if re.search(r"아이디어|기능|화면|버튼|구조|바꾸자|추가|개선", normalized):
        return make_save_decision(
            "idea",
            "auto",
            ["daily_piece"],
            70,
            "아이디어",
            "기획이나 개선 아이디어입니다.",
        )

    return make_save_decision(
        "none",
        "none",
        [],
        0,
        "저장 안 함",
        "저장할 만큼 뚜렷한 기억 조각이 아닙니다.",
    )


def analyze_text(text: str) -> tuple[dict, str]:
    """OpenAI 분석을 먼저 시도하고 실패하면 rule_based로 fallback합니다."""

    try:
        analysis = analyze_with_openai(text)
        source = "openai"
    except Exception:
        print("[noie] OpenAI 분석 실패, rule_based fallback 사용")
        analysis = analyze_with_rules(text)
        source = "rule_based"

    response = build_response(text, analysis, source)
    response["save_decision"] = build_save_decision(
        text,
        response["user_view"],
    )

    return response, source


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
            is_project=request.is_project,
            project_name=request.project_name,
            project_goal=request.project_goal,
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
