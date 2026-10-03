"""추천을 실행하지 않는 소유자 제한 조회 API입니다."""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from agent.recommendation_schemas import RecommendationResponse
from agent.recommendation_service import RecommendationDatabaseError, RecommendationNotFoundError, get_recommendation, list_recommendations
from database import get_db

router = APIRouter(tags=["recommendations"])


@router.get("/recommendations/{event_id}", response_model=RecommendationResponse)
def get_recommendation_by_id(event_id: UUID, user_id: UUID = Query(), db: Session = Depends(get_db)):
    """다른 사용자의 추천은 존재 여부를 공개하지 않고 404로 처리합니다."""
    try:
        return get_recommendation(db, event_id, user_id)
    except RecommendationNotFoundError as error:
        raise HTTPException(404, "추천을 찾을 수 없습니다.") from error
    except RecommendationDatabaseError as error:
        raise HTTPException(500, "추천 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/recommendations", response_model=list[RecommendationResponse])
def get_user_recommendations(user_id: UUID, limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db)):
    """기본 50개, 최대 100개이며 accept/reject/outcome 기능은 없습니다."""
    try:
        return list_recommendations(db, user_id, limit)
    except RecommendationNotFoundError as error:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.") from error
    except RecommendationDatabaseError as error:
        raise HTTPException(500, "추천 목록 조회에 실패했습니다.") from error
