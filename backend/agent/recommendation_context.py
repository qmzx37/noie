"""짧은 읽기 transaction에서 최신 상태와 제한된 개인 맥락만 가져옵니다."""

from datetime import datetime, timedelta
import re
from uuid import UUID
from sqlalchemy import or_, select
from database import SessionLocal
from agent.body_state_schemas import BODY_AXES
from agent.cognitive_state_schemas import COGNITIVE_AXES
from agent.recommendation_schemas import RecommendationContext
from models.body_state_event import BodyStateEvent
from models.cognitive_state_event import CognitiveStateEvent
from models.emotion_event import EmotionEvent
from models.schedule import Schedule
from models.dream_goal import DreamGoal
from models.daily_life_event import DailyLifeEvent
from models.place_event import PlaceEvent
from models.conversation import Conversation
from models.user import User


# 관련성이 확인된 주제만 검색합니다. 미지원 주제는 개인 자료 없이 현재 질문만 사용합니다.
TOPIC_GROUPS = (
    ("개발", "코딩", "프로그래밍", "noie"), ("공부", "수업", "학습", "시험"),
    ("운동", "헬스", "산책"), ("카페",), ("집",), ("도서관",),
    ("친구", "약속", "만남"), ("게임", "fm26"),
    ("휴식", "쉬기", "쉬고", "쉬어", "쉴", "피곤", "피로", "수면", "졸림"),
)
# 집은 독립된 장소 표현일 때만 인정합니다. 맛집/집중은 집 context가 아닙니다.
HOME_PATTERN = r"(?<![가-힣A-Za-z0-9])집(?:에서|에|으로|이|은|을|\b)"


def recommendation_needed(text: str) -> bool:
    """추천 후보가 있어도 단순 보고/확정 의사는 개인 context 조회를 허용하지 않습니다."""
    compact = re.sub(r"\s+", "", text.lower())
    # 추천 거부 및 문장 뒤에서 확정한 결정을 앞의 고민 표현보다 우선합니다.
    if any(word in compact for word in ("추천하지마", "추천해주지마", "추천필요없", "추천은필요없", "추천말고")):
        return False
    questions = ("할까", "갈까", "쉴까", "나을까", "좋을까", "추천해", "추천부탁", "뭐부터", "무엇부터", "뭘할", "어떻게할", "어디갈", "선택해", "골라줘")
    decisions = ("할래", "갈래", "쉴래", "할게", "갈게", "쉴게", "잘거야", "기로했", "결정했")
    question_at = max((compact.rfind(word) for word in questions), default=-1)
    decision_at = max((compact.rfind(word) for word in decisions), default=-1)
    if decision_at > question_at:
        return False
    if question_at >= 0:
        return True
    # 명시적 질문 없는 미해결 선택 갈등도 기존 Orchestrator 후보가 있을 때만 허용합니다.
    return any(word in compact for word in ("모르겠", "고민", "둘다", "인데", "한데", "했는데", "못자", "약속인데")) or (
        "는데" in compact and any(word in compact for word in ("안했", "못했", "고싶"))
    )


def question_topics(text: str) -> tuple[str, ...]:
    """현재 질문에 나온 주제와 직접 동의어만 사용하며 Memory에서 주제를 확장하지 않습니다."""
    lowered = text.lower()
    # '집중'을 '집'으로 해석하지 않습니다. 장소는 서로 동의어로 확장하지 않습니다.
    return tuple(dict.fromkeys(word for group in TOPIC_GROUPS
                              if any((re.search(HOME_PATTERN, lowered) if word == "집" else word in lowered) for word in group)
                              for word in group))


def related_memories(memories, question: str):
    """기존 Retrieval 결과 중 질문 주제에 맞는 최소 내용만 추천 전용 호출에 전달합니다."""
    topics = question_topics(question)
    return [item.model_copy(update={"content": item.content[:600]}) for item in memories
            if topics and any((re.search(HOME_PATTERN, item.content.lower()) if topic == "집" else topic in item.content.lower()) for topic in topics)][:4]


def load_recommendation_context(user_id: UUID, as_of: datetime, question: str = "") -> RecommendationContext:
    """현재 이후/삭제된 대화의 기록은 제외하고 반환 전에 DB 세션을 닫습니다."""
    if SessionLocal is None or as_of.utcoffset() is None:
        raise RuntimeError("recommendation_context_unavailable")
    result = RecommendationContext(as_of=as_of)
    if not recommendation_needed(question):
        return result
    topics = question_topics(question)
    # 상태는 활동/회복/우선순위 선택에만 필요합니다. 장소/음식 등 단독 선택에는 읽지 않습니다.
    activity = any(word in question.lower() for word in ("개발", "코딩", "공부", "운동", "쉬", "피곤", "잠", "졸", "집중", "뭐부터", "무엇부터", "뭘 할", "할 일"))
    location_choice = any(word in question for word in ("카페", "도서관", "어디", "장소")) or bool(re.search(HOME_PATTERN, question))
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise LookupError("active_user_not_found")
        def owned(model):
            """NULL 대화 또는 활성 소유 대화만 context에 포함합니다."""
            return select(model).outerjoin(Conversation, model.conversation_id == Conversation.id).where(
                model.user_id == user_id,
                or_(model.conversation_id.is_(None), (Conversation.deleted_at.is_(None) & (Conversation.user_id == user_id))),
                model.created_at <= as_of,
            )
        def snapshot(row, fields):
            """생성 시각과 필요한 해석 필드만 남기고 내부 ID는 제외합니다."""
            # 내부 ID/원문 Message는 OpenAI가 추천하는 데 필요하지 않아 보내지 않습니다.
            # 직접 DB에 들어온 긴 해석도 기존 입력 계약의 최대 길이만 전송합니다. DB 원문은 바꾸지 않습니다.
            values = {field: getattr(row, field) for field in fields}
            for field, limit in (("statement", 300), ("summary", 200)):
                if isinstance(values.get(field), str):
                    values[field] = values[field][:limit]
            return {"created_at": row.created_at.isoformat(), **values}
        def related(column):
            """매개변수화된 SQL 조건으로 관련 자료를 먼저 제한하고 그 뒤 개수 제한을 적용합니다."""
            # PostgreSQL 정규식도 매개변수로 전달하여 집/집중/맛집을 구분합니다.
            return or_(*(column.op("~*")(r"(^|[^가-힣A-Za-z0-9])집(에서|에|으로|이|은|을|$|[^가-힣A-Za-z0-9])")
                         if topic == "집" else column.icontains(topic, autoescape=True) for topic in topics)) if topics else False
        cutoff = as_of - timedelta(minutes=result.state_window_minutes)
        for name, model, axes in (
            ("emotion", EmotionEvent, ("f", "a", "d", "j", "c", "g", "t", "r")),
            ("body", BodyStateEvent, BODY_AXES), ("cognitive", CognitiveStateEvent, COGNITIVE_AXES),
        ):
            if not activity:
                continue
            row = db.scalar(owned(model).where(model.created_at >= cutoff).order_by(model.created_at.desc(), model.id.desc()).limit(1))
            if row is not None:
                result.recent_states[name] = snapshot(row, (*axes, "confidence"))
        # 준비/이동 시간이 없는 경우 임의로 채우지 않습니다. 가까운 확정 일정만 전달합니다.
        # 지금의 선택에는 임박한 2시간만, 오늘/내일 계획 질문에는 기존 상한 24시간까지 사용합니다.
        horizon_hours = 24 if "지금" not in question and any(word in question for word in ("오늘", "내일", "하루")) else 2
        schedules = db.scalars(owned(Schedule).where(
            activity,
            Schedule.start_at <= as_of + timedelta(hours=horizon_hours),
            or_(Schedule.start_at >= as_of, Schedule.end_at >= as_of),
        ).order_by(Schedule.start_at, Schedule.id).limit(3)).all()
        result.schedules = [{**snapshot(row, ("title",)), "start_at": row.start_at.isoformat(),
                             "end_at": row.end_at.isoformat() if row.end_at else None} for row in schedules]
        goals = db.scalars(owned(DreamGoal).where(related(DreamGoal.statement)).order_by(DreamGoal.created_at.desc(), DreamGoal.id.desc()).limit(3)).all()
        result.dream_goals = [snapshot(row, ("statement", "kind")) for row in goals]
        daily = db.scalars(owned(DailyLifeEvent).where(related(DailyLifeEvent.summary), DailyLifeEvent.created_at >= as_of - timedelta(hours=24))
                           .order_by(DailyLifeEvent.created_at.desc(), DailyLifeEvent.id.desc()).limit(3)).all()
        result.daily_life = [snapshot(row, ("summary", "category")) for row in daily]
        location = db.scalar(owned(PlaceEvent).where(location_choice, related(PlaceEvent.place_name), PlaceEvent.kind == "context", PlaceEvent.created_at >= cutoff)
                             .order_by(PlaceEvent.created_at.desc(), PlaceEvent.id.desc()).limit(1))
        preferences = db.scalars(owned(PlaceEvent).where(location_choice, related(PlaceEvent.place_name), PlaceEvent.kind == "preference")
                                 .order_by(PlaceEvent.created_at.desc(), PlaceEvent.id.desc()).limit(3)).all()
        result.places = [snapshot(row, ("place_name", "kind", "preference")) for row in ([location] if location else []) + list(preferences)]
    return result
