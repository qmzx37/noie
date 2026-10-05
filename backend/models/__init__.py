"""Alembic과 애플리케이션이 모든 DB 모델을 한 번에 불러오는 모듈입니다."""

from models.agent_action import AgentAction
from models.auth_identity import AuthIdentity
from models.chat_request import ChatRequestRecord
from models.conversation import Conversation
from models.daily_life_event import DailyLifeEvent
from models.dream_goal import DreamGoal
from models.emotion_event import EmotionEvent
from models.memory import Memory, MemoryEvidence
from models.memory_extraction import MemoryExtraction
from models.message import Message
from models.user import User
from models.schedule import Schedule
from models.place_event import PlaceEvent
from models.body_state_event import BodyStateEvent
# Alembic도 새 인지 모델을 동일한 metadata에서 확인합니다.
from models.cognitive_state_event import CognitiveStateEvent
from models.recommendation import Recommendation
from models.relationship_event import RelationshipEvent

__all__ = [
    "AgentAction",
    "AuthIdentity",
    "ChatRequestRecord",
    "Conversation",
    "DailyLifeEvent",
    "DreamGoal",
    "EmotionEvent",
    "Memory",
    "MemoryEvidence",
    "MemoryExtraction",
    "Message",
    "User",
    "Schedule",
    "PlaceEvent",
    "BodyStateEvent",
    "CognitiveStateEvent",
    "Recommendation",
    "RelationshipEvent",
]
