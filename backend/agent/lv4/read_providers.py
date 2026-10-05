"""기존 domain 목록 read를 재사용하는 명시적 provider factory입니다. 자동 연결은 없습니다."""

from datetime import timedelta

from sqlalchemy import or_, text

from agent.body_state_event_service import list_body_state_events
from agent.cognitive_state_event_service import list_cognitive_state_events
from agent.emotion_event_service import list_emotion_events
from agent.place_event_service import list_place_events
from agent.relationship_event_service import list_relationship_events
from agent.schedule_service import _visible_schedules
from models.schedule import Schedule
from chat_storage_service import StorageNotFoundError, _get_active_conversation
from .context_bridge import ContextProviders
from .state_specialist import AXES


def make_read_providers(*, session_factory, memory_provider=None) -> ContextProviders:
    """세션과 엄격한 retrieval callback을 주입합니다. safe retrieval의 빈 fallback은 사용하지 않습니다."""
    if not callable(session_factory):
        raise TypeError("명시적 session_factory가 필요합니다.")

    def nearby_schedules(db, user_id, limit, reference_time):
        """기존 활성 데이터 조회식을 재사용하고 오래된 일정이 후보 한도를 차지하지 않게 합니다."""
        statement = _visible_schedules(user_id).where(
            Schedule.start_at <= reference_time + timedelta(hours=24),
            or_(Schedule.start_at >= reference_time, Schedule.end_at >= reference_time),
        ).order_by(Schedule.start_at, Schedule.id).limit(limit)
        return list(db.scalars(statement).all())

    def provider(service, fields, *, schedule=False):
        """목록 조회·활성 대화 검증은 기존 서비스를 사용하고 반환 전에 세션을 닫습니다."""
        def read(user_id, question, reference_time):
            """단일 source의 최대 25개 후보만 읽습니다. commit/flush/외부 호출은 없습니다."""
            with session_factory() as db:
                # PostgreSQL 서버에서도 이번 adapter의 transaction 쓰기를 차단합니다.
                db.execute(text("SET TRANSACTION READ ONLY"))
                rows = service(db, user_id, 25, reference_time) if schedule else service(db, user_id, 25)
                result, conversations = [], {}
                for row in rows:
                    if row.user_id != user_id:
                        raise PermissionError("provider ownership mismatch")
                    if row.created_at > reference_time:
                        continue
                    if row.conversation_id is not None:
                        if row.conversation_id not in conversations:
                            try:
                                conversations[row.conversation_id] = _get_active_conversation(db, row.conversation_id).user_id == user_id
                            except StorageNotFoundError:
                                conversations[row.conversation_id] = False
                        if not conversations[row.conversation_id]:
                            continue
                    # 원문/PK/metadata/GPS를 복사하지 않으며 실제 record의 필드만 투영합니다.
                    result.append({"created_at": row.created_at, **{target: getattr(row, original) for target, original in fields.items()}})
                return result
        return read

    states = {name: provider(service, {**{axis: axis.lower() if name == "emotion" else axis for axis in AXES[name]}, "confidence": "confidence"}) for name, service in (
        ("emotion", list_emotion_events), ("body", list_body_state_events), ("cognitive", list_cognitive_state_events))}
    return ContextProviders(memory=memory_provider, **states,
        schedule=provider(nearby_schedules, {"title": "title", "start_at": "start_at", "end_at": "end_at"}, schedule=True),
        relationship=provider(list_relationship_events, {"person_label": "person_label", "relationship_statement": "relationship_statement", "record_kind": "record_kind", "temporal_scope": "temporal_scope", "confidence": "confidence"}),
        place=provider(list_place_events, {"place_name": "place_name", "kind": "kind", "preference": "preference", "occurred_at": "occurred_at"}))
