"""요청 한 건의 크기와 모델 사용량을 제한합니다. 인증/빈도 제한을 대체하지 않습니다."""

import json
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from types import SimpleNamespace

from starlette.responses import JSONResponse

# 환경변수로 unlimited가 되지 않는 서버 정책입니다. 원문을 자르는 대신 초과를 거부합니다.
MAX_BODY_BYTES = 262_144
MAX_RESPONSE_BYTES = 2_097_152
MAX_TEXT_CHARS = 8192
MAX_MESSAGE_CHARS = 65_536
MAX_HISTORY_ITEMS = 40
MAX_HISTORY_CHARS = 65_536
MAX_HISTORY_CONTEXT_BYTES = 32_768
MAX_JSON_DEPTH = 16
MAX_JSON_NODES = 4096
MAX_JSON_STRING_CHARS = 65_536
MAX_MODEL_INPUT_BYTES = 131_072
MAX_MODEL_OUTPUT_BYTES = 65_536
MAX_MODEL_CALLS = 24
MAX_TOTAL_MODEL_INPUT_BYTES = 1_048_576
MAX_OUTPUT_TOKENS = 8192
MAX_TOTAL_OUTPUT_TOKENS = 196_608
PAGE_SIZE = 100
MAX_PAGE_OFFSET = 100_000
MAX_EVIDENCE_READ_ITEMS = 1000
MAX_READ_CONTENT_CHARS = 262_144
SAFE_BUDGET_MESSAGE = "요청을 처리할 수 있는 범위를 초과했습니다."


class ResourceBudgetExceeded(ValueError):
    """원문/식별자/한도 세부값을 담지 않는 고정 오류입니다."""

    def __init__(self):
        super().__init__(SAFE_BUDGET_MESSAGE)


def check_json_shape(value):
    """파싱한 JSON의 깊이/전체 항목/문자열을 반복문으로 검사합니다."""
    stack = [(value, 0)]
    nodes = 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if depth > MAX_JSON_DEPTH or nodes > MAX_JSON_NODES:
            raise ResourceBudgetExceeded()
        if isinstance(item, str) and len(item) > MAX_JSON_STRING_CHARS:
            raise ResourceBudgetExceeded()
        if isinstance(item, dict):
            stack.extend((child, depth + 1) for child in item.values())
            stack.extend((key, depth + 1) for key in item)
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)


def encoded_size(value):
    """UTF-8 전송 크기로 계산합니다. provider tokenizer의 정확한 token 수는 아닙니다."""
    return len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))


def check_response_budget(value):
    """새 chat 결과는 assistant 저장 전에 검사하여 반환 불가능한 결과를 완료하지 않습니다."""
    if encoded_size(value) > MAX_RESPONSE_BYTES:
        raise ResourceBudgetExceeded()


def page_statement(statement, limit=PAGE_SIZE, offset=0):
    """기존 배열 응답을 유지하면서 SQL 조회 자체를 유한한 페이지로 제한합니다."""
    if not 1 <= limit <= PAGE_SIZE or not 0 <= offset <= MAX_PAGE_OFFSET:
        raise ResourceBudgetExceeded()
    return statement.limit(limit).offset(offset)


def bounded_history(messages, limit):
    """최근 항목을 우선하되 전체 메시지 단위로만 선택합니다. 저장된 원문은 바꾸지 않습니다."""
    selected = []
    size = 0
    for item in reversed((messages or [])[-limit:]):
        item_size = encoded_size(item)
        if item_size > MAX_HISTORY_CONTEXT_BYTES:
            continue
        if size + item_size > MAX_HISTORY_CONTEXT_BYTES:
            break
        selected.append(item)
        size += item_size
    return list(reversed(selected))


class ModelBudget:
    """ASGI 요청에서 복사된 thread context도 같은 카운터를 참조합니다."""

    def __init__(self):
        self.calls = 0
        self.input_bytes = 0
        self.output_tokens = 0
        self.lock = threading.Lock()

    def reserve(self, size, tokens):
        """실패한 호출도 소비한 것으로 계산합니다. 재시도/병렬 예약으로 한도를 초기화하지 않습니다."""
        with self.lock:
            if (self.calls >= MAX_MODEL_CALLS or
                    self.input_bytes + size > MAX_TOTAL_MODEL_INPUT_BYTES or
                    self.output_tokens + tokens > MAX_TOTAL_OUTPUT_TOKENS):
                raise ResourceBudgetExceeded()
            self.calls += 1
            self.input_bytes += size
            self.output_tokens += tokens


_model_budget = ContextVar("noie_model_budget", default=None)


@contextmanager
def model_budget_scope():
    """중첩 경계는 같은 예산을 쓰고 최상위가 끝난 뒤에만 요청 상태를 정리합니다."""
    if _model_budget.get() is not None:
        yield _model_budget.get()
        return
    budget = ModelBudget()
    token = _model_budget.set(budget)
    try:
        yield budget
    finally:
        _model_budget.reset(token)


def create_model_response(client, *, require_complete=True, **kwargs):
    """SDK 직전 입력/출력 예약을 검사합니다. privacy 검사는 기존 호출자에 그대로 남습니다."""
    # 숨은 provider history/tool fan-out과 streaming은 현재 NOIE 호출 계약에 없습니다.
    if any(kwargs.get(key) for key in ("tools", "previous_response_id", "conversation", "background", "stream")):
        raise ResourceBudgetExceeded()
    tokens = kwargs.get("max_output_tokens", MAX_OUTPUT_TOKENS)
    if not isinstance(tokens, int) or not 16 <= tokens <= MAX_OUTPUT_TOKENS:
        raise ResourceBudgetExceeded()
    kwargs["max_output_tokens"] = tokens
    size = encoded_size(kwargs)
    if size > MAX_MODEL_INPUT_BYTES:
        raise ResourceBudgetExceeded()
    with model_budget_scope() as budget:
        budget.reserve(size, tokens)
        # 실제 SDK 및 주입된 실제 client도 숨은 자동 retry를 없앱니다. mock client는 그대로 씁니다.
        if isinstance(getattr(client, "max_retries", None), int):
            client = client.with_options(max_retries=0, timeout=60.0)
        response = client.responses.create(**kwargs)
        output = getattr(response, "output_text", None)
        if isinstance(output, str) and len(output.encode("utf-8")) > MAX_MODEL_OUTPUT_BYTES:
            raise ResourceBudgetExceeded()
        # 불완전 JSON을 부분 성공으로 사용하지 않고 기존 fallback/실패 정책에 맡깁니다.
        if require_complete and getattr(response, "status", "completed") == "incomplete":
            raise ResourceBudgetExceeded()
        return response


def budgeted_client(client):
    """기존 Lv4 prompt/call 지문과 자체 incomplete 진단을 유지하는 얇은 SDK facade입니다."""
    return SimpleNamespace(
        responses=SimpleNamespace(create=lambda **kwargs: create_model_response(client, require_complete=False, **kwargs)),
        close=getattr(client, "close", lambda: None),
    )


class ResourceBudgetMiddleware:
    """순수 ASGI 경계입니다. BackgroundTasks를 교체하지 않고 완료까지 같은 예산을 유지합니다."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # chunked/거짓 Content-Length도 실제 수신 바이트로 제한합니다. 다운스트림 진입 전까지만 버퍼링합니다.
        chunks = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > MAX_BODY_BYTES:
                await JSONResponse({"detail": SAFE_BUDGET_MESSAGE}, status_code=413)(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        if body:
            try:
                check_json_shape(json.loads(body))
            except (ResourceBudgetExceeded, RecursionError):
                await JSONResponse({"detail": SAFE_BUDGET_MESSAGE}, status_code=413)(scope, receive, send)
                return
            except (ValueError, UnicodeError):
                # 잘못된 JSON은 기존 FastAPI의 안전한 422 처리에 맡깁니다.
                pass

        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        response_start = None
        response_parts = []
        response_size = 0
        rejected = False

        async def bounded_send(message):
            nonlocal response_start, response_size, rejected
            if message["type"] == "http.response.start":
                response_start = message
            elif message["type"] == "http.response.body" and not rejected:
                response_size += len(message.get("body", b""))
                if response_size > MAX_RESPONSE_BYTES:
                    rejected = True
                    response_parts.clear()
                    await JSONResponse({"detail": SAFE_BUDGET_MESSAGE}, status_code=503)(scope, replay, send)
                    return
                response_parts.append(message)
                if not message.get("more_body", False):
                    await send(response_start)
                    for part in response_parts:
                        await send(part)
                    response_parts.clear()
            elif message["type"] not in {"http.response.start", "http.response.body"}:
                await send(message)

        # scopeはsync endpoint/threadpool/backgroundを含むASGI完了まで続きます。
        with model_budget_scope():
            await self.app(scope, replay, bounded_send)
