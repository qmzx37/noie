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
- 단순 일정/사실 보고 문장은 감정을 과하게 추론하지 않습니다. 예: "나 내일 예비군 훈련가", "내일 학교 가", "내일 병원 가", "금요일에 과제 제출해"처럼 일정이나 사실만 말한 경우에는 명시적인 감정 표현이 없는 것으로 봅니다.
- 예비군, 훈련, 학교, 출근, 병원, 과제, 면접 같은 단어가 있다고 해서 자동으로 A 분노를 올리지 않습니다. 이런 단어는 일정 추출 후보가 될 수는 있지만, 그 자체만으로 분노 감정이라고 단정하지 않습니다.
- A 분노는 "짜증난다", "화난다", "억울하다", "개빡친다", "하기 싫다", "왜 해야 하냐", "귀찮다", "불합리하다"처럼 분노, 짜증, 억울함, 귀찮음, 강한 거부감이 직접 표현될 때 Mid/High로 올립니다.
- 단순 일정 문장은 기본적으로 A 분노 Low, F 공포 Low, D 우울 Low로 둡니다. T 긴장과 R 안정은 문맥에 따라 Low~Mid로 둘 수 있지만, "부담된다", "걱정된다", "긴장된다", "불안하다" 같은 표현이 직접 있을 때만 T/F를 더 올립니다.
- "나 내일 예비군 훈련가"는 A Low, T Low~Mid가 자연스럽습니다. "나 내일 예비군 훈련가서 짜증나"는 A Mid~High가 자연스럽습니다. "나 내일 예비군 훈련가는데 좀 긴장돼"는 T Mid, A Low가 자연스럽습니다. "나 내일 예비군 훈련 가기 싫어"는 A Mid, dislike Mid가 자연스럽습니다.
- 일정 추출 기능과 감정 분석 기능을 섞지 않습니다. 일정으로 저장될 수 있는 문장이라도 감정 분석에서는 명시된 감정 표현만 근거로 판단합니다.
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


감정 분석 관점 보정:
- noie는 문장 속 모든 사람의 감정을 분석하는 도구가 아니라, 사용자의 현재 감정 반응을 분석합니다.
- 다른 사람의 꿈, 목표, 할 일, 사건, 성과, 관계를 사용자가 단순히 전달한 경우에는 그 사람의 감정을 사용자의 감정처럼 추정하지 않습니다.
- 예: "지민이는 나중에 간호사가 되고 싶다고 했어"는 지민이의 미래 목표를 전달한 문장입니다. 사용자의 강한 감정 반응이 드러나지 않으면 G/J/T/D를 높이지 말고 대부분 Low로 둡니다.
- 다른 사람의 꿈이나 목표만 보고 G 욕구 High, J 기쁨 High, T 긴장 High를 주지 않습니다.
- 다른 사람의 실패나 사건만 보고 D 우울 High, F/T High를 주지 않습니다.
- 사용자가 관련 있게 말한 정도라면 C 호기심만 Low~Mid 정도 가능하지만, 상태 요약은 "다른 사람의 이야기를 전달한 내용이며 사용자 본인의 감정은 중립에 가깝습니다"처럼 중립적으로 작성합니다.
- 단, "지민이가 나한테 심하게 화냈어", "서아랑 크게 싸웠어", "나는 지민이 발표 준비를 도와줘야 해"처럼 사용자에게 직접 일어난 사건이나 사용자의 할 일은 기존처럼 사용자 관점에서 분석합니다.

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


def clean_generated_title(title: str) -> str:
    """OpenAI가 만든 제목을 15자 이내의 간단한 제목으로 정리합니다."""

    cleaned = title.strip().strip("\"'“”‘’")
    for character in ['"', "'", "“", "”", "‘", "’", ".", "!", "?", "。"]:
        cleaned = cleaned.replace(character, "")
    cleaned = " ".join(cleaned.split())
    return cleaned[:15] or "새 채팅"


def generate_title_with_openai(text: str) -> str:
    """사용자의 첫 문장으로 짧은 한국어 채팅 제목을 만듭니다."""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("[noie] OPENAI_API_KEY가 설정되지 않아 제목 생성을 건너뜁니다.")
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "사용자의 첫 문장을 보고 채팅방 제목을 만든다. "
                        "제목은 5~15자 정도의 짧은 한국어 명사구로 만든다. "
                        "따옴표, 마침표, 이모지는 넣지 않는다. "
                        "응답은 제목 텍스트만 반환한다."
                    ),
                },
                {"role": "user", "content": f"첫 문장: {text}"},
            ],
        )

        return clean_generated_title(extract_output_text(response))
    except Exception as error:
        print_openai_error(error)
        raise


SAVE_DECISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "memoryType": {
            "type": "string",
            "enum": [
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
            ],
        },
        "savePolicy": {"type": "string", "enum": ["ask", "auto", "none"]},
        "saveTargets": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["daily_piece", "daily_trace", "dream_piece"],
            },
        },
        "importance": {"type": "integer", "minimum": 0, "maximum": 100},
        "displayCategory": {"type": "string"},
        "reason": {"type": "string"},
        "askText": {"type": ["string", "null"]},
    },
    "required": [
        "memoryType",
        "savePolicy",
        "saveTargets",
        "importance",
        "displayCategory",
        "reason",
        "askText",
    ],
}


def generate_save_decision_with_openai(
    text: str,
    user_view: dict,
) -> dict[str, Any]:
    """문장 전체 의미를 보고 noie 저장 정책을 결정합니다."""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "너는 사용자의 문장 전체 의미를 보고 noie 앱의 저장 정책을 결정한다. "
                        "단어 하나만 보고 판단하지 말고 문장 전체 맥락을 본다. "
                        "memoryType은 sensitive_event, achievement, goal, dream, idea, relationship, schedule, todo, daily_context, none 중 하나다. "
                        "savePolicy는 ask, auto, none 중 하나다. saveTargets는 daily_piece, daily_trace, dream_piece 중 필요한 값을 넣고, none이면 빈 배열을 넣는다. "
                        "민감 사건 sensitive_event는 욕설/욕/뒷담화, 친구들이 나쁜 말을 함, 괴롭힘, 관계 갈등, 싸움, 상처, 배신, 차단, 실패, 탈락, 거절, 좌절, 상실, 불안, 공포, 우울, 번아웃, 충격, 무서운 꿈, 힘든 사건을 포함한다. "
                        "sensitive_event는 자동 저장하지 말고 savePolicy ask, saveTargets ['daily_piece'], importance 100, displayCategory '최근 사건', askText '최근 사건을 저장할까요?'로 한다. "
                        "'친구들이 내욕을 해'는 relationship이 아니라 sensitive_event다. "
                        "'친구랑 싸웠어', '나 오늘 취직에 실패했어', '면접 떨어졌어', '오늘 너무 불안했어'도 sensitive_event다. "
                        "긍정/중립 관계 변화만 relationship이다. 예: 친구를 새로 사귀었어, 친구랑 화해했어. "
                        "goal은 장기 목표나 해야 할 방향이다. dream은 되고 싶은 미래나 만들고 싶은 미래다. "
                        "achievement는 완료, 성공, 구현, 해결, 시작 같은 진전이다. "
                        "schedule/todo는 날짜나 해야 할 일정이다. none은 저장 가치가 낮은 인사, 잡담, 배고픔, ㅋㅋㅋ다. "
                        "응답은 JSON만 반환한다."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"문장: {text}\n"
                        f"감정 분석: {json.dumps(user_view, ensure_ascii=False)}"
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "save_decision",
                    "schema": SAVE_DECISION_SCHEMA,
                    "strict": True,
                }
            },
        )

        return json.loads(extract_output_text(response))
    except Exception as error:
        print_openai_error(error)
        raise


SAVE_DECISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "memoryType": {
            "type": "string",
            "enum": [
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
            ],
        },
        "savePolicy": {"type": "string", "enum": ["ask", "auto", "none"]},
        "saveTargets": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["daily_piece", "daily_trace", "dream_piece"],
            },
        },
        "importance": {"type": "integer", "minimum": 0, "maximum": 100},
        "displayCategory": {"type": "string"},
        "reason": {"type": "string"},
        "askText": {"type": ["string", "null"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "intentCategory": {
            "type": "string",
            "enum": [
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
            ],
        },
        "eventTense": {
            "type": "string",
            "enum": ["future", "present", "past", "unknown"],
        },
        "userActionRequired": {"type": "boolean"},
        "uiType": {
            "type": "string",
            "enum": [
                "dream_confirm",
                "trace_confirm",
                "sensitive_confirm",
                "auto_saved",
                "none",
            ],
        },
        "subjectScope": {
            "type": "string",
            "enum": ["self", "other_person", "shared", "unknown"],
        },
        "selfRelevance": {
            "type": "string",
            "enum": ["direct", "indirect", "none", "explicit_store_request", "unknown"],
        },
        "shouldStore": {"type": "boolean"},
    },
    "required": [
        "memoryType",
        "savePolicy",
        "saveTargets",
        "importance",
        "displayCategory",
        "reason",
        "askText",
        "confidence",
        "intentCategory",
        "eventTense",
        "userActionRequired",
        "uiType",
        "subjectScope",
        "selfRelevance",
        "shouldStore",
    ],
}


def generate_save_decision_with_openai(
    text: str,
    user_view: dict,
) -> dict[str, Any]:
    """Build the v2 noie memory gate decision from semantic meaning."""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You are noie's memory gate. Classify the user's sentence by semantic intent, not by simple keyword matching. "
                        "Decide whether this should be saved, where it should be saved, and whether the app should ask first. "
                        "Use Korean UI text exactly as requested.\n\n"
                        "Self relevance gate, before all other rules:\n"
                        "noie is the user's personal AI. Store only content directly related to the user. "
                        "First decide subjectScope and selfRelevance. "
                        "If the sentence is only about another person's dream, goal, todo, event, achievement, or relationship, and the user is not directly affected and did not explicitly ask to save it, return memoryType none, savePolicy none, saveTargets [], shouldStore false, subjectScope other_person, selfRelevance none, uiType none, askText null. "
                        "If the user explicitly asks to save/remember/record another person's content, use selfRelevance explicit_store_request and savePolicy ask. "
                        "If another person's event directly affects the user, use shared or self with direct/indirect relevance and continue classification. "
                        "Examples: '민수는 소방관이 되고 싶대' => none. '민수 꿈도 저장해줘' => ask. '민수가 나한테 욕했어' => sensitive_event. '나는 민수 발표 자료를 도와줘야 해' => todo/task.\n\n"
                        "Hard block examples:\n"
                        "'지민이는 나중에 간호사가 되고 싶다고 했어' => other_person, none, shouldStore false, no UI.\n"
                        "'민수는 항공 정비사가 되고 싶대' => other_person, none, shouldStore false, no UI.\n"
                        "'태호는 자기 카페를 차리는 게 목표래' => other_person, none, shouldStore false, no UI.\n"
                        "'도현이는 자격증 공부를 해야 한대' => other_person, none, shouldStore false, no UI.\n"
                        "'지민이가 나한테 심하게 화냈어' => shared/direct, sensitive_event.\n"
                        "'나는 지민이 발표 준비를 도와줘야 해' => shared/direct, todo/task.\n\n"
                        "Priority rules after the self relevance gate:\n"
                        "1. sensitive_event has highest priority. Negative events, insults, gossip, conflict, failure, rejection, anxiety, depression, shock, loss, or burnout are sensitive_event. "
                        "Friend/family/company words do not mean relationship if the event is harmful. Job/career words do not mean dream if the sentence says failure or rejection.\n"
                        "2. todo/task/schedule is higher priority than dream/goal when the sentence means an action the user needs to do, prepare, train, organize, submit, visit, or schedule. "
                        "Example: '소방관 체력 훈련도 해야겠어' is todo/task, not dream/goal. "
                        "3. dream/goal means future identity, long-term direction, career dream, life direction, or something the user wants to become or complete. "
                        "Example: '소방관이 되고 싶어' is dream/goal.\n"
                        "4. failure expressions make the sentence sensitive_event, not achievement or goal. "
                        "Example: '개발 프로젝트 실패했어' is sensitive_event.\n"
                        "5. achievement means completed success, progress, implementation, commit, pass, resolution. "
                        "6. relationship means positive or neutral relationship change only. Negative relationship events are sensitive_event. "
                        "7. If confidence is low but the sentence may be worth saving, use savePolicy ask. If it is not worth saving, use none.\n\n"
                        "Mapping:\n"
                        "- dream/goal: savePolicy ask, saveTargets ['dream_piece'], askText '꿈의 조각에 저장할까요?', uiType dream_confirm, eventTense future.\n"
                        "- todo/task/schedule/daily_plan: savePolicy ask, saveTargets ['daily_trace'], askText '하루의 흔적에 저장할까요?', uiType trace_confirm, eventTense future.\n"
                        "- sensitive_event: savePolicy ask, saveTargets ['daily_piece'], askText '최근 사건을 저장할까요?', uiType sensitive_confirm, importance 100.\n"
                        "- achievement: savePolicy auto or ask, saveTargets ['daily_piece','daily_trace'], uiType auto_saved or trace_confirm.\n"
                        "- relationship: savePolicy auto or ask, saveTargets ['daily_piece'].\n"
                        "- none: savePolicy none, saveTargets [], askText null, uiType none.\n\n"
                        "Return JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"sentence: {text}\n"
                        f"emotion_analysis: {json.dumps(user_view, ensure_ascii=False)}"
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "save_decision_v2",
                    "schema": SAVE_DECISION_SCHEMA,
                    "strict": True,
                }
            },
        )

        return json.loads(extract_output_text(response))
    except Exception as error:
        print_openai_error(error)
        raise


def generate_chat_reply_with_openai(
    text: str,
    state_summary: str,
    user_view: dict,
    messages: list[dict[str, str]] | None = None,
    is_project: bool = False,
    project_name: str | None = None,
    project_goal: str | None = None,
) -> str:
    """감정 분석 결과를 참고해 noie의 일반 대화 답변을 생성합니다."""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("[noie] OPENAI_API_KEY가 설정되지 않아 일반 답변 생성을 건너뜁니다.")
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    history = messages or []
    history_limit = 20 if is_project else 8
    history_text = "\n".join(
        f"{item.get('role', '')}: {item.get('content', '')}"
        for item in history[-history_limit:]
    )
    project_instruction = ""

    if is_project:
        project_instruction = f"""

프로젝트 대화 모드:
- 프로젝트 이름: {project_name or "미지정"}
- 프로젝트 목표: {project_goal or "미지정"}
- 최근 대화 맥락을 반드시 반영한다.
- 사용자가 "파이썬으로", "자바스크립트로", "간단하게", "복잡하게", "리액트로"처럼 짧게 말하면 바로 직전 사용자 요청을 보완하는 말로 해석한다.
- 사용자가 코드, 개발 코드, 알려줘, 만들어줘, 구현, 작성, 예제, 파이썬, 자바스크립트, 계산기, 앱, 함수, 클래스라고 말하면 code_request로 판단한다.
- code_request이면 질문만 하고 끝내지 말고 산출물을 먼저 제공한다.
- 정보가 부족해도 합리적인 기본값을 가정해서 실행 가능한 예시를 먼저 준다.
- 언어가 명시되지 않은 코드 요청은 기본값을 Python으로 둔다.
- 코드 요청에는 반드시 fenced code block을 포함한다.
- 코드 아래에는 짧은 설명과 실행 방법을 붙인다.
- 추가 질문은 답변과 코드를 제공한 뒤 마지막에 짧게만 한다.

예시:
이전 사용자: 계산기 개발 코드 줘
이전 assistant: 어떤 언어로 만들까요?
현재 사용자: 파이썬으로
올바른 응답: 파이썬 계산기 코드를 바로 제공하고 실행 방법을 설명한다.
잘못된 응답: 다시 어떤 기능을 원하는지 질문만 한다.
"""

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "너는 noie라는 감정 분석 채팅 도우미다. "
                        "사용자의 말에 한국어로 2~5문장 정도로 자연스럽게 답한다. "
                        "감정을 단정하지 말고 '~같아', '~일 수 있어'처럼 부드럽게 말한다. "
                        "감정 분석 결과를 참고하되 점수, 축 이름, JSON은 직접 말하지 않는다. "
                        "두려움/긴장/우울이 높으면 안정시키는 방향으로 답한다. "
                        "분노가 높으면 감정을 인정하되 공격적 행동을 부추기지 않는다. "
                        "호기심이 높으면 탐색 질문을 던져도 된다. "
                        "욕구가 높으면 원하는 것과 다음 한 걸음을 정리해준다. "
                        "안정감이 낮으면 무리한 행동보다 작고 쉬운 한 걸음을 제안한다. "
                        "자해, 극단적 선택, 위기 상황으로 보이면 신뢰할 수 있는 사람이나 긴급 도움을 요청하라는 안전 문장을 포함한다."
                        f"{project_instruction}"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"이전 대화:\n{history_text}\n\n"
                        f"프로젝트 대화 여부: {is_project}\n"
                        f"프로젝트 이름: {project_name or ''}\n"
                        f"프로젝트 목표: {project_goal or ''}\n\n"
                        f"현재 사용자 메시지: {text}\n\n"
                        f"상태 요약: {state_summary}\n"
                        f"사용자용 감정 분석: {json.dumps(user_view, ensure_ascii=False)}"
                    ),
                },
            ],
        )

        reply = extract_output_text(response).strip()
        return reply or fallback_chat_reply(state_summary)
    except Exception as error:
        print_openai_error(error)
        raise


def fallback_chat_reply(state_summary: str) -> str:
    """일반 답변 생성 실패 시 사용할 짧은 fallback 문장입니다."""

    return (
        f"{state_summary} 지금은 감정을 바로 해결하려 하기보다, 가장 크게 남는 감정이 무엇인지 "
        "천천히 짚어보면 좋을 것 같아."
    )
