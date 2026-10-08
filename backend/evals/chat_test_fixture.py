"""인증/백그라운드 계약 테스트용 공용 fixture입니다. Lv4 eval 파일에 의존하지 않습니다."""

import os
from contextlib import ExitStack, contextmanager
from unittest.mock import patch
from uuid import uuid4

import main
from chat_persistence_service import ChatPersistenceContext, ChatPersistenceStart


@contextmanager
def chat_fixture(*, enabled=True, cached=None, persisted=True):
    """실제 /chat 경로를 사용하고 외부 모델/DB 작업만 합성 결과로 고정합니다."""
    context = ChatPersistenceContext(user_id=uuid4(), conversation_id=uuid4(),
                                     request_id=uuid4(), user_message_id=uuid4())
    view = {"primary_axis": {"like": "Mid", "dislike": "Low"},
            "emotion_axis": {axis: "Low" for axis in "FADJCGTR"}, "state_summary": "기존 상태 요약"}
    analysis = {"input": "합성 입력", "user_view": view, "admin_view": {
        "primary_axis": {"like": .4, "dislike": .1},
        "emotion_axis": {axis: .1 for axis in "FADJCGTR"}}, "source": "rule_based"}
    with ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ, {
            "NOIE_LV4_SHADOW_ENABLED": "true" if enabled else "false",
            "NOIE_LV4_SHADOW_ALLOWLIST": str(context.user_id),
            "NOIE_LV4_SHADOW_REQUEST_ALLOWLIST": str(context.request_id),
        }))
        outputs = {"begin_chat_request": ChatPersistenceStart(context=context, cached_response=cached),
            "retrieve_relevant_memories_safe": [], "analyze_text": (analysis, "rule_based"),
            "generate_chat_reply_with_openai": "기존 production 답변", "prepare_chat_recommendation": (None, None),
            "complete_chat_request": persisted, "run_memory_extraction_background": None,
            "run_chat_agent_integration": None}
        mocks = {name: stack.enter_context(patch.object(main, name, return_value=value))
                 for name, value in outputs.items()}
        yield context, mocks
