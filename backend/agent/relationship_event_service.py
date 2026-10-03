"""Relationship 소유권 조회와 실제 Message 원문 근거를 검증합니다."""

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from agent.relationship_schemas import RecordRelationshipArguments
from models.relationship_event import RelationshipEvent
from models.user import User


class RelationshipNotFoundError(Exception):
    """없는 기록과 다른 소유자의 기록을 동일하게 처리합니다."""


class RelationshipDatabaseError(Exception):
    """내부 DB 정보가 응답에 노출되지 않도록 경계를 둡니다."""


def validate_relationship_evidence(arguments: RecordRelationshipArguments, content: str) -> None:
    """원문 없는 이름/구간을 차단하며 명백한 질문·가정·부정을 사실화하지 않습니다."""
    for record in arguments.records:
        statement = record.relationship_statement
        if statement not in content or record.person_label not in content:
            raise ValueError("relationship_evidence_not_in_message")
        # 명백한 미래 희망/계획은 아직 관찰된 사건이나 현재 관계 상태가 아닙니다.
        # 과거에 희망을 말했던 실제 사건은 말했어/이야기했어로 끝나므로 이 검사와 구분됩니다.
        if record.record_kind in ("observation", "relationship_state") and re.search(
            r"(?:내일|모레|다음\s*(?:주|달|월|해)).*(?:싶(?:어|다|어요)|(?:할|갈|먹을|만날)\s*거(?:야|예요)|예정이야|계획이야)[.!]?\s*$",
            statement,
        ):
            raise ValueError("relationship_future_as_observed_state")
        if record.record_kind == "social_relation":
            # 의미 전체 판단은 현재 발화 전용 LLM이 하며 이 검사는 보수적 방어선입니다.
            # 질문/부정 뒤를 잘라낸 substring도 원래 문장의 경계를 확인해 차단합니다.
            start = content.find(statement)
            left = max(content.rfind(mark, 0, start) for mark in (".", "!", "?", "\n", "？")) + 1
            ends = [content.find(mark, start + len(statement)) for mark in (".", "!", "?", "\n", "？")]
            right = min((end + 1 for end in ends if end >= 0), default=len(content))
            source_sentence = content[left:right]
            if re.search(r"[?？]|였으면|라면|이라면|아니|않|아닌|농담|가정|라고\s*(?:해보|가정)", source_sentence):
                raise ValueError("relationship_nonpositive_social_statement")
            # 이름만 일치해도 제3자 관계는 사용자 관계가 아닙니다. 명시적 '내/제' 소유는 구분합니다.
            own_relation = re.search(r"(?:내|나의|제|저의|우리)\s*(?:친구|동료|가족|연인|지인)", source_sentence)
            if not own_relation and (re.search(r"(?:와|과)\s*(?!나는|저는|나\s|저\s|우리)[^\s]+(?:는|은)\s*(?:친구|동료|가족|연인|지인)", source_sentence)
                                     or re.search(r"(?<!나)(?<!저)[^\s]+의\s*(?:친구|동료|가족|연인|지인)", source_sentence)):
                raise ValueError("relationship_third_party_social_statement")
            # 빈도/싸움/감정만으로 사회관계 type을 붙인 수동 계획도 거부합니다.
            explicit_types = {
                "friend": r"친구", "colleague": r"동료|같은\s*(?:회사|직장)", "acquaintance": r"지인|아는\s*사이",
                "partner": r"애인|연인|남자친구|여자친구", "family": r"가족|엄마|아빠|부모|형제|자매|누나|언니|동생|남편|아내|배우자|아들|딸|형",
                "other": r"스승|선생|멘토|파트너|상사|후배|선배|제자",
            }
            if not re.search(explicit_types[record.relationship_type], statement):
                raise ValueError("relationship_social_type_without_explicit_evidence")
        if record.temporal_scope == "current" and re.search(r"예전에|과거에|옛날에", statement):
            raise ValueError("relationship_past_as_current")


def get_relationship_event(db: Session, event_id: UUID, user_id: UUID) -> RelationshipEvent:
    """상세 읽기에도 활성 소유자 조건을 적용합니다. user_id는 인증이 아닙니다."""
    try:
        item = db.scalar(select(RelationshipEvent).join(User).where(
            RelationshipEvent.id == event_id, RelationshipEvent.user_id == user_id, User.deleted_at.is_(None),
        ))
        if item is None:
            raise RelationshipNotFoundError
        return item
    except SQLAlchemyError as error:
        raise RelationshipDatabaseError from error


def list_relationship_events(db: Session, user_id: UUID, limit: int) -> list[RelationshipEvent]:
    """현재 관계 정답이 아니라 생성 시각/UUID 역순의 보존된 근거를 조회합니다."""
    try:
        if db.scalar(select(User.id).where(User.id == user_id, User.deleted_at.is_(None))) is None:
            raise RelationshipNotFoundError
        return list(db.scalars(select(RelationshipEvent).where(RelationshipEvent.user_id == user_id)
                    .order_by(RelationshipEvent.created_at.desc(), RelationshipEvent.id.desc()).limit(limit)).all())
    except SQLAlchemyError as error:
        raise RelationshipDatabaseError from error
