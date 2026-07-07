"""OpenAI API를 사용하는 noie 감정 분석기입니다.

중요:
- API 키는 코드에 직접 넣지 않습니다.
- `.env` 또는 운영 환경 변수의 `OPENAI_API_KEY`를 사용합니다.
- 이 파일이 실패를 발생시키면 main.py가 rule_based 분석기로 fallback합니다.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict

from dotenv import load_dotenv

from emotion_analyzer import clamp_score
from schemas import EMOTION_KEYS, EmotionAnalysis


# `.env` 파일의 OPENAI_API_KEY, OPENAI_MODEL 값을 환경 변수로 읽어 옵니다.
# 이미 운영 환경에서 같은 변수가 설정되어 있으면 그 값을 그대로 사용할 수 있습니다.
load_dotenv()


# OpenAI에게 전달하는 기준 프롬프트입니다.
# API 응답 구조는 JSON_SCHEMA가 강제하므로, 여기서는 "어떻게 판단할지"를 자세히 설명합니다.
SYSTEM_PROMPT = """
당신은 한국어 문장을 분석하는 noie 감정 분석기입니다.
사용자의 한 문장을 읽고 1차 반응(like/dislike)과 2차 감정 8축(F/A/D/J/C/G/T/R)을 0~1 숫자로 평가합니다.

반드시 지켜야 할 원칙:
- 단어 하나만 보고 기계적으로 판단하지 말고, 문장 전체의 맥락과 모순된 감정을 함께 봅니다.
- 한 문장 안에 좋은 마음과 싫은 마음이 동시에 있을 수 있습니다.
- like와 dislike는 서로 반대값이 아닙니다. 둘 다 높거나, 둘 다 낮을 수 있습니다.
- 8축 감정도 서로 배타적이지 않습니다. 예: 기쁨(J)과 긴장(T)이 동시에 높을 수 있습니다.
- 겉으로 표현된 감정과 실제 내면 감정이 충돌하면 내면 감정을 더 우선합니다.
- "웃고 있었다", "괜찮다고 말했다", "기분이 나쁜 건 아니다", "다 괜찮다" 같은 표현은 실제 감정이 아니라 겉표현이거나 방어적 표현일 수 있습니다.
- 같은 문장 안에 "속은 무너졌다", "사실은 서운했다", "마음이 불편했다", "허전했다", "우울해졌다", "마음이 무거웠다" 같은 내면 표현이 있으면 그 내면 표현을 더 강하게 반영합니다.
- 겉으로 웃었다는 이유만으로 J를 Mid 이상으로 올리지 않습니다. 실제 즐거움, 만족, 반가움이 내면 감정으로 드러날 때 J를 올립니다.
- 괜찮다고 말했다는 이유만으로 R을 Mid 이상으로 올리지 않습니다. 실제 편안함, 안도, 마음이 놓임이 드러날 때 R을 올립니다.
- "좋은 일이 생겼는데 마음이 무거워"처럼 긍정 사건과 부정적 내면이 함께 있으면, 사건 자체보다 현재 감정 표현을 더 우선합니다.
- 모든 점수는 0 이상 1 이하의 숫자로 반환합니다.
- 응답은 지정된 JSON 구조만 반환하고, JSON 밖에 설명이나 markdown을 쓰지 않습니다.

점수 기준:
- 0.00~0.20: 거의 없음
- 0.21~0.39: 약함
- 0.40~0.69: 중간
- 0.70~1.00: 강함

1차 반응:
- like: 호감, 끌림, 선호, 수용감, 긍정적 관심, 계속하고 싶은 마음입니다.
- dislike: 불호, 거부감, 회피감, 싫음, 부담, 불편함, 거리 두고 싶은 마음입니다.
- 예: "개발은 하고 싶은데 좀 부담돼"는 like와 dislike가 동시에 올라갈 수 있습니다.

2차 감정 8축 정의:
- F 공포(Fear): 위험을 예상하거나 위협을 느끼는 감정입니다. 실패, 손실, 거절, 혼남, 불확실한 결과가 두려울 때 올라갑니다.
- A 분노(Anger): 부당함, 침해, 짜증, 억울함, 공격성, 비난하고 싶은 마음입니다. 단순한 불편함보다 "화가 남"의 방향이 있을 때 높게 봅니다.
- D 우울(Depression/Sadness): 무기력, 슬픔, 낙담, 상실감, 외로움, 자책, 의욕 저하입니다. 조용히 가라앉는 감정일수록 높게 봅니다.
- J 기쁨(Joy): 즐거움, 만족, 감사, 반가움, 유쾌함, 성취 후의 밝은 정서입니다. 단, 들뜸만 있고 불안이 크면 J와 T가 함께 높을 수 있습니다.
- C 호기심(Curiosity): 단순한 긍정 감정이 아닙니다. 궁금함, 의미 탐색, 해석 욕구, 이해하고 싶은 마음, 낯선 감정에 대한 탐색성입니다. "왜 이런 기분이지?", "무슨 뜻일까?", "알아보고 싶다" 같은 방향이면 높게 봅니다.
- G 욕구(Goal/Desire): 단순한 긍정 감정이 아닙니다. 현재 사용자의 욕구, 성취욕, 소유욕, 보상 욕구, 관계 욕구, 표현 욕구, 행동 추진력입니다. "말하고 싶다", "표현하고 싶다", "연락하고 싶다", "다가가고 싶다", "성공하고 싶다", "시작하고 싶다", "얻고 싶다", "해내고 싶다"처럼 사용자의 직접 욕구나 추진 의지가 드러나면 Mid 이상으로 봅니다. 다만 "타인이 나에게 기대한다", "좋은 일이 생겼다", "이미 원하는 걸 얻었다"는 사실만으로 G를 높이지 않습니다. 타인의 기대는 G보다 T/F/D를 올리는 신호일 수 있습니다. "원하는 걸 이미 얻었는데 기쁘지 않다"처럼 현재 추진 욕구가 약해진 문장은 G를 무조건 High로 두지 않습니다. 직접 욕구가 있더라도 두려움, 부담, 후회 예상이 함께 있으면 F/T도 같이 높입니다.
- T 긴장(Tension): 압박, 초조, 불안정한 각성, 부담, 조급함, 눈치 봄, 몸과 마음이 굳는 느낌입니다. 좋은 일을 앞두고 있어도 마음이 조마조마하면 올라갑니다.
- R 안정(Relief/Rest): 기쁨이 아니라 안정감입니다. 편안함, 안도, 안전함, 정리된 느낌, 마음이 놓이는 상태입니다. 기쁜 상황이어도 마음이 복잡하거나 불안하면 R은 낮거나 중간일 수 있습니다.

2차 테스트 보정 규칙:
- 최신 평가 보정 우선순위: 겉으로 보이는 사건이나 표현보다 사용자가 현재 느끼는 속감정, 회피 반응, 공허감, 무기력, 압박감을 더 우선합니다. 좋은 사건이 있더라도 현재 감정이 불안/부담/공허/회피라면 J/R보다 F/T/D/dislike를 더 중요하게 봅니다.
- 겉표현보다 속감정을 우선합니다. "괜찮다고 웃었다", "다 괜찮다고 말했다", "웃고 있었다", "기분이 나쁜 건 아니다", "평온하다" 같은 표현은 실제 감정이 아니라 겉표현일 수 있습니다.
- 같은 문장 안에 "속으로 무너졌다", "사실은 신경 쓰였다", "마음이 텅 비었다", "공허했다", "허전했다", "의미가 없어 보였다", "눈물이 날 것 같았다" 같은 내면 표현이 있으면 그 내면 감정을 더 우선합니다.
- 겉으로 웃었다는 이유만으로 J를 Mid 이상으로 올리지 않습니다. 괜찮다고 말했다는 이유만으로 R을 Mid 이상으로 올리지 않습니다.
- 회피 표현은 F/T를 올립니다. "도망치고 싶다", "피하고 싶다", "숨고 싶다", "가까워지기 싫다", "말하기 싫다", "먼저 연락하기 싫다"는 단순 dislike가 아니라 회피 반응입니다. 이런 표현이 있으면 F 또는 T를 최소 Mid 이상으로 판단합니다.
- "좋은 기회인데 피하고 싶다", "축하받았는데 도망치고 싶다", "기대했는데 부담돼"처럼 긍정 사건과 회피가 함께 있으면 J보다 F/T를 더 중요하게 봅니다.
- 회피는 단순히 "싫다"가 아니라 몸과 마음이 물러나는 반응입니다. 그래서 "축하받았는데 이상하게 도망치고 싶어졌어"는 축하라는 긍정 사건보다 도망치고 싶은 반응을 핵심으로 보고, F/T를 너무 낮게 두지 않습니다.
- 공허함과 무기력은 D를 높이고 R을 낮춥니다. "공허하다", "허전하다", "마음이 텅 비었다", "아무것도 의미 없어 보인다", "살아있는 느낌이 없다", "웃음이 안 나온다", "손이 안 움직인다"는 우울/무기력 신호입니다. 이런 표현이 있으면 D를 Mid 이상으로 두고, 강하면 High로 판단합니다. 이때 R은 보통 Low입니다.
- "평온한데 살아있는 느낌이 없다"는 안정이라기보다 무기력에 가깝습니다. R을 높이지 않습니다.
- "웃긴 얘기를 들었는데 웃음이 잘 안 나왔어"처럼 웃어야 할 맥락에서 웃음이 나오지 않는 표현은 단순 중립이 아니라 감정 저하나 무기력 신호일 수 있습니다. 이 경우 J는 Low가 자연스럽고, D는 Low보다 Mid가 자연스러울 수 있습니다.
- "그 일을 끝냈는데 후련하기보다 공허해"처럼 완료/성취 사실과 공허함이 함께 있으면 공허함이 핵심입니다. 일을 끝냈다는 사실만으로 R을 올리지 말고, D는 High, R은 Low 쪽을 우선 고려합니다.
- "오늘은 편한 것 같은데 아무것도 의미가 없어 보여"처럼 편안함 표현과 의미 없음이 함께 있으면, 의미 없음이 핵심이면 D를 높이고 R을 낮춥니다.
- 긍정 사건과 실제 감정을 분리합니다. "축하받았다", "칭찬받았다", "좋은 기회다", "성공했다", "좋은 말을 들었다"는 긍정 사건입니다. 하지만 현재 감정이 "무섭다", "부담스럽다", "불안하다", "공허하다", "무겁다", "도망치고 싶다"이면 현재 감정 표현을 더 우선합니다.
- 긍정 사건만 보고 J를 High로 올리지 않습니다. J는 실제 기쁨, 설렘, 즐거움이 현재 감정으로 분명할 때만 높입니다.
- "사람들이 잘한다고 해주는데 나는 점점 작아지는 느낌이야"처럼 칭찬과 자기 위축이 함께 있으면 칭찬보다 자기 위축, 압박, 우울감을 더 중요하게 봅니다. J를 높이기보다 D/T/dislike 가능성을 봅니다.
- G는 현재의 욕구, 성취욕, 관계 욕구, 표현 욕구, 행동 추진력입니다. "하고 싶다", "성공하고 싶다", "말하고 싶다", "만나고 싶다", "인정받고 싶다"가 직접 나오면 G를 Mid 이상으로 볼 수 있습니다.
- 하지만 "이미 얻었는데 기쁘지 않다", "칭찬받았는데 부담된다", "기대받아서 무섭다"는 G를 무조건 높이지 않습니다. 타인의 기대는 G가 아니라 T/F/D를 올리는 신호입니다.
- like/dislike는 단순 긍정/부정 단어 개수가 아닙니다. like는 현재 끌림, 호감, 원하는 마음, 긍정적 반응입니다. dislike는 부담, 회피, 불편함, 거부감, 압박감입니다.
- 좋은 사건이 있어도 현재 반응이 강하게 불편하거나 회피적이면 dislike를 Mid~High로 둘 수 있습니다. like와 dislike는 반대값이 아니며 동시에 높을 수 있습니다.
- 예시 기준: "축하받았는데 이상하게 도망치고 싶어졌어"는 회피 반응이 핵심이므로 F/T를 낮게 두지 않습니다.
- 예시 기준: "웃긴 얘기를 들었는데 웃음이 잘 안 나왔어"는 단순 중립이 아니라 감정 저하 가능성으로 보고, J는 Low, D는 Mid가 자연스러울 수 있습니다.
- 예시 기준: "그 일을 끝냈는데 후련하기보다 공허해"는 공허함이 핵심이므로 D는 High, R은 Low 쪽이 자연스럽습니다. 일을 끝냈다는 사실만으로 R을 올리지 않습니다.
- 예시 기준: "오늘은 편한 것 같은데 아무것도 의미가 없어 보여"는 편함보다 의미 없음이 핵심이면 D를 높이고 R을 낮춥니다.
- 예시 기준: "사람들이 잘한다고 해주는데 나는 점점 작아지는 느낌이야"는 칭찬보다 자기 위축과 우울을 더 중요하게 봅니다.

상태 요약(state_summary):
- 사용자가 이해하기 쉬운 한국어 한 문장으로 씁니다.
- 가장 두드러진 감정과 동시에 섞인 감정을 함께 요약합니다.
- 예: "하고 싶은 마음은 있지만 부담과 긴장이 함께 올라온 상태입니다."
"""


# OpenAI structured output을 위한 JSON Schema입니다.
# 이 구조는 기존 API 응답 구조를 깨지 않기 위해 유지합니다.
JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["primary_axis", "emotion_axis", "state_summary"],
    "properties": {
        "primary_axis": {
            "type": "object",
            "additionalProperties": False,
            "required": ["like", "dislike"],
            "properties": {
                "like": {"type": "number", "minimum": 0, "maximum": 1},
                "dislike": {"type": "number", "minimum": 0, "maximum": 1},
            },
        },
        "emotion_axis": {
            "type": "object",
            "additionalProperties": False,
            "required": ["F", "A", "D", "J", "C", "G", "T", "R"],
            "properties": {
                "F": {"type": "number", "minimum": 0, "maximum": 1},
                "A": {"type": "number", "minimum": 0, "maximum": 1},
                "D": {"type": "number", "minimum": 0, "maximum": 1},
                "J": {"type": "number", "minimum": 0, "maximum": 1},
                "C": {"type": "number", "minimum": 0, "maximum": 1},
                "G": {"type": "number", "minimum": 0, "maximum": 1},
                "T": {"type": "number", "minimum": 0, "maximum": 1},
                "R": {"type": "number", "minimum": 0, "maximum": 1},
            },
        },
        "state_summary": {"type": "string"},
    },
}


def print_openai_error(error: Exception) -> None:
    """OpenAI 호출 실패 원인을 서버 로그에서 보기 좋게 출력합니다."""

    error_name = type(error).__name__
    status_code = getattr(error, "status_code", None)
    message = str(error)
    lowered_message = message.lower()

    if isinstance(error, json.JSONDecodeError):
        print(f"[noie] JSON 파싱 문제: {error_name}: {message}")
        return

    if error_name == "AuthenticationError" or status_code == 401:
        print(f"[noie] 인증 문제: OPENAI_API_KEY를 확인해 주세요. {error_name}: {message}")
        return

    if status_code == 429 or any(
        word in lowered_message
        for word in ["quota", "billing", "credit", "insufficient"]
    ):
        print(f"[noie] 결제/크레딧/사용량 문제: {error_name}: {message}")
        return

    if status_code in [400, 404] and "model" in lowered_message:
        print(f"[noie] 모델 이름 문제: OPENAI_MODEL을 확인해 주세요. {error_name}: {message}")
        return

    print(f"[noie] OpenAI 호출 실패: {error_name}: {message}")


def extract_output_text(response: Any) -> str:
    """OpenAI Responses API 응답에서 JSON 문자열을 꺼냅니다."""

    output_text = getattr(response, "output_text", None)
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    raise ValueError("OpenAI response did not include output_text.")


def normalize_result(data: Dict[str, Any]) -> EmotionAnalysis:
    """OpenAI가 준 JSON을 서버 내부 EmotionAnalysis 형식으로 정리합니다."""

    primary_axis = data.get("primary_axis", {})
    emotion_axis = data.get("emotion_axis", {})

    normalized_primary = {
        "like": clamp_score(float(primary_axis.get("like", 0.0))),
        "dislike": clamp_score(float(primary_axis.get("dislike", 0.0))),
    }

    normalized_emotions = {
        key: clamp_score(float(emotion_axis.get(key, 0.0)))
        for key in EMOTION_KEYS
    }

    state_summary = data.get("state_summary", "")
    if not isinstance(state_summary, str) or not state_summary.strip():
        state_summary = "감정 상태를 분석했지만 요약 문장이 비어 있습니다."

    return {
        "primary_axis": normalized_primary,
        "emotion_axis": normalized_emotions,
        "state_summary": state_summary.strip(),
    }


def analyze_with_openai(text: str) -> EmotionAnalysis:
    """OpenAI를 메인 감정 분석기로 사용합니다."""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("[noie] OPENAI_API_KEY가 설정되지 않았습니다.")
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    try:
        # openai 패키지가 설치되어 있을 때만 여기서 import합니다.
        from openai import OpenAI

        client = OpenAI(api_key=api_key)

        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"분석할 문장: {text}"},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "emotion_analysis",
                    "description": "Korean emotion analysis result for noie.",
                    "schema": JSON_SCHEMA,
                    "strict": True,
                }
            },
        )

        raw_text = extract_output_text(response)
        parsed = json.loads(raw_text)
        return normalize_result(parsed)
    except Exception as error:
        print_openai_error(error)
        raise
