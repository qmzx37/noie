"""브라우저 CORS와 문서 공개 정책입니다. 사용자 인증/소유권을 대신하지 않습니다."""

import ipaddress
import os
import re
from urllib.parse import urlsplit


# 현재 업무 라우트는 GET/POST만 사용합니다. OPTIONS는 CORS middleware가 처리합니다.
CORS_METHODS = ("GET", "POST")
CORS_HEADERS = ("Authorization", "Content-Type")


def _validated_origin(value: str) -> str:
    """origin만 정규화합니다. URL parser가 제거하는 공백/제어 문자도 먼저 거부합니다."""
    if any(ord(char) <= 32 or ord(char) >= 127 for char in value) or "*" in value or "%" in value:
        raise ValueError("Invalid CORS origin")
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc
            or parsed.path or "?" in value or "#" in value or "@" in parsed.netloc):
        raise ValueError("Invalid CORS origin")
    host = parsed.hostname
    port = parsed.port  # 잘못된 숫자/범위는 urllib가 ValueError로 거부합니다.
    if not host or port == 0 or parsed.netloc.endswith(":"):
        raise ValueError("Invalid CORS origin")
    # bracket 뒤의 쓰레기 문자열처럼 parser가 관대하게 받아들이는 authority도 거부합니다.
    authority = f"[{host}]" if ":" in host else host
    if not re.fullmatch(re.escape(authority) + (r":[0-9]+" if port is not None else ""), parsed.netloc.lower()):
        raise ValueError("Invalid CORS origin")
    if ":" in host:
        host = f"[{ipaddress.IPv6Address(host).compressed}]"
    elif re.fullmatch(r"[0-9.]+", host):
        host = str(ipaddress.IPv4Address(host))
    elif len(host) > 253 or any(
        not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in host.split(".")
    ):
        raise ValueError("Invalid CORS origin")
    # 브라우저 origin은 기본 포트를 생략하므로 같은 형식으로 맞춥니다.
    suffix = f":{port}" if port is not None and port != {"http": 80, "https": 443}[parsed.scheme] else ""
    return f"{parsed.scheme}://{host}{suffix}"


def cors_allowed_origins() -> list[str]:
    """누락/빈 값은 deny-by-default, 하나라도 잘못되면 전체 allowlist를 닫습니다."""
    items = [item.strip() for item in os.getenv("NOIE_CORS_ALLOWED_ORIGINS", "").split(",") if item.strip()]
    try:
        return list(dict.fromkeys(_validated_origin(item) for item in items))
    except ValueError:
        # 설정 원문에 비밀 정보가 들어갈 수 있어 오류/원문을 출력하지 않습니다.
        return []


def api_docs_options() -> dict[str, str | None]:
    """문서는 개발자가 명시적으로 켠 때만 등록합니다. 오타/누락은 공개하지 않습니다."""
    enabled = os.getenv("NOIE_API_DOCS_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
    return {
        "docs_url": "/docs" if enabled else None,
        "redoc_url": "/redoc" if enabled else None,
        "openapi_url": "/openapi.json" if enabled else None,
    }
