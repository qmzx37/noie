"""사용자 수행 보고와 시간 unknown/conflict를 원문과 분리하는 Activity 계약입니다."""

from datetime import date, time
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from agent.lv4.schemas import ContractModel, OpinionEvidence, Score, ShortText


ActivityStatus = Literal["performed", "ongoing"]
Minutes = Annotated[int, Field(strict=True, ge=0, le=525600)]
TimeIssue = Literal[
    "ambiguous_clock", "invalid_clock", "timezone_unknown", "date_conflict", "invalid_date",
    "future_activity_date", "duration_conflict", "end_before_start", "ongoing_end_unconfirmed",
]


class ActivityObservation(ContractModel):
    """시간이 없으면 NULL입니다. performed도 현실 검증이 아닌 사용자 보고입니다."""

    action: ShortText
    status: ActivityStatus
    activity_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    duration_minutes: Minutes | None = None
    reported_duration_minutes: Minutes | None = None
    calculated_duration_minutes: Minutes | None = None
    time_issues: list[TimeIssue] = Field(default_factory=list, max_length=9)
    observed_at: AwareDatetime | None = None
    confidence: Score | None = None
    evidence: OpinionEvidence

    @model_validator(mode="after")
    def validate_observation(self):
        """완료하지 않은 활동의 종료/계산 시간과 충돌 값의 임의 확정을 막습니다."""
        if self.status == "ongoing" and (self.end_time is not None or self.calculated_duration_minutes is not None):
            raise ValueError("ongoing에는 완료 시각을 확정하지 않습니다.")
        if "duration_conflict" in self.time_issues and self.duration_minutes is not None:
            raise ValueError("충돌한 duration은 unknown이어야 합니다.")
        if self.observed_at != self.evidence.observed_at:
            raise ValueError("원문 관찰 시점과 일치해야 합니다.")
        return self


class ActivityAnalysis(ContractModel):
    """DB 저장 전에 사용하는 제한된 해석 결과이며 새 Activity Agent는 아닙니다."""

    activities: list[ActivityObservation] = Field(default_factory=list, max_length=16)
    reason: Literal["recognized", "no_completed_activity", "privacy_restricted"]


class ActivityResponse(ContractModel):
    """owner-only 조회에서도 raw evidence/metadata/Message ID를 공개하지 않습니다."""

    id: UUID
    action: ShortText
    status: ActivityStatus
    activity_date: date | None
    start_time: time | None
    end_time: time | None
    duration_minutes: Minutes | None
    reported_duration_minutes: Minutes | None
    calculated_duration_minutes: Minutes | None
    time_issues: list[TimeIssue]
    observed_at: AwareDatetime | None
    confidence: Score | None
