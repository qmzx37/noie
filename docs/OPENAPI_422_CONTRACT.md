# NOIE OpenAPI 422 Contract

## Scope

기준 커밋: `b875de6191593450304ac5ec0f7c7bd5c640026e`.
이번 변경은 OpenAPI 문서만 실제 응답에 맞춘다. HTTP handler, 입력 검증, 인증,
소유권, DB 저장, CORS, 문서 공개 설정은 변경하지 않는다.

## Actual Responses

| 발생 경로 | 실제 body | X-Noie-Error-Code |
|---|---|---|
| 일반 RequestValidationError | `{"detail":"요청 형식이 올바르지 않습니다."}` | `request_validation_error` |
| SafeAccountRoute 검증 오류 | `{"detail":"계정 요청 형식이 올바르지 않습니다."}` | 없음 |
| SafeAdminRoute 검증 오류 | `{"detail":"관리자 요청 형식이 올바르지 않습니다."}` | 없음 |
| 업무 코드의 HTTPException(422) | `{"detail":"해당 업무의 안전한 안내 문자열"}` | 없을 수 있음 |

HTTP 상태코드는 모두 422이다. `detail`은 오류 배열이 아닌 문자열이다.
일반 입력 검증 오류에는 input/msg/ctx/loc/body, 사용자 원문이나 예외 원문을 반환하지 않는다.
공통 문서 모델은 `NoieValidationErrorBody`이며 `detail: string`을 필수로 정의한다.
업무 422도 같은 구조이므로 detail을 하나의 고정 문구로 제한하지 않는다.
일반 라우트에 문서화한 오류 헤더는 RequestValidationError에만 적용되며 필수 헤더가 아니다.

## Documentation Generation

FastAPI의 원래 OpenAPI 생성 및 캐시를 재사용한다. 자동 생성된
`HTTPValidationError` 응답 참조만 문자열 모델로 교체한다.
account/admin은 실제 route class로 구분한다. 명시적으로 작성한 다른 422 계약,
정상 응답, 401/403/404 및 나머지 metadata는 덮어쓰지 않는다.
입력 없는 경로에 불필요한 422를 추가하지 않고 숨겨진 internal endpoint도 공개하지 않는다.
미참조 FastAPI 기본 component가 남을 수 있지만 NOIE 자동 422 operation은 이를 사용하지 않는다.

`/openapi.json`은 기존처럼 startup의 `NOIE_API_DOCS_ENABLED`가 명시적 ON일 때만 공개한다.
이 변경으로 운영 문서를 자동 공개하지 않는다. CORS expose_headers도 추가하지 않으므로
교차 origin 브라우저 JavaScript의 오류 헤더 접근을 새로 보장하지 않는다.

## Compatibility And Limits

이전 보안 수정에서 이미 HTTP 422 detail 배열이 문자열로 변경됐다. 이번에는 wire format의
추가 변경이 없다. 커밋된 모바일 소비자는 오류 status/ok를 사용하며 detail 배열을 읽지 않는다.
외부 클라이언트 및 이전 OpenAPI로 생성된 SDK의 호환성은 **UNVERIFIED**이다.
문서에서 SDK를 다시 생성하면 detail 타입은 문자열이 되므로 외부 소비자는 별도 확인해야 한다.

실제 Render/PostgreSQL/OpenAI 요청, SBOM 전체 schema 검증 및 production release 승인은
이번 계약 정합성 검증에 포함되지 않는다.
