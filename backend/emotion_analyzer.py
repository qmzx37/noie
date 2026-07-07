"""규칙 기반 fallback 감정 분석기입니다.

이 파일은 OpenAI API가 실패했을 때를 위한 안전장치입니다.
예를 들어 다음 상황에서도 서버가 멈추지 않고 응답해야 합니다.

- OPENAI_API_KEY가 아직 설정되지 않은 경우
- 인터넷/API 호출이 실패한 경우
- OpenAI 응답이 JSON으로 파싱되지 않는 경우

그래서 이 파일은 머신러닝 없이, 키워드 규칙만으로 점수를 계산합니다.
초기 MVP에서는 정확도보다 "흐름이 끝까지 작동하는 것"이 더 중요합니다.
"""

from __future__ import annotations

from typing import Dict, List

from schemas import EMOTION_KEYS, EmotionAnalysis, EmotionAxisScore, PrimaryAxisScore


# like는 호감, 끌림, 긍정 반응을 뜻합니다.
# "안녕"은 강한 호감은 아니지만 대화를 여는 긍정 신호이므로 like를 약간 올립니다.
# "신나" 계열은 기쁨(J)뿐 아니라 긍정 반응이므로 like도 함께 올립니다.
LIKE_KEYWORDS = [
    "안녕",
    "좋아",
    "좋다",
    "괜찮아",
    "마음에 들어",
    "하고 싶어",
    "가고 싶어",
    "먹고 싶어",
    "재밌어",
    "재밌다",
    "끌려",
    "기대돼",
    "궁금해",
    "신나",
    "신난다",
    "행복하다",
    "기쁘다",
    "하고 싶",
    "가고 싶",
    "먹고 싶",
    "만들고 싶",
]

# dislike는 불호, 부담, 거부감, 회피를 뜻합니다.
# like와 dislike는 반대값이 아닙니다.
# "하고 싶은데 부담돼"처럼 둘 다 높을 수 있습니다.
DISLIKE_KEYWORDS = [
    "싫어",
    "별로",
    "부담",
    "답답",
    "지쳐",
    "피곤",
    "무서워",
    "짜증",
    "하기 싫어",
    "회피",
    "귀찮아",
    "부담되",
]

# 8축 감정별 키워드 목록입니다.
# J 기쁨에는 "신나", "신난다", "재밌다", "좋다", "행복하다", "기쁘다"를 추가했습니다.
# 이 단어들은 아래 JOY_PATTERNS 보정에서도 다시 확인해서 J가 High가 되도록 합니다.
EMOTION_KEYWORDS: Dict[str, List[str]] = {
    "F": ["무서워", "두려워", "걱정", "불안", "실패할까 봐"],
    "A": ["짜증", "화나", "억울", "빡쳐", "답답"],
    "D": ["우울", "무기력", "지침", "지쳐", "아무것도 하기 싫어", "힘이 안 나"],
    "J": ["좋아", "좋다", "재밌어", "재밌다", "행복", "행복하다", "기뻐", "기쁘다", "신나", "신난다"],
    "C": ["궁금", "알고 싶어", "신기", "탐구", "배워보고 싶어"],
    "G": ["하고 싶어", "먹고 싶어", "가고 싶어", "갖고 싶어", "만들고 싶어", "하고 싶", "가고 싶", "먹고 싶", "만들고 싶"],
    "T": ["부담", "부담되", "압박", "긴장", "해야 하는데", "급해", "막막해"],
    "R": ["편안", "쉬고 싶어", "안정", "조용", "차분", "여유"],
}

# 대표 패턴은 단순 키워드보다 더 강하게 반응시키기 위한 보정용입니다.
# 예: "하고 싶은데"는 욕심(G)을 강하게 올려주는 식입니다.
DESIRE_PATTERNS = ["하고 싶", "가고 싶", "먹고 싶", "갖고 싶", "만들고 싶"]
FATIGUE_PATTERNS = ["지쳐", "피곤", "무기력", "힘이 안 나"]
TENSION_PATTERNS = ["부담", "부담되", "압박", "긴장", "막막"]

# 기쁨 표현 보정용 패턴입니다.
# 이 단어가 있으면 J 기쁨 점수를 최소 0.7 이상으로 올립니다.
JOY_PATTERNS = ["신나", "신난다", "재밌다", "좋다", "행복하다", "기쁘다"]

# 가벼운 인사 표현 보정용 패턴입니다.
# "안녕"은 대화를 시작하는 긍정 신호라 like를 Low에서 Mid 쪽으로 약간 올립니다.
GREETING_PATTERNS = ["안녕"]


def clamp_score(value: float) -> float:
    """점수를 0.0~1.0 사이로 고정합니다.

    점수 계산 중 1.2처럼 범위를 넘는 값이 나올 수 있습니다.
    API 응답은 항상 0~1이어야 하므로 여기서 잘라줍니다.
    """

    return round(max(0.0, min(1.0, value)), 2)


def count_keyword_matches(text: str, keywords: List[str]) -> int:
    """사용자 문장 안에 키워드가 몇 개 들어 있는지 셉니다."""

    return sum(1 for keyword in keywords if keyword in text)


def score_from_keywords(text: str, keywords: List[str], base_score: float) -> float:
    """키워드 개수를 0~1 점수로 바꿉니다.

    계산 방식:
    - 기본 점수 base_score를 먼저 줍니다.
    - 키워드가 하나 발견될 때마다 0.2를 더합니다.
    - 마지막에 clamp_score로 0~1 사이에 맞춥니다.
    """

    match_count = count_keyword_matches(text, keywords)
    return clamp_score(base_score + match_count * 0.2)


def analyze_primary_axis(text: str) -> PrimaryAxisScore:
    """1차 관계축 like/dislike를 계산합니다."""

    like = score_from_keywords(text, LIKE_KEYWORDS, 0.12)
    dislike = score_from_keywords(text, DISLIKE_KEYWORDS, 0.08)

    # "안녕"은 가벼운 호감 신호로 보고 like를 Mid에 가까운 값까지 올립니다.
    if any(pattern in text for pattern in GREETING_PATTERNS):
        like = max(like, 0.42)

    # "신나" 같은 기쁨 표현은 긍정 반응이므로 like도 Mid 이상으로 올립니다.
    if any(pattern in text for pattern in JOY_PATTERNS):
        like = max(like, 0.55)

    # "부담", "압박", "긴장" 같은 표현은 거부감/부담감 신호이므로
    # dislike가 사용자 화면에서 Mid 이상으로 보이도록 최소 0.46까지 올립니다.
    if any(pattern in text for pattern in TENSION_PATTERNS):
        dislike = max(dislike, 0.46)

    # "하고 싶다" 계열 표현은 긍정적 끌림이 있다고 보고 like를 최소 0.72까지 올립니다.
    if any(pattern in text for pattern in DESIRE_PATTERNS):
        like = max(like, 0.72)

    return {
        "like": clamp_score(like),
        "dislike": clamp_score(dislike),
    }


def analyze_emotion_axis(text: str) -> EmotionAxisScore:
    """2차 감정축 F/A/D/J/C/G/T/R을 계산합니다."""

    # 먼저 각 축의 키워드 목록으로 기본 점수를 계산합니다.
    emotion_axis = {
        key: score_from_keywords(text, EMOTION_KEYWORDS[key], 0.1)
        for key in EMOTION_KEYS
    }

    # 기쁨 표현이 있으면 J 기쁨을 High로 보여주기 위해 최소 0.7 이상으로 보정합니다.
    if any(pattern in text for pattern in JOY_PATTERNS):
        emotion_axis["J"] = max(emotion_axis["J"], 0.72)

    # 욕구 표현이 있으면 G를 High가 되기 쉬운 값으로 보정합니다.
    if any(pattern in text for pattern in DESIRE_PATTERNS):
        emotion_axis["G"] = max(emotion_axis["G"], 0.76)

    # 부담/압박 표현이 있으면 T를 High가 되기 쉬운 값으로 보정합니다.
    if any(pattern in text for pattern in TENSION_PATTERNS):
        emotion_axis["T"] = max(emotion_axis["T"], 0.84)

    # 지침/피곤 표현이 있으면 D를 Mid 이상으로 보정합니다.
    if any(pattern in text for pattern in FATIGUE_PATTERNS):
        emotion_axis["D"] = max(emotion_axis["D"], 0.51)

    return {key: clamp_score(emotion_axis[key]) for key in EMOTION_KEYS}


def create_state_summary(
    primary_axis: PrimaryAxisScore,
    emotion_axis: EmotionAxisScore,
) -> str:
    """점수 조합을 사용자가 읽기 쉬운 한 문장으로 바꿉니다."""

    like = primary_axis["like"]
    dislike = primary_axis["dislike"]
    desire = emotion_axis["G"]
    joy = emotion_axis["J"]
    tension = emotion_axis["T"]
    sadness = emotion_axis["D"]
    rest = emotion_axis["R"]

    if joy >= 0.7 and like >= 0.4:
        return "기쁨과 긍정 반응이 올라와 있어, 지금은 가볍게 즐거움을 표현하고 있는 상태입니다."

    if like >= 0.5 and desire >= 0.5 and tension >= 0.5:
        return "개발에 대한 끌림과 욕구는 살아 있지만, 부담과 긴장이 실행을 막고 있는 상태입니다."

    if dislike >= 0.5 and sadness >= 0.5:
        return "불호와 우울감이 올라와 있어서, 지금은 무리하게 밀어붙이기보다 부담을 낮추는 것이 필요합니다."

    if like >= 0.5 and desire >= 0.5:
        return "호감과 욕구가 살아 있어서, 작게 시작하면 움직일 수 있는 상태입니다."

    if rest >= 0.5:
        return "안정과 회복 욕구가 보이는 상태입니다."

    return "문장에 담긴 호감/불호와 8축 감정을 함께 분석했습니다."


def analyze_with_rules(text: str) -> EmotionAnalysis:
    """규칙 기반 분석 전체 흐름을 실행합니다."""

    primary_axis = analyze_primary_axis(text)
    emotion_axis = analyze_emotion_axis(text)

    return {
        "primary_axis": primary_axis,
        "emotion_axis": emotion_axis,
        "state_summary": create_state_summary(primary_axis, emotion_axis),
    }
