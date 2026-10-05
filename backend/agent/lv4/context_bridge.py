"""읽기 결과를 최소 Lv4 context로 바꾸는 adapter입니다. 판단/DB 쓰기는 하지 않습니다."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import islice
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, TypeAdapter

from agent.recommendation_context import recommendation_needed, related_memories
from .collaboration_context import Lv4CollaborationContext
from .critic_context import CriticConstraints
from .place_context import PlaceContext, place_question
from .recommendation_context import MemoryContext, RecommendationContext, RelationshipContext, ScheduleContext
from .recommendation_specialist import prepare_evidence
from .schemas import ContractModel, ShortText
from .state_context import BodyState, CognitiveState, EmotionState, StateContext

SOURCES = ("memory", "emotion", "body", "cognitive", "schedule", "relationship", "place")
Provider = Callable[[UUID, str, datetime], list]


@dataclass(frozen=True)
class ContextProviders:
    """같은 소유자/질문으로 조회한 결과를 반환하는 주입 경계입니다. 생성 시 호출하지 않습니다."""

    memory: Provider | None = None
    emotion: Provider | None = None
    body: Provider | None = None
    cognitive: Provider | None = None
    schedule: Provider | None = None
    relationship: Provider | None = None
    place: Provider | None = None


class ProviderDiagnostic(ContractModel):
    """빈 결과/제외/미설정/실패를 구분하고 내부 예외와 ID를 노출하지 않습니다."""

    source: Literal["memory", "emotion", "body", "cognitive", "schedule", "relationship", "place"]
    status: Literal["loaded", "empty", "filtered", "failed", "not_configured", "skipped"]
    count: int = Field(ge=0, le=4)


class ContextBridgeResult(ContractModel):
    """provider 장애는 partial로 추적하고 context만 기존 pipeline에 전달할 수 있습니다."""

    context: Lv4CollaborationContext
    diagnostics: list[ProviderDiagnostic] = Field(min_length=7, max_length=7)
    bridge_status: Literal["COMPLETE", "PARTIAL"]


class Lv4ContextBridge:
    """필요한 필드만 투영하는 read-only adapter입니다. provider는 명시적으로 주입합니다."""

    def __init__(self, providers: ContextProviders) -> None:
        """외부 연결/Agent/전역 registry를 생성하지 않습니다."""
        if not isinstance(providers, ContextProviders):
            raise TypeError("ContextProviders가 필요합니다.")
        if any(value is not None and not callable(value) for value in vars(providers).values()):
            raise TypeError("provider는 callable 또는 None이어야 합니다.")
        self._providers = providers

    def build(self, *, user_id: UUID, current_utterance: str, reference_time: datetime) -> ContextBridgeResult:
        """원문을 수정하지 않고 실패한 source만 unknown으로 남기며 진단을 반환합니다."""
        user_id = TypeAdapter(UUID).validate_python(user_id)
        question = TypeAdapter(ShortText).validate_python(current_utterance)
        now = TypeAdapter(AwareDatetime).validate_python(reference_time)
        values, diagnostics = {}, []
        for source in SOURCES:
            provider = getattr(self._providers, source)
            if not recommendation_needed(question) or (source == "place" and not place_question(question)):
                status, selected = "skipped", []
            elif provider is None:
                status, selected = "not_configured", []
            else:
                try:
                    # 상위 provider도 bounded read를 수행합니다. 전체 이력을 받지 않습니다.
                    raw = list(islice(provider(user_id, question, now), 25))
                    rows = []
                    for item in raw:
                        data = item.model_dump() if hasattr(item, "model_dump") else item
                        if not isinstance(data, Mapping):
                            raise TypeError("provider는 read 응답 또는 최소 dict를 반환해야 합니다.")
                        if data.get("user_id") is not None and UUID(str(data["user_id"])) != user_id:
                            raise PermissionError("ownership mismatch")
                        rows.append(data)
                    selected = self._project(source, rows, question, now)
                    status = "loaded" if selected else "filtered" if raw else "empty"
                except Exception:
                    # 오류를 '기록 없음'으로 표시하지 않고 내부 오류 문자열도 노출하지 않습니다.
                    status, selected = "failed", []
            values[source] = selected
            diagnostics.append(ProviderDiagnostic(source=source, status=status, count=len(selected)))
        state = StateContext(as_of=now, max_age_seconds=7200, **{name: values[name][0] if values[name] else None for name in ("emotion", "body", "cognitive")})
        context = Lv4CollaborationContext(current_utterance=question, reference_time=now, state_context=state,
            relevant_constraints=CriticConstraints(memories=values["memory"], schedules=values["schedule"], relationships=values["relationship"]), places=values["place"])
        return ContextBridgeResult(context=context, diagnostics=diagnostics, bridge_status="PARTIAL" if any(item.status in {"failed", "not_configured"} for item in diagnostics) else "COMPLETE")

    @staticmethod
    def _project(source: str, rows: list[Mapping], question: str, now: datetime) -> list:
        """기존 schema/관련성 helper를 재사용하고 ID/metadata는 허용 필드에 포함하지 않습니다."""
        if source in {"emotion", "body", "cognitive"}:
            model = {"emotion": EmotionState, "body": BodyState, "cognitive": CognitiveState}[source]
            observations = []
            for row in rows:
                when = row.get("observed_at", row.get("created_at"))
                when = TypeAdapter(AwareDatetime).validate_python(when) if when is not None else None
                if when is not None and not now-timedelta(minutes=120) <= when <= now:
                    continue
                data = {name: row[name] for name in model.model_fields if name in row and name != "observed_at"}
                observations.append(model(**data, observed_at=when))
            return sorted(observations, key=lambda item: item.observed_at or datetime.min.replace(tzinfo=now.tzinfo), reverse=True)[:1]
        if source == "memory":
            memories = [MemoryContext(content=row["content"][:500], relevance=row["relevance"], confidence=row.get("confidence"), observed_at=row.get("observed_at")) for row in rows]
            valid = [item for item in memories if item.relevance >= 0.55 and (item.observed_at is None or item.observed_at <= now)]
            return related_memories(valid, question)[:4]
        if source == "place":
            places = [PlaceContext(**{key: row[key] for key in PlaceContext.model_fields if key in row and key != "relevance"}, relevance=row.get("relevance", 1.0)) for row in rows]
            # 개수 제한 전에 기존 필터를 적용하여 관련 후보가 앞선 무관 후보에 밀리지 않게 합니다.
            return [item for item in places if any(e.source_type == "place" for e in prepare_evidence(RecommendationContext(current_utterance=question, reference_time=now, places=[item])))][:3]
        if source == "schedule":
            items = [ScheduleContext(title=row["title"][:500], start_at=row["start_at"], end_at=row.get("end_at"), relevance=row.get("relevance", 1.0)) for row in rows]
            items.sort(key=lambda item: item.start_at)
            return [item for item in items if any(e.source_type == "schedule" for e in prepare_evidence(RecommendationContext(current_utterance=question, reference_time=now, schedules=[item])))][:3]
        items = [RelationshipContext(person_label=row["person_label"], summary=row.get("summary", row.get("relationship_statement")), record_kind=row["record_kind"], temporal_scope=row["temporal_scope"], confidence=row.get("confidence"), relevance=row.get("relevance", 1.0), observed_at=row.get("observed_at", row.get("created_at"))) for row in rows]
        return [item for item in items if any(e.source_type == "relationship" for e in prepare_evidence(RecommendationContext(current_utterance=question, reference_time=now, relationships=[item])))][:3]
