"""HTTP 동작을 바꾸지 않고 자동 생성된 422 문서를 실제 안전 응답에 맞춥니다."""

from fastapi import FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict

from account_router import SafeAccountRoute
from admin_router import SafeAdminRoute


class NoieValidationErrorBody(BaseModel):
    """검증 오류와 업무 코드의 HTTPException(422)이 공유하는 문자열 구조입니다."""

    model_config = ConfigDict(extra="forbid")
    detail: str


def install_validation_openapi(app: FastAPI) -> None:
    """기존 OpenAPI 생성/캐시는 재사용하고 FastAPI의 기본 422 문서만 보정합니다."""
    original_openapi = app.openapi

    def validation_openapi() -> dict:
        """경로별 handler를 구분하며 정상 응답, 인증 및 명시적 오류 문서는 보존합니다."""
        document = original_openapi()
        for route in app.routes:
            if not isinstance(route, APIRoute) or not route.include_in_schema:
                continue
            for method in route.methods:
                operation = document.get("paths", {}).get(route.path_format, {}).get(method.lower(), {})
                response = operation.get("responses", {}).get("422", {})
                content = response.get("content", {}).get("application/json", {})
                # 명시적으로 정의한 422나 입력이 없는 경로에는 새 응답을 추가하지 않습니다.
                if content.get("schema") != {"$ref": "#/components/schemas/HTTPValidationError"}:
                    continue
                document.setdefault("components", {}).setdefault("schemas", {})[
                    "NoieValidationErrorBody"
                ] = NoieValidationErrorBody.model_json_schema()
                content["schema"] = {"$ref": "#/components/schemas/NoieValidationErrorBody"}
                response["description"] = "Validation error with input details redacted."
                if isinstance(route, SafeAccountRoute):
                    detail = "계정 요청 형식이 올바르지 않습니다."
                elif isinstance(route, SafeAdminRoute):
                    detail = "관리자 요청 형식이 올바르지 않습니다."
                else:
                    detail = "요청 형식이 올바르지 않습니다."
                    # 업무 코드의 HTTPException(422)은 이 헤더 없이도 같은 body 구조를 씁니다.
                    response.setdefault("headers", {})["X-Noie-Error-Code"] = {
                        "description": (
                            "Present on RequestValidationError responses only; "
                            "an endpoint-raised HTTPException(422) may omit this header."
                        ),
                        "schema": {"type": "string", "enum": ["request_validation_error"]},
                    }
                content["example"] = {"detail": detail}
        return document

    # exception handler, route handler, middleware, 문서 공개 설정은 변경하지 않습니다.
    app.openapi = validation_openapi
