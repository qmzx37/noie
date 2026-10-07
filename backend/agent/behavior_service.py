"""활성 소유자의 user Message 하나만 읽어 Behavior를 해석합니다. DB 쓰기는 없습니다."""

from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth_context import AuthPrincipal
from message_ownership import message_owner_condition
from models.conversation import Conversation
from models.message import Message
from models.user import User
from agent.behavior_schemas import BehaviorAnalysis, BehaviorContext
from agent.behavior_specialist import BehaviorSpecialist


def analyze_owned_behavior(
    db: Session, message_id: UUID, principal: AuthPrincipal, *, expected_text: str | None = None,
) -> BehaviorAnalysis:
    """검증된 principal만 사용하며 다른 계정/삭제된 데이터는 동일하게 404 처리합니다."""
    if principal is None:
        raise HTTPException(401, "인증이 필요합니다.")
    try:
        # read-only 조회가 세션의 대기 중 변경까지 flush하지 않도록 합니다.
        with db.no_autoflush:
            message = db.scalar(
                select(Message).join(Conversation, Message.conversation_id == Conversation.id)
                .join(User, Conversation.user_id == User.id)
                .where(
                    Message.id == message_id, Message.role == "user",
                    message_owner_condition(Conversation.user_id),
                    Conversation.user_id == principal.user_id,
                    User.deleted_at.is_(None), Conversation.deleted_at.is_(None),
                )
            )
    except SQLAlchemyError as error:
        db.rollback()
        raise HTTPException(503, "행동 근거를 조회할 수 없습니다.") from error
    if message is None:
        raise HTTPException(404, "메시지를 찾을 수 없습니다.")
    # Lv4는 현재 요청과 동일한 원문만 사용합니다. 다른 요청의 근거를 섞지 않습니다.
    if expected_text is not None and message.content.strip() != expected_text:
        raise HTTPException(404, "메시지를 찾을 수 없습니다.")
    # PostgreSQL의 aware 생성 시점만 재사용합니다. 시점이 없으면 현재 시각을 발명하지 않습니다.
    observed_at = message.created_at
    if observed_at is not None and observed_at.utcoffset() is None:
        observed_at = None
    try:
        context = BehaviorContext(
            current_utterance=message.content, source_message_id=message.id, observed_at=observed_at,
        )
    except ValidationError as error:
        # 검증 오류의 input 필드에 원문이 포함될 수 있으므로 그대로 사용자에게 노출하지 않습니다.
        raise HTTPException(422, "분석 가능한 메시지 길이와 형식을 확인해 주세요.") from error
    return BehaviorSpecialist().analyze(context)
