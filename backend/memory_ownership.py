"""Memory 근거의 간접 소유권을 읽기/모델 전송에서도 검증하는 SQL 조건입니다."""

from sqlalchemy import and_, or_, select
from models.conversation import Conversation
from models.memory import Memory, MemoryEvidence
from models.message import Message
from models.user import User


def owned_memory_evidence():
    """타인/삭제된 대화/비활성 계정의 근거가 하나라도 있으면 원문을 보존하고 제외합니다."""
    invalid = select(MemoryEvidence.id).outerjoin(Message, Message.id == MemoryEvidence.message_id).outerjoin(
        Conversation, Conversation.id == Message.conversation_id,
    ).outerjoin(User, User.id == Conversation.user_id).where(
        MemoryEvidence.memory_id == Memory.id, or_(
            Message.id.is_(None), Conversation.id.is_(None), User.id.is_(None),
            User.deleted_at.is_not(None),
            Conversation.user_id != Memory.user_id, Conversation.deleted_at.is_not(None),
            and_(Message.role == "user", or_(Message.user_id.is_(None), Message.user_id != Memory.user_id)),
            and_(Message.user_id.is_not(None), Message.user_id != Memory.user_id),
        ),
    ).correlate(Memory).exists()
    return ~invalid
