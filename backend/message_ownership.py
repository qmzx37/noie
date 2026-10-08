"""원문을 반환/전송할 때 Message와 Conversation 소유권의 일관성을 확인합니다."""

from sqlalchemy import and_, or_
from models.message import Message


def message_owner_condition(user_id):
    """SQL 조회에서도 user 작성자는 일치하고 assistant/system의 NULL은 허용합니다."""
    return or_(
        and_(Message.role == "user", Message.user_id == user_id),
        and_(Message.role.in_(("assistant", "system")),
             or_(Message.user_id.is_(None), Message.user_id == user_id)),
    )


def message_has_owner(message, user_id) -> bool:
    """user 원문은 같은 UUID여야 하며 assistant/system의 NULL 작성자는 허용합니다."""
    if message is None or user_id is None:
        return False
    if message.role == "user":
        return message.user_id == user_id
    if message.role in {"assistant", "system"}:
        return message.user_id is None or message.user_id == user_id
    return False
