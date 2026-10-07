"""명시적인 한국어 행동 문형만 해석하는 보수적인 Behavior Specialist v0.1입니다."""

import re

from memory_privacy import automatic_memory_allowed
from agent.behavior_schemas import BehaviorAnalysis, BehaviorContext, BehaviorObservation
from agent.lv4.schemas import AgentOpinion, OpinionEvidence, SpecialistInput
from agent.lv4.specialist import SpecialistAgent


# 문장 전체를 검사합니다. 단순 키워드 검색으로 타인/인용/조건문을 사실로 만들지 않습니다.
_PREFIX = (
    r"(?:(?:나는|내가|나|저는|제가)\s+)?"
    r"(?:(?:오늘|어제|방금|지금|내일|모레|저녁에|아침에|오전에|오후에|"
    r"\d{1,2}시부터\s+\d{1,2}시까지)\s+)*"
)
_ACTION = (
    r"(?P<action>(?:(?:[A-Za-z][A-Za-z0-9_-]{0,39}|파이썬|기타|피아노)\s+)?"
    r"(?:운동|개발|공부|독서|산책|요리|연습|게임|뜨개질|그림\s+그리기|사진\s+촬영))"
)
_FORMS = {
    "not_performed": r"(?:안\s*했어|안\s*했다|안\s*했어요|안\s*했습니다|하지\s*않았어|하지\s*않았다|못\s*했어)",
    "ongoing": r"(?:하고\s*있어|하고\s*있다|하고\s*있어요|하고\s*있습니다|하는\s*중이야)",
    "intended": r"(?:할\s*거야|할\s*거예요|할\s*예정이야|할\s*계획이야|하겠어|해야겠어|해야겠다)",
    "desired": r"(?:하고\s*싶어|하고\s*싶다|하고\s*싶어요)",
    "candidate": r"할까",
    "performed": r"(?:했어|했다|했어요|했습니다)",
}
_CLAUSE = re.compile(
    _PREFIX + _ACTION + r"(?:을|를)?\s*"
    + "(?:" + "|".join(f"(?P<{status}>{form})" for status, form in _FORMS.items()) + r")(?=$|[\s,])"
)
_SEPARATOR = re.compile(r"(?:\s*,\s*|\s+그리고\s+|\s+)")


class BehaviorSpecialist(SpecialistAgent):
    """공통 run/registry 계약을 유지합니다. DB/OpenAI/Tool 실행 권한은 없습니다."""

    def __init__(self) -> None:
        """기존 registry에서 behavior 이름으로 등록할 수 있게 합니다."""
        super().__init__("behavior", "명시적인 사용자 행동의 수행·진행·의도·욕구·비수행·후보를 구분합니다.")

    def analyze(self, request: BehaviorContext) -> BehaviorAnalysis:
        """지원 문형이 아니면 추측하지 않습니다. 원문은 변경하거나 저장하지 않습니다."""
        context = BehaviorContext.model_validate(request.model_dump())
        if not automatic_memory_allowed(context.current_utterance):
            return BehaviorAnalysis(source_message_id=context.source_message_id, reason="privacy_restricted")
        # 여러 줄 인용의 내부 문장을 사용자 자신의 보고로 승격하지 않습니다.
        if any(mark in context.current_utterance for mark in ('"', "'", "“", "”", "‘", "’")):
            return BehaviorAnalysis(source_message_id=context.source_message_id, reason="no_explicit_behavior")

        observations = []
        # 각 문장의 모든 절이 해석 가능할 때만 반환합니다. 일부 단어만 주워 담지 않습니다.
        for sentence in re.finditer(r"[^.!?\n]+[.!?]*", context.current_utterance):
            raw = sentence.group()
            text = raw.rstrip(".!?").strip()
            cursor, matches = 0, []
            while cursor < len(text):
                match = _CLAUSE.match(text, cursor)
                if match is None:
                    matches = []
                    break
                status = next(key for key in _FORMS if match.group(key) is not None)
                matches.append((match, status))
                cursor = match.end()
                if cursor < len(text):
                    separator = _SEPARATOR.match(text, cursor)
                    if separator is None or separator.end() == len(text):
                        matches = []
                        break
                    cursor = separator.end()
            # 수행 여부 질문은 수행 사실이 아닙니다. 명시적 선택 후보 질문만 허용합니다.
            if "?" in raw and any(status != "candidate" for _, status in matches):
                continue
            # 기존 OpinionEvidence 길이 계약을 넘으면 원문을 잘라 다른 의미로 만들지 않습니다.
            if any(len(match.group()) > 500 for match, _ in matches):
                continue
            if len(observations) + len(matches) > 16:
                break
            for match, status in matches:
                quote = match.group()
                evidence = OpinionEvidence(
                    source_type="utterance", summary=quote,
                    evidence_ref=str(context.source_message_id) if context.source_message_id else "current_utterance",
                    observed_at=context.observed_at, interpretation=True,
                )
                observations.append(BehaviorObservation(action=match.group("action"), status=status, evidence=evidence))
        return BehaviorAnalysis(
            source_message_id=context.source_message_id, behaviors=observations,
            reason="recognized" if observations else "no_explicit_behavior",
        )

    def _run(self, request: SpecialistInput) -> AgentOpinion:
        """기존 Lv4 공통 의견으로 투영하되 실행/저장 후보는 생성하지 않습니다."""
        context = request if isinstance(request, BehaviorContext) else BehaviorContext(current_utterance=request.current_utterance)
        result = self.analyze(context)
        return AgentOpinion(
            agent_name=self.name, confidence=None,
            conclusion="명시적 행동 상태를 해석했습니다." if result.behaviors else "해석 가능한 명시적 행동이 없습니다.",
            evidence=[item.evidence for item in result.behaviors],
            result_status="OK" if result.behaviors else "NO_RECOMMENDATION",
        )
