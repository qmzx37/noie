"""저장된 사람/관계 근거만 조회하며 update/delete/current resolver를 제공하지 않습니다."""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from agent.relationship_schemas import RelationshipEventResponse
from agent.relationship_event_service import RelationshipDatabaseError, RelationshipNotFoundError, get_relationship_event, list_relationship_events
from database import get_db

router = APIRouter(tags=["relationship-evidence"])


@router.get("/relationship-events/{event_id}", response_model=RelationshipEventResponse)
def get_relationship_by_id(event_id: UUID, user_id: UUID = Query(), db: Session = Depends(get_db)):
    """다른 사용자와 존재하지 않는 기록은 모두 404입니다."""
    try:
        return get_relationship_event(db, event_id, user_id)
    except RelationshipNotFoundError as error:
        raise HTTPException(status_code=404, detail="Relationship 근거를 찾을 수 없습니다.") from error
    except RelationshipDatabaseError as error:
        raise HTTPException(status_code=500, detail="Relationship 조회에 실패했습니다.") from error


@router.get("/users/{user_id}/relationship-events", response_model=list[RelationshipEventResponse])
def get_user_relationships(user_id: UUID, limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db)):
    """당시 근거 기록을 반환하며 현재 유효한 관계 목록으로 해석하지 않습니다."""
    try:
        return list_relationship_events(db, user_id, limit)
    except RelationshipNotFoundError as error:
        raise HTTPException(status_code=404, detail="Relationship 근거를 찾을 수 없습니다.") from error
    except RelationshipDatabaseError as error:
        raise HTTPException(status_code=500, detail="Relationship 조회에 실패했습니다.") from error
