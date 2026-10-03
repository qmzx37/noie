"""Orchestrator 판단을 수동 검증하기 위한 읽기 전용 API입니다."""

from fastapi import APIRouter, HTTPException, status

from agent.orchestrator import orchestrate_with_openai
from agent.action_router import router as action_router
from agent.emotion_event_router import router as emotion_event_router
from agent.daily_life_event_router import router as daily_life_event_router
from agent.dream_goal_event_router import router as dream_goal_event_router
from agent.schedule_router import router as schedule_router
from agent.place_event_router import router as place_event_router
from agent.body_state_event_router import router as body_state_event_router
# 소유자 제한 인지 읽기 API를 기존 라우터에 추가합니다.
from agent.cognitive_state_event_router import router as cognitive_state_event_router
from agent.recommendation_router import router as recommendation_router
from agent.schemas import OrchestratorRequest, OrchestratorResult
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import ToolPlanRequest, ToolPlanResponse


router = APIRouter(tags=["agent"])
router.include_router(action_router)
router.include_router(emotion_event_router)
router.include_router(daily_life_event_router)
router.include_router(dream_goal_event_router)
router.include_router(schedule_router)
router.include_router(place_event_router)
router.include_router(body_state_event_router)
router.include_router(cognitive_state_event_router)
router.include_router(recommendation_router)


@router.post("/orchestrate", response_model=OrchestratorResult)
def post_orchestrate(request: OrchestratorRequest) -> OrchestratorResult:
    """DB나 Tool을 변경하지 않고 routing 판단만 반환합니다."""

    try:
        return orchestrate_with_openai(request.text, request.relevant_memories)
    except Exception as error:
        print(f"[noie] orchestrator failed: {type(error).__name__}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Orchestrator 판단을 완료하지 못했습니다.",
        ) from error


@router.post("/agent/tool-plan", response_model=ToolPlanResponse)
def post_tool_plan(request: ToolPlanRequest) -> ToolPlanResponse:
    """정책을 검증한 dry-run 계획만 만들고 Tool이나 DB는 실행하지 않습니다."""

    return create_tool_plan(request)
