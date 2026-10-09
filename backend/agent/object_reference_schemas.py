"""원문 존재만 검증하는 읽기 계약입니다. 현실의 대상 identity는 확정하지 않습니다."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from agent.lv4.schemas import ContractModel, ShortText


ObjectReferenceKind = Literal["place", "person", "thing", "project"]


class SourceSpan(ContractModel):
    """원본 Message의 Python Unicode code point 위치: 0-based [start, end).

    UTF-8 byte나 JavaScript UTF-16 위치가 아닙니다. 원문 정규화도 하지 않습니다.
    """

    start: Annotated[int, Field(strict=True, ge=0)]
    end: Annotated[int, Field(strict=True, gt=0)]

    @model_validator(mode="after")
    def validate_range(self):
        if self.end <= self.start:
            raise ValueError("invalid_source_span")
        return self


class ActivityObjectReferenceRequest(ContractModel):
    """kind는 사용자의 선택이며 label은 변경 없이 원문과 대조합니다."""

    activity_id: UUID
    kind: ObjectReferenceKind
    label: ShortText
    source_span: SourceSpan


class ActivityObjectReferencePreview(ActivityObjectReferenceRequest):
    """FACT/identity/관계의 확정이 아닌 사용자 보고 근거의 존재 확인입니다.

    동일 label도 병합하지 않습니다. observed_at은 행동 시작/종료 시각이 아닙니다.
    """

    kind_basis: Literal["user_selected"] = "user_selected"
    identity_status: Literal["unresolved"] = "unresolved"
    observed_at: AwareDatetime | None
