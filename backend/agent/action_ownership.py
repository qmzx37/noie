"""저장된 Action의 직접/간접 소유권을 read와 cached 실행에서 함께 확인합니다."""

from sqlalchemy import and_, or_, select
from message_ownership import message_owner_condition
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.message import Message
from models.user import User


def owned_action_context():
    """NULL 근거는 기존대로 허용하되 연결된 근거는 같은 활성 사용자/대화여야 합니다."""
    active_user = select(User.id).where(
        User.id == AgentAction.user_id, User.deleted_at.is_(None),
    ).correlate(AgentAction).exists()
    conversation = select(Conversation.id).where(
        Conversation.id == AgentAction.conversation_id,
        Conversation.user_id == AgentAction.user_id,
        Conversation.deleted_at.is_(None),
    ).correlate(AgentAction).exists()
    message = select(Message.id).join(Conversation, Message.conversation_id == Conversation.id).where(
        Message.id == AgentAction.message_id,
        Conversation.user_id == AgentAction.user_id,
        Conversation.deleted_at.is_(None),
        message_owner_condition(AgentAction.user_id),
        or_(AgentAction.conversation_id.is_(None), Message.conversation_id == AgentAction.conversation_id),
    ).correlate(AgentAction).exists()
    return and_(active_user,
        or_(AgentAction.conversation_id.is_(None), conversation),
        or_(AgentAction.message_id.is_(None), message))
