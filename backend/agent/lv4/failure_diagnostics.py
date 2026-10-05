"""실패 경계만 관찰합니다. 예외 문자열, payload, 개인 근거는 기록하지 않습니다."""

from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError

from .schemas import ContractModel, ShortText

Boundary = Literal["OpenAI adapter", "Structured Output parsing", "schema validation",
    "normalization", "RecommendationArguments conversion", "evidence conversion", "Critic handoff", "other"]
BOUNDARIES = set(Boundary.__args__)

# 기존 guard의 고정 문장만 코드로 변환합니다. 임의 예외 내용은 출력하지 않습니다.
GUARD_CODES = {
    "전달하지 않은 근거를 사용할 수 없습니다.": "unknown_evidence_ref",
    "누락된 비교 대상에는 행동 추천 대신 필수 질문이 필요합니다.": "missing_choice_requires_question",
    "선택 지원 없는 일반론만 후보로 반환할 수 없습니다.": "literal_generic_rejected",
    "추천은 현재 발화를 근거로 삼아야 합니다.": "current_ref_missing",
    "명확한 관련 일정 제약을 누락한 추천입니다.": "schedule_ref_missing",
    "강제/죄책감 기반 추천은 반환하지 않습니다.": "coercive_candidate_rejected",
    "명시된 제안 시간이 가까운 일정 시작을 초과합니다.": "duration_exceeds_schedule",
    "RecommendationDecision이 필요합니다.": "decision_type_invalid",
}
ADAPTER_CODES = {"adapter_call_failed", "response_incomplete", "output_text_invalid", "json_parse_failed",
    "output_keys_invalid", "required_field_missing", "invalid_question_evidence", "envelope_contract_invalid",
    "routing_contract_invalid", "action_contract_invalid", "normalization_failed", "decision_contract_invalid"}
SAFE_TYPES = {"ValueError", "TypeError", "RuntimeError", "ValidationError", "JSONDecodeError",
    "APIConnectionError", "APITimeoutError", "AuthenticationError", "PermissionDeniedError",
    "RateLimitError", "BadRequestError", "InternalServerError", "NotFoundError"}
SAFE_FILES = {"recommendation_adapter.py", "recommendation_specialist.py", "specialist.py",
    "collaboration_pipeline.py", "collaboration_context.py", "schemas.py", "recommendation_schemas.py",
    "critic_specialist.py", "critic_context.py", "arbitrator_specialist.py", "arbitrator_context.py"}
# Pydantic의 고정 타입 코드만 추가합니다. 필드 값/validation 원문은 저장하지 않습니다.
SCHEMA_CODES = {"missing": "required_field_missing", "literal_error": "invalid_enum",
    "bool_type": "invalid_boolean", "float_type": "invalid_number", "int_type": "invalid_integer",
    "list_type": "invalid_array", "dict_type": "invalid_object",
    "string_type": "invalid_string", "string_too_long": "string_length_invalid",
    "too_long": "collection_limit_exceeded", "greater_than_equal": "score_out_of_range",
    "less_than_equal": "score_out_of_range", "extra_forbidden": "unexpected_field"}
VALIDATION_CODES = {
    "needs_action과 actions 존재 여부가 일치해야 합니다.": "needs_action_mismatch",
    "execution_order는 1부터 연속된 순서여야 합니다.": "execution_order_invalid",
    "tradeoff만 주 추천과 대안을 함께 가집니다.": "tradeoff_alternative_mismatch",
    "회복 후 재평가에는 재평가 시간이 필요합니다.": "reassess_time_missing",
    "대안은 주 추천과 다른 유효한 선택이어야 합니다.": "alternative_not_distinct",
    "필수 정보 질문은 추천 없이 명확한 질문으로 반환해야 합니다.": "question_and_candidate_conflict",
    "질문은 needs_user_input과 함께 반환해야 합니다.": "question_flag_mismatch",
    "근거 참조는 중복될 수 없습니다.": "duplicate_evidence_ref",
}


class FailureDiagnostic(ContractModel):
    """고정 코드와 소스 위치만 보존합니다. 외부 예외 메시지를 받는 필드는 없습니다."""

    stage: Literal["BRIDGE", "STATE", "RECOMMENDATION", "CRITIC", "ARBITRATOR", "VALIDATOR"]
    boundary: Boundary
    error_type: ShortText
    safe_message: ShortText
    validation_codes: list[ShortText] = Field(default_factory=list, max_length=8)
    stack_location: ShortText | None = None
    typed_decision_completed: bool = False
    result_status: Literal["FAILED"] = "FAILED"


def diagnose(error: Exception, stage: str, *, typed_decision_completed=False) -> FailureDiagnostic:
    """예외를 성공으로 바꾸지 않습니다. 비밀값이 섞일 수 있는 str/error.errors는 저장하지 않습니다."""
    boundary = getattr(error, "_lv4_boundary", "other")
    if boundary not in BOUNDARIES:
        boundary = "other"
    code = getattr(error, "_lv4_code", "boundary_exception")
    if code not in ADAPTER_CODES:
        code = GUARD_CODES.get(error.args[0], "boundary_exception") if error.args and isinstance(error.args[0], str) else "boundary_exception"
    if code in GUARD_CODES.values():
        boundary = "evidence conversion" if code in {"unknown_evidence_ref", "current_ref_missing", "schedule_ref_missing"} else "normalization"
    validation_codes = []
    if isinstance(error, ValidationError):
        # ctx의 원래 ValueError는 고정 문장 사전으로만 비교합니다. 객체/문자열 자체는 절대 기록하지 않습니다.
        issues = error.errors(include_input=False, include_url=False)
        for item in issues:
            cause = item.get("ctx", {}).get("error")
            reason = VALIDATION_CODES.get(cause.args[0]) if isinstance(cause, ValueError) and cause.args and isinstance(cause.args[0], str) else SCHEMA_CODES.get(item["type"])
            if reason and reason not in validation_codes and len(validation_codes) < 8:
                validation_codes.append(reason)
        if code == "routing_contract_invalid" and any("arguments" in item["loc"] for item in issues):
            boundary = "RecommendationArguments conversion"
    location = None
    trace = error.__traceback__
    while trace is not None:
        filename = Path(trace.tb_frame.f_code.co_filename).name
        if filename in SAFE_FILES:
            location = f"{filename}:{trace.tb_lineno}"
        trace = trace.tb_next
    if boundary == "other" and stage == "CRITIC":
        boundary = "Critic handoff"
    if boundary == "other" and isinstance(error, ValidationError):
        boundary = "schema validation"
    name = type(error).__name__
    return FailureDiagnostic(stage=stage, boundary=boundary, error_type=name if name in SAFE_TYPES else "OtherError",
        safe_message=code, validation_codes=validation_codes, stack_location=location, typed_decision_completed=typed_decision_completed)
