"""현재 소유자 Message의 Behavior 결과만 State에 투영하는 선택적 read adapter입니다."""

import json
import re
from uuid import UUID

from pydantic import TypeAdapter

from auth_context import AuthPrincipal
from database import SessionLocal
from memory_privacy import automatic_memory_allowed
from agent.behavior_schemas import BehaviorAnalysis, BehaviorObservation, BehaviorStatus
from agent.behavior_service import analyze_owned_behavior
from agent.recommendation_context import recommendation_needed
from .schemas import OpinionEvidence, Score, ShortText


MAX_BEHAVIOR_CONTEXT = 4
_UUID_TEXT = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def related_behavior(action: str, question: str) -> bool:
    """명시적 선택 질문의 행동만 참고합니다. 일반 다음 행동 질문은 현재 발화 관찰을 허용합니다."""
    clauses = [part for part in re.split(r"[.!?\n]", question) if recommendation_needed(part)]
    scope = " ".join(clauses) if clauses else question
    compact = re.sub(r"\s+", "", scope).casefold()
    return (re.sub(r"\s+", "", action).casefold() in compact
            or any(word in compact for word in ("뭐부터", "뭐할까", "뭘할까", "뭘해야")))


def project_behavior(
    analysis: BehaviorAnalysis | None, *, message_id: UUID, current_utterance: str,
) -> list[BehaviorObservation]:
    """결과를 재검증하며 status/confidence/원문 provenance를 재해석하지 않습니다."""
    if analysis is None or not isinstance(message_id, UUID) or not automatic_memory_allowed(current_utterance):
        return []
    checked = BehaviorAnalysis.model_validate(analysis.model_dump())
    if checked.reason != "recognized" or checked.source_message_id != message_id:
        return []
    for item in checked.behaviors:
        evidence = item.evidence
        if (evidence.source_type != "utterance" or evidence.evidence_ref != str(message_id)
                or not evidence.interpretation or evidence.summary not in current_utterance):
            return []
    # 현재 질문과 관련된 최대 4개입니다. Memory Top-K 설정과는 별개이며 history는 읽지 않습니다.
    return [item for item in checked.behaviors if not _UUID_TEXT.search(item.action)
            and related_behavior(item.action, current_utterance)][:MAX_BEHAVIOR_CONTEXT]


def read_behavior(*, user_id: UUID, message_id: UUID, current_utterance: str) -> list[BehaviorObservation]:
    """세션을 닫은 뒤 반환합니다. optional 조회 실패는 로그/쓰기 없이 context 없음으로 처리합니다."""
    if SessionLocal is None or not isinstance(user_id, UUID) or not isinstance(message_id, UUID):
        return []
    try:
        with SessionLocal() as db:
            analysis = analyze_owned_behavior(db, message_id, AuthPrincipal(user_id), expected_text=current_utterance)
        return project_behavior(analysis, message_id=message_id, current_utterance=current_utterance)
    except Exception:
        # 인증을 대신하지 않습니다. production의 기존 활성 계정/모델 권한 재검사는 유지됩니다.
        return []


def behavior_fields(item: OpinionEvidence) -> dict | None:
    """State의 최소 의미 투영만 해독합니다. 원문/ID/임의 metadata는 외부 payload에 넣지 않습니다."""
    if (item.source_type != "state" or not re.fullmatch(r"behavior_[0-3]", item.evidence_ref or "")
            or not item.summary.startswith("behavior: ")):
        return None
    try:
        data = json.loads(item.summary.removeprefix("behavior: "))
        if not isinstance(data, dict) or set(data) - {"action", "status", "confidence"}:
            return None
        action = TypeAdapter(ShortText).validate_python(data["action"])
        status = TypeAdapter(BehaviorStatus).validate_python(data["status"])
        if _UUID_TEXT.search(action) or not automatic_memory_allowed(action):
            return None
        result = {"action": action, "status": status}
        if data.get("confidence") is not None:
            result["confidence"] = TypeAdapter(Score).validate_python(data["confidence"])
        if item.observed_at is not None:
            result["observed_at"] = item.observed_at.isoformat()
        return result
    except (ValueError, TypeError, KeyError):
        return None


def behavior_provenance_allowed(item: OpinionEvidence, evidence: list[OpinionEvidence]) -> bool:
    """State 경계에서만 paired Behavior 원문 근거를 허용합니다. 다른 domain 근거는 허용하지 않습니다."""
    if item.source_type != "utterance" or not item.interpretation:
        return False
    try:
        if str(UUID(item.evidence_ref or "")) != item.evidence_ref:
            return False
    except ValueError:
        return False
    index = evidence.index(item)
    if index + 1 >= len(evidence):
        return False
    paired = evidence[index + 1]
    # stale/future도 provenance는 남지만 추천 선택에서는 제외합니다.
    checked = paired.model_copy(update={"summary": paired.summary.removesuffix("; 현재 상태 종합에서 제외")})
    fields = behavior_fields(checked)
    return (fields is not None and paired.observed_at == item.observed_at
            and re.sub(r"\s+", "", fields["action"]) in re.sub(r"\s+", "", item.summary))
