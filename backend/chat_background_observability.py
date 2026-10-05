"""기존 background 실행을 바꾸지 않고 진입/반환/미처리 예외 경계만 관찰합니다."""

import hashlib
import json
import time


def _emit(event, task_name, correlation, elapsed_ms=None):
    """고정된 이벤트/작업명만 출력하며 직렬화와 print 오류는 업무 함수로 전파하지 않습니다."""
    try:
        if task_name not in {"memory", "agent"}:
            return
        record = {"event": event, "task": task_name, "correlation": correlation}
        if elapsed_ms is not None:
            record["elapsed_ms"] = elapsed_ms
        print("[noie] chat_bg " + json.dumps(record, ensure_ascii=True))
    except Exception:
        pass


def run_observed_background(task_name, function, *args, correlation_source=None):
    """함수/인자를 그대로 실행합니다. returned는 내부 업무 성공이 아니라 함수 반환입니다."""
    correlation = None
    started = None
    try:
        # Shadow와 동일한 request UUID bytes hash입니다. request가 없으면 같은 message UUID를 씁니다.
        correlation = hashlib.sha256(correlation_source.bytes).hexdigest()[:24]
    except Exception:
        # 관측용 식별자 생성 오류도 실제 업무 실행을 막지 않습니다. 원문을 fallback으로 쓰지 않습니다.
        pass
    try:
        started = time.monotonic()
        _emit("started", task_name, correlation)
    except Exception:
        pass

    event = "returned"
    try:
        return function(*args)
    except BaseException:
        # 취소/미처리 예외도 기존 전파 정책 그대로 유지하며 메시지/타입/인자는 출력하지 않습니다.
        event = "failed"
        raise
    finally:
        try:
            elapsed_ms = round((time.monotonic() - started) * 1000, 2) if started is not None else None
            _emit(event, task_name, correlation, elapsed_ms)
        except Exception:
            pass
