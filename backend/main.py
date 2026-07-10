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


def make_save_decision(
    memory_type: str,
    save_policy: str,
    save_targets: list[str],
    importance: int,
    display_category: str,
    reason: str,
    ask_text: str | None = None,
    confidence: float = 0.75,
    intent_category: str = "casual_none",
    event_tense: str = "unknown",
    user_action_required: bool | None = None,
    ui_type: str = "none",
) -> dict:
    if user_action_required is None:
        user_action_required = save_policy == "ask"

    return {
        "memoryType": memory_type,
        "savePolicy": save_policy,
        "saveTargets": save_targets,
        "importance": importance,
        "displayCategory": display_category,
        "reason": reason,
        "askText": ask_text,
        "confidence": max(0.0, min(1.0, float(confidence))),
        "intentCategory": intent_category,
        "eventTense": event_tense,
        "userActionRequired": user_action_required,
        "uiType": ui_type,
    }


def text_matches(text: str, pattern: str) -> bool:
    return re.search(pattern, text, re.IGNORECASE) is not None



def get_analysis_perspective_from_decision(decision: dict) -> dict:
    subject_scope = str(decision.get("subjectScope") or "unknown")
    self_relevance = str(decision.get("selfRelevance") or "unknown")

    if subject_scope == "other_person" and self_relevance == "none":
        return {
            "emotionOwner": "other_person",
            "analysisPerspective": "observed_other_info",
            "subjectScope": "other_person",
            "selfRelevance": "none",
        }

    if subject_scope == "shared":
        return {
            "emotionOwner": "user",
            "analysisPerspective": "shared_event",
            "subjectScope": "shared",
            "selfRelevance": self_relevance,
        }

    if subject_scope == "self":
        return {
            "emotionOwner": "user",
            "analysisPerspective": "self_emotion",
            "subjectScope": "self",
            "selfRelevance": self_relevance,
        }

    return {
        "emotionOwner": "unknown",
        "analysisPerspective": "neutral_info",
        "subjectScope": subject_scope,
        "selfRelevance": self_relevance,
    }


def apply_emotion_perspective_gate(response: dict, save_decision: dict) -> dict:
    perspective = get_analysis_perspective_from_decision(save_decision)

    response.update(perspective)
    response.setdefault("user_view", {}).update(perspective)

    is_unrelated_other_person = (
        save_decision.get("subjectScope") == "other_person"
        and save_decision.get("selfRelevance") == "none"
        and save_decision.get("shouldStore") is False
    )

    if not is_unrelated_other_person:
        return response

    neutral_primary = {"like": 0.1, "dislike": 0.1}
    neutral_emotion = {
        "F": 0.1,
        "A": 0.1,
        "D": 0.1,
        "J": 0.1,
        "C": 0.25,
        "G": 0.1,
        "T": 0.1,
        "R": 0.25,
    }
    neutral_summary = (
        "다른 사람의 이야기를 전달한 내용으로 보이며, "
        "사용자 본인의 강한 감정 반응은 드러나지 않습니다. "
        "약한 관심 정도만 보입니다."
    )

    response["admin_view"] = {
        "primary_axis": neutral_primary,
        "emotion_axis": neutral_emotion,
    }
    response["user_view"] = {
        "primary_axis": {
            "like": to_level(neutral_primary["like"]),
            "dislike": to_level(neutral_primary["dislike"]),
        },
        "emotion_axis": {
            key: to_level(neutral_emotion[key])
            for key in EMOTION_KEYS
        },
        "state_summary": neutral_summary,
        **perspective,
    }

    return response

def is_sensitive_memory_text(text: str, summary: str = "") -> bool:
    source = f"{text} {summary}"
    return text_matches(
        source,
        r"내\s*욕|욕을\s*해|욕했|뒷담|괴롭|싸웠|싸웟|싸움|다퉜|다툼|갈등|차단|상처|배신|"
        r"헤어졌|이별|손절|실패|실패했|실패햇|떨어졌|떨어졋|탈락|불합격|망했|망쳤|망쳣|망침|"
        r"거절|거절당|면접\s*떨어|시험\s*망|프로젝트\s*실패|취직\s*실패|불안|무서|악몽|공포|"
        r"충격|멘붕|긴장돼|숨\s*막혀|우울|힘들|힘들었|힘들엇|지쳤|지침|번아웃|눈물|울었|울엇",
    )


def is_todo_memory_text(text: str) -> bool:
    return text_matches(
        text,
        r"해야\s*겠|해야겠다|해야겠어|해야\s*함|해야함|해야\s*해|가야\s*해|가야겠다|"
        r"준비해야|정리해야|운동해야|훈련.*해야|공부해야|제출해야|확인해야|만들어야|"
        r"README.*정리|포트폴리오.*정리",
    )


def is_schedule_memory_text(text: str) -> bool:
    return text_matches(
        text,
        r"내일|오늘|모레|이번\s*주|다음\s*주|\d{1,2}월|\d{1,2}일|예비군|병원|약속|회의|제출",
    )


def is_dream_memory_text(text: str) -> bool:
    return text_matches(
        text,
        r"되고\s*싶|되는\s*게\s*목표|되는게\s*목표|내\s*꿈|꿈은|목표야|목표는|"
        r"완성하고\s*싶|만들고\s*싶|취직하고\s*싶|출시하고\s*싶|가고\s*싶",
    )


def is_achievement_memory_text(text: str) -> bool:
    return text_matches(
        text,
        r"완성했|완료했|성공했|구현했|해결했|커밋|통과했|고쳤|수정했|배포했|시작했",
    )


def is_positive_relationship_text(text: str) -> bool:
    return text_matches(
        text,
        r"친구를\s*새로\s*사귀|새\s*친구|화해했|친해졌|도움\s*받|좋은\s*대화|응원해",
    )


def resolve_save_decision_policy(text: str, decision: dict, user_view: dict) -> dict:
    summary = str(user_view.get("state_summary", ""))
    emotion_axis = user_view.get("emotion_axis", {})
    primary_axis = user_view.get("primary_axis", {})
    high_negative = any(
        emotion_axis.get(key) == "High" for key in ["F", "A", "D", "T"]
    )
    high_dislike = primary_axis.get("dislike") == "High"

    if is_sensitive_memory_text(text, summary) or high_negative or high_dislike:
        return make_save_decision(
            "sensitive_event",
            "ask",
            ["daily_piece"],
            100,
            "최근 사건",
            "부정적 사건, 실패, 갈등, 불안, 상처가 포함되어 민감 사건으로 보정했습니다.",
            "최근 사건을 저장할까요?",
            0.95,
            "sensitive_negative_event",
            "past" if is_achievement_memory_text(text) else "present",
            True,
            "sensitive_confirm",
        )

    if is_todo_memory_text(text):
        return make_save_decision(
            "todo",
            "ask",
            ["daily_trace"],
            75,
            "할 일",
            "사용자가 앞으로 해야 할 행동이나 준비를 말하고 있어 todo로 보정했습니다.",
            "하루의 흔적에 저장할까요?",
            0.9,
            "action_todo",
            "future",
            True,
            "trace_confirm",
        )

    if is_schedule_memory_text(text) and decision.get("memoryType") in {"schedule", "todo", "none"}:
        return make_save_decision(
            "schedule",
            "ask",
            ["daily_trace"],
            70,
            "일정",
            "날짜나 일정 정보가 포함되어 하루의 흔적 후보로 보정했습니다.",
            "하루의 흔적에 저장할까요?",
            0.8,
            "scheduled_event",
            "future",
            True,
            "trace_confirm",
        )

    if is_dream_memory_text(text):
        memory_type = "goal" if text_matches(text, r"목표|취직") else "dream"
        return make_save_decision(
            memory_type,
            "ask",
            ["dream_piece"],
            88 if memory_type == "goal" else 85,
            "목표" if memory_type == "goal" else "꿈",
            "미래의 정체성, 진로, 장기 목표가 드러나 꿈의 조각 후보로 보정했습니다.",
            "꿈의 조각에 저장할까요?",
            0.9,
            "identity_goal" if memory_type == "goal" else "future_dream",
            "future",
            True,
            "dream_confirm",
        )

    if is_achievement_memory_text(text):
        return make_save_decision(
            "achievement",
            "auto",
            ["daily_piece", "daily_trace"],
            90,
            "성과",
            "완료, 성공, 구현, 해결 같은 성과가 드러납니다.",
            None,
            0.85,
            "completed_achievement",
            "past",
            False,
            "auto_saved",
        )

    if is_positive_relationship_text(text):
        return make_save_decision(
            "relationship",
            "auto",
            ["daily_piece"],
            80,
            "관계",
            "긍정적이거나 중립적인 관계 변화입니다.",
            None,
            0.8,
            "relationship_positive",
            "past",
            False,
            "auto_saved",
        )

    confidence = float(decision.get("confidence", 0.6) or 0.6)
    if confidence < 0.45 and decision.get("savePolicy") != "none":
        decision = {**decision, "savePolicy": "ask", "userActionRequired": True}

    return decision


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
        "task",
        "daily_plan",
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

    normalized = make_save_decision(
        memory_type,
        save_policy,
        save_targets,
        int(decision.get("importance", fallback["importance"]) or 0),
        str(decision.get("displayCategory") or fallback["displayCategory"]),
        str(decision.get("reason") or fallback["reason"]),
        decision.get("askText"),
        float(decision.get("confidence", fallback.get("confidence", 0.6)) or 0.6),
        str(decision.get("intentCategory") or fallback.get("intentCategory", "casual_none")),
        str(decision.get("eventTense") or fallback.get("eventTense", "unknown")),
        bool(decision.get("userActionRequired", save_policy == "ask")),
        str(decision.get("uiType") or fallback.get("uiType", "none")),
    )

    return resolve_save_decision_policy(text, normalized, user_view)


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


def build_fallback_save_decision(text: str, user_view: dict) -> dict:
    base_decision = make_save_decision(
        "none",
        "none",
        [],
        0,
        "저장 안 함",
        "저장할 만큼 뚜렷한 기억 조각이 아닙니다.",
        None,
        0.5,
        "casual_none",
        "unknown",
        False,
        "none",
    )
    return resolve_save_decision_policy(text, base_decision, user_view)


def has_explicit_store_request(text: str) -> bool:
    return text_matches(text, r"저장해줘|기억해줘|기록해줘|남겨줘|메모해줘")


def resolve_self_relevance(text: str) -> dict:
    explicit_store_request = has_explicit_store_request(text)
    has_self_marker = text_matches(
        text,
        r"\b나\b|나는|내가|내\s|나한테|나에게|우리|우리는|같이|함께|도와줘야|해줘야",
    )
    other_name_pattern = r"민수|지영|현우|유나|아라|수빈|친구|동기|선배|후배|엄마|아빠|동생|형|누나|회사\s*사람"
    has_other_subject = text_matches(text, other_name_pattern)
    direct_harm_or_relation = text_matches(
        text,
        r"나한테|나에게|내\s*욕|욕했|상처|싸웠|화해|도와줘야|챙겨줘야|같이|함께|우리",
    )

    if explicit_store_request:
        return {
            "subjectScope": "shared" if has_other_subject else "self",
            "selfRelevance": "explicit_store_request",
            "shouldStore": True,
        }

    if has_other_subject and not has_self_marker and not direct_harm_or_relation:
        return {
            "subjectScope": "other_person",
            "selfRelevance": "none",
            "shouldStore": False,
        }

    if has_other_subject and direct_harm_or_relation:
        return {
            "subjectScope": "shared",
            "selfRelevance": "direct",
            "shouldStore": True,
        }

    if has_self_marker or not has_other_subject:
        return {
            "subjectScope": "self",
            "selfRelevance": "direct",
            "shouldStore": True,
        }

    return {
        "subjectScope": "unknown",
        "selfRelevance": "indirect",
        "shouldStore": True,
    }


def apply_self_relevance_fields(decision: dict, self_relevance: dict) -> dict:
    return {
        **decision,
        "subjectScope": self_relevance["subjectScope"],
        "selfRelevance": self_relevance["selfRelevance"],
        "shouldStore": self_relevance["shouldStore"],
    }


def make_save_decision(
    memory_type: str,
    save_policy: str,
    save_targets: list[str],
    importance: int,
    display_category: str,
    reason: str,
    ask_text: str | None = None,
    confidence: float = 0.75,
    intent_category: str = "casual_none",
    event_tense: str = "unknown",
    user_action_required: bool | None = None,
    ui_type: str = "none",
    subject_scope: str = "unknown",
    self_relevance: str = "none",
    should_store: bool | None = None,
) -> dict:
    if user_action_required is None:
        user_action_required = save_policy == "ask"
    if should_store is None:
        should_store = save_policy != "none"

    return {
        "memoryType": memory_type,
        "savePolicy": save_policy,
        "saveTargets": save_targets,
        "importance": importance,
        "displayCategory": display_category,
        "reason": reason,
        "askText": ask_text,
        "confidence": max(0.0, min(1.0, float(confidence))),
        "intentCategory": intent_category,
        "eventTense": event_tense,
        "userActionRequired": user_action_required,
        "uiType": ui_type,
        "subjectScope": subject_scope,
        "selfRelevance": self_relevance,
        "shouldStore": should_store,
    }


def make_do_not_store_decision(text: str, self_relevance: dict) -> dict:
    return make_save_decision(
        "none",
        "none",
        [],
        0,
        "저장 안 함",
        "사용자 본인과 직접 관련 없는 다른 사람의 이야기라 저장하지 않습니다.",
        None,
        0.9,
        "casual_none",
        "unknown",
        False,
        "none",
        self_relevance["subjectScope"],
        self_relevance["selfRelevance"],
        False,
    )


def resolve_save_decision_policy(text: str, decision: dict, user_view: dict) -> dict:
    self_relevance = resolve_self_relevance(text)
    if (
        self_relevance["subjectScope"] == "other_person"
        and self_relevance["selfRelevance"] == "none"
        and not self_relevance["shouldStore"]
    ):
        return make_do_not_store_decision(text, self_relevance)

    summary = str(user_view.get("state_summary", ""))
    emotion_axis = user_view.get("emotion_axis", {})
    primary_axis = user_view.get("primary_axis", {})
    high_negative = any(
        emotion_axis.get(key) == "High" for key in ["F", "A", "D", "T"]
    )
    high_dislike = primary_axis.get("dislike") == "High"

    if is_sensitive_memory_text(text, summary) or high_negative or high_dislike:
        decision = make_save_decision(
            "sensitive_event",
            "ask",
            ["daily_piece"],
            100,
            "최근 사건",
            "사용자와 직접 관련된 부정적 사건, 실패, 갈등, 불안, 상처입니다.",
            "최근 사건을 저장할까요?",
            0.95,
            "sensitive_negative_event",
            "present",
            True,
            "sensitive_confirm",
        )
        return apply_self_relevance_fields(decision, self_relevance)

    if is_todo_memory_text(text):
        decision = make_save_decision(
            "todo",
            "ask",
            ["daily_trace"],
            75,
            "할 일",
            "사용자에게 필요한 행동이나 준비입니다.",
            "하루의 흔적에 저장할까요?",
            0.9,
            "action_todo",
            "future",
            True,
            "trace_confirm",
        )
        return apply_self_relevance_fields(decision, self_relevance)

    if is_schedule_memory_text(text) and decision.get("memoryType") in {"schedule", "todo", "none"}:
        decision = make_save_decision(
            "schedule",
            "ask",
            ["daily_trace"],
            70,
            "일정",
            "사용자와 관련된 일정 정보입니다.",
            "하루의 흔적에 저장할까요?",
            0.8,
            "scheduled_event",
            "future",
            True,
            "trace_confirm",
        )
        return apply_self_relevance_fields(decision, self_relevance)

    if is_dream_memory_text(text):
        memory_type = "goal" if text_matches(text, r"목표|취직") else "dream"
        decision = make_save_decision(
            memory_type,
            "ask",
            ["dream_piece"],
            88 if memory_type == "goal" else 85,
            "목표" if memory_type == "goal" else "꿈",
            "사용자의 미래 방향이나 장기 목표입니다.",
            "꿈의 조각에 저장할까요?",
            0.9,
            "identity_goal" if memory_type == "goal" else "future_dream",
            "future",
            True,
            "dream_confirm",
        )
        return apply_self_relevance_fields(decision, self_relevance)

    if is_achievement_memory_text(text):
        decision = make_save_decision(
            "achievement",
            "auto",
            ["daily_piece", "daily_trace"],
            90,
            "성과",
            "사용자와 관련된 성과입니다.",
            None,
            0.85,
            "completed_achievement",
            "past",
            False,
            "auto_saved",
        )
        return apply_self_relevance_fields(decision, self_relevance)

    if is_positive_relationship_text(text):
        decision = make_save_decision(
            "relationship",
            "auto",
            ["daily_piece"],
            80,
            "관계",
            "사용자와 관련된 긍정적이거나 중립적인 관계 변화입니다.",
            None,
            0.8,
            "relationship_positive",
            "past",
            False,
            "auto_saved",
        )
        return apply_self_relevance_fields(decision, self_relevance)

    confidence = float(decision.get("confidence", 0.6) or 0.6)
    if confidence < 0.45 and decision.get("savePolicy") != "none":
        decision = {**decision, "savePolicy": "ask", "userActionRequired": True}

    return apply_self_relevance_fields(decision, self_relevance)


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
        "task",
        "daily_plan",
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

    normalized = make_save_decision(
        memory_type,
        save_policy,
        save_targets,
        int(decision.get("importance", fallback["importance"]) or 0),
        str(decision.get("displayCategory") or fallback["displayCategory"]),
        str(decision.get("reason") or fallback["reason"]),
        decision.get("askText"),
        float(decision.get("confidence", fallback.get("confidence", 0.6)) or 0.6),
        str(decision.get("intentCategory") or fallback.get("intentCategory", "casual_none")),
        str(decision.get("eventTense") or fallback.get("eventTense", "unknown")),
        bool(decision.get("userActionRequired", save_policy == "ask")),
        str(decision.get("uiType") or fallback.get("uiType", "none")),
        str(decision.get("subjectScope") or fallback.get("subjectScope", "unknown")),
        str(decision.get("selfRelevance") or fallback.get("selfRelevance", "none")),
        bool(decision.get("shouldStore", save_policy != "none")),
    )

    return resolve_save_decision_policy(text, normalized, user_view)


def build_fallback_save_decision(text: str, user_view: dict) -> dict:
    self_relevance = resolve_self_relevance(text)
    if (
        self_relevance["subjectScope"] == "other_person"
        and self_relevance["selfRelevance"] == "none"
        and not self_relevance["shouldStore"]
    ):
        return make_do_not_store_decision(text, self_relevance)

    base_decision = make_save_decision(
        "none",
        "none",
        [],
        0,
        "저장 안 함",
        "저장할 만큼 뚜렷한 기억 조각이 아닙니다.",
        None,
        0.5,
        "casual_none",
        "unknown",
        False,
        "none",
        self_relevance["subjectScope"],
        self_relevance["selfRelevance"],
        False,
    )
    return resolve_save_decision_policy(text, base_decision, user_view)


def is_todo_memory_text(text: str) -> bool:
    return text_matches(
        text,
        r"해야\s*겠|해야겠다|해야겠어|해야\s*함|해야함|해야\s*해|줘야\s*해|"
        r"도와줘야|챙겨줘야|가야\s*해|가야겠다|준비해야|정리해야|운동해야|"
        r"훈련.*해야|공부해야|제출해야|확인해야|만들어야|발표\s*자료|README.*정리|포트폴리오.*정리",
    )


def has_explicit_store_request(text: str) -> bool:
    return text_matches(text, r"저장해줘|기억해줘|기록해줘|남겨줘|꿈의\s*조각에\s*넣어줘")


def resolve_self_relevance(text: str) -> dict:
    explicit_store_request = has_explicit_store_request(text)
    other_subject = text_matches(
        text,
        r"(지민이|지민|민수|태호|서아|도현이|도현|하린이|하린|유나|유찬이|유찬|재윤이|재윤|민지|"
        r"친구|동생|형|누나|엄마|아빠|선배|후배|동기|그\s*사람)"
        r"(는|은|이|가|도|랑|와|과|한테|에게)?",
    )
    clear_other_subject = text_matches(
        text,
        r"(지민이는|지민은|민수는|태호는|서아는|도현이는|하린이는|유나는|유찬이는|재윤이는|민지는|"
        r"친구는|동생은|형은|누나는|엄마는|아빠는|선배는|후배는|동기는|그\s*사람은)",
    )
    self_marker = text_matches(
        text,
        r"\b나\b|나는|내가|내\s|나한테|나에게|나를|나랑|우리|우리\s*팀|같이|함께|"
        r"도와줘야|연락해야|만나야|약속|싸웠어|화해했어|친해졌어",
    )
    direct_relevance = text_matches(
        text,
        r"나한테|나에게|나를|나랑|내\s*얘기|내\s*욕|우리|우리\s*팀|같이|함께|"
        r"도와줘야|연락해야|만나야|약속|싸웠어|화해했어|친해졌어|화냈어|뒤에서",
    )

    if explicit_store_request:
        return {
            "subjectScope": "shared" if other_subject else "self",
            "selfRelevance": "explicit_store_request",
            "shouldStore": True,
        }

    if clear_other_subject and not self_marker and not direct_relevance:
        return {
            "subjectScope": "other_person",
            "selfRelevance": "none",
            "shouldStore": False,
        }

    if other_subject and direct_relevance:
        return {
            "subjectScope": "shared",
            "selfRelevance": "direct",
            "shouldStore": True,
        }

    if self_marker or not other_subject:
        return {
            "subjectScope": "self",
            "selfRelevance": "direct",
            "shouldStore": True,
        }

    return {
        "subjectScope": "unknown",
        "selfRelevance": "unknown",
        "shouldStore": True,
    }


def make_do_not_store_decision(text: str, self_relevance: dict, event_tense: str = "unknown") -> dict:
    return make_save_decision(
        "none",
        "none",
        [],
        0,
        "저장 안 함",
        "사용자 본인과 직접 관련 없는 다른 사람의 이야기라 저장하지 않습니다.",
        None,
        1.0,
        "other_person_info",
        event_tense,
        False,
        "none",
        self_relevance["subjectScope"],
        self_relevance["selfRelevance"],
        False,
    )


def apply_self_relevance_gate(text: str, decision: dict) -> dict:
    self_relevance = resolve_self_relevance(text)
    if (
        self_relevance["subjectScope"] == "other_person"
        and self_relevance["selfRelevance"] == "none"
        and not self_relevance["shouldStore"]
    ):
        return make_do_not_store_decision(
            text,
            self_relevance,
            str(decision.get("eventTense") or "unknown"),
        )

    return apply_self_relevance_fields(decision, self_relevance)


def is_sensitive_memory_text(text: str, summary: str = "") -> bool:
    source = f"{text} {summary}"
    return text_matches(
        source,
        r"내\s*욕|욕을\s*해|욕했|뒷담|뒤에서|괴롭|싸웠|싸웟|싸움|다퉜|다툼|갈등|차단|상처|배신|"
        r"헤어졌|이별|손절|실패|실패했|실패햇|떨어졌|떨어졋|탈락|불합격|망했|망쳤|망쳣|망침|"
        r"거절|거절당|면접\s*떨어|시험\s*망|프로젝트\s*실패|취직\s*실패|불안|무서|악몽|공포|"
        r"충격|멘붕|긴장돼|숨\s*막혀|우울|힘들|힘들었|힘들엇|지쳤|지침|번아웃|눈물|울었|울엇|화냈",
    )


def resolve_save_decision_policy(text: str, decision: dict, user_view: dict) -> dict:
    self_relevance = resolve_self_relevance(text)
    if (
        self_relevance["subjectScope"] == "other_person"
        and self_relevance["selfRelevance"] == "none"
        and not self_relevance["shouldStore"]
    ):
        return make_do_not_store_decision(text, self_relevance)

    summary = str(user_view.get("state_summary", ""))
    emotion_axis = user_view.get("emotion_axis", {})
    primary_axis = user_view.get("primary_axis", {})
    high_negative = any(
        emotion_axis.get(key) == "High" for key in ["F", "A", "D", "T"]
    )
    high_dislike = primary_axis.get("dislike") == "High"

    if is_sensitive_memory_text(text, summary) or high_negative or high_dislike:
        decision = make_save_decision(
            "sensitive_event",
            "ask",
            ["daily_piece"],
            100,
            "최근 사건",
            "사용자와 직접 관련된 부정적 사건, 실패, 갈등, 불안, 상처입니다.",
            "최근 사건을 저장할까요?",
            0.95,
            "sensitive_negative_event",
            "present",
            True,
            "sensitive_confirm",
        )
        return apply_self_relevance_gate(text, decision)

    if is_todo_memory_text(text):
        decision = make_save_decision(
            "todo",
            "ask",
            ["daily_trace"],
            75,
            "할 일",
            "사용자에게 필요한 행동이나 준비입니다.",
            "하루의 흔적에 저장할까요?",
            0.9,
            "action_todo",
            "future",
            True,
            "trace_confirm",
        )
        return apply_self_relevance_gate(text, decision)

    if is_schedule_memory_text(text) and decision.get("memoryType") in {"schedule", "todo", "none"}:
        decision = make_save_decision(
            "schedule",
            "ask",
            ["daily_trace"],
            70,
            "일정",
            "사용자와 관련된 일정 정보입니다.",
            "하루의 흔적에 저장할까요?",
            0.8,
            "scheduled_event",
            "future",
            True,
            "trace_confirm",
        )
        return apply_self_relevance_gate(text, decision)

    if is_dream_memory_text(text):
        memory_type = "goal" if text_matches(text, r"목표|취직") else "dream"
        decision = make_save_decision(
            memory_type,
            "ask",
            ["dream_piece"],
            88 if memory_type == "goal" else 85,
            "목표" if memory_type == "goal" else "꿈",
            "사용자의 미래 방향이나 장기 목표입니다.",
            "꿈의 조각에 저장할까요?",
            0.9,
            "identity_goal" if memory_type == "goal" else "future_dream",
            "future",
            True,
            "dream_confirm",
        )
        return apply_self_relevance_gate(text, decision)

    if is_achievement_memory_text(text):
        decision = make_save_decision(
            "achievement",
            "auto",
            ["daily_piece", "daily_trace"],
            90,
            "성과",
            "사용자와 관련된 성과입니다.",
            None,
            0.85,
            "completed_achievement",
            "past",
            False,
            "auto_saved",
        )
        return apply_self_relevance_gate(text, decision)

    if is_positive_relationship_text(text):
        decision = make_save_decision(
            "relationship",
            "auto",
            ["daily_piece"],
            80,
            "관계",
            "사용자와 관련된 긍정적이거나 중립적인 관계 변화입니다.",
            None,
            0.8,
            "relationship_positive",
            "past",
            False,
            "auto_saved",
        )
        return apply_self_relevance_gate(text, decision)

    confidence = float(decision.get("confidence", 0.6) or 0.6)
    if confidence < 0.45 and decision.get("savePolicy") != "none":
        decision = {**decision, "savePolicy": "ask", "userActionRequired": True}

    return apply_self_relevance_gate(text, decision)


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
    save_decision = build_save_decision(
        text,
        response["user_view"],
    )
    response["save_decision"] = save_decision
    response = apply_emotion_perspective_gate(response, save_decision)

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
