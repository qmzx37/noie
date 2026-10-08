"""Memory 승격/자동 재사용 정책입니다. 원문 삭제나 완전한 개인정보 탐지기가 아닙니다."""

import re
from enum import StrEnum

MEMORY_PRIVACY_POLICY_VERSION = "memory-privacy-v1"
PRIVACY_BLOCK_REASON = "Blocked by memory privacy policy."


class PrivacyClass(StrEnum):
    STANDARD = "STANDARD"
    SENSITIVE = "SENSITIVE"
    RESTRICTED_SECRET = "RESTRICTED_SECRET"
    THIRD_PARTY_SENSITIVE = "THIRD_PARTY_SENSITIVE"


# 실제 값 형태 또는 소유/할당 표현을 요구합니다. 단순 '비밀번호 기능 개발'은 차단하지 않습니다.
SECRET_PATTERNS = tuple(re.compile(pattern, re.I) for pattern in (
    # 비밀번호 라벨 안의 공백만 허용합니다. 값 할당/소유 문맥 없이 일반 개발 주제를 차단하지 않습니다.
    r"비\s*밀\s*번\s*호\s*[:=]\s*\S+",
    r"(?:내|나의|사용자의)\s*비\s*밀\s*번\s*호\s*(?:는|은|이|가|is|:|=)\s*\S+",
    r"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
    r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}",
    r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b",
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
    r"(?:password|passwd|비밀번호|패스워드|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|secret[_ -]?key|접근 토큰|갱신 토큰|API 키|시크릿 키)\s*[:=]\s*\S+",
    r"(?:내|나의|사용자의|my)\s*(?:비밀번호|패스워드|password|토큰|access[_ -]?token|refresh[_ -]?token|api\s*(?:키|key)|secret\s*key)\s*(?:는|은|이|가|is|:|=)\s*\S+",
    r"(?:카드번호|계좌번호|카드 비밀번호|card number|bank account|PIN)\s*(?:는|은|:|=|is)\s*[0-9][0-9 -]{3,}",
    r"(?<!\d)\d{6}-[1-8]\d{6}(?!\d)",
))
# 민감 주제 자체가 아니라 개인의 진단/소속/성향/재정 등을 진술하는 문맥을 찾습니다.
# 동일한 개인 주어 변형을 재사용해 '친구가/친구는'과 가족 진술을 일관되게 처리합니다.
PERSON_SUBJECT = r"(?:나는|내가|사용자는|(?:친구|동료|엄마|아빠|어머니|아버지|남편|아내)(?:는|가|의))"
SENSITIVE_PATTERNS = tuple(re.compile(pattern, re.I) for pattern in (
    # 조사/띄어쓰기 변형도 명시적 진단으로 취급하며 '병원 앱 개발'에는 적용하지 않습니다.
    r"(?:암|당뇨|우울증|조울증|정신질환|HIV|에이즈|질환|병)\s*(?:을|를|이|가|에)?\s*(?:진단(?:을)?\s*받|확진|있어|있다|있습니다|앓|걸렸|치료받|치료 받)",
    r"(?:나(?:는|의)?|내가|사용자는|친구가|동료가).{0,30}(?:진단(?:을)?\s*받|확진|정신과 치료|항우울제 복용)",
    PERSON_SUBJECT + r".{0,25}(?:성생활|성적 지향|성관계|동성애자|양성애자|성병|불임|낙태|게이|레즈비언)",
    r"(?:나의|내|사용자의|친구의).{0,10}(?:종교|정치 성향|성적 지향).{0,10}(?:는|은|:|=)",
    PERSON_SUBJECT + r".{0,25}(?:기독교|불교|천주교|이슬람|무신론).{0,15}(?:신자|믿|신봉|이다|이야)",
    PERSON_SUBJECT + r".{0,25}(?:정당|민주당|국민의힘|보수|진보).{0,15}(?:지지|성향|당원|투표)",
    PERSON_SUBJECT + r".{0,25}(?:노동조합|노조).{0,15}(?:가입|조합원|소속)",
    r"(?:전과|범죄 이력).{0,10}(?:있|는|:)|" + PERSON_SUBJECT + r".{0,30}(?:유죄 판결|실형|수감|성범죄)",
    r"(?:내|나의|사용자의|친구의|동료의|어머니의|아버지의).{0,12}(?:연봉|월급|부채|대출|잔고|자산|재산).{0,12}\d+[\d,.]*\s*(?:억|만|원|달러)",
    r"(?:내|나의|사용자의|친구의|동료의|어머니의|아버지의).{0,8}주소\s*(?:는|은|:|=).{0,40}(?:로|길|동|번지|호)\s*\d+",
    r"\b(?:I|he|she)\s+(?:have|has|am|is|was diagnosed with).{0,20}(?:diabetes|cancer|HIV|depression|gay|bisexual|Christian|Muslim|union member)",
    r"\b(?:my|his|her)\s+(?:religion|sexual orientation|political affiliation|criminal record|medical diagnosis|bank balance|salary|home address)\s*(?:is|:|=)",
))
THIRD_PARTY = re.compile(r"친구|동료|지인|엄마|아빠|어머니|아버지|가족|그녀|그는|남편|아내|\b(?:friend|he|she|his|her)\b", re.I)


def classify_memory_text(text: str) -> PrivacyClass:
    """탐지 결과만 반환하며 원문/비밀 값이나 상세 사유를 로그/metadata에 복제하지 않습니다."""
    if any(pattern.search(text) for pattern in SECRET_PATTERNS):
        return PrivacyClass.RESTRICTED_SECRET
    if any(pattern.search(text) for pattern in SENSITIVE_PATTERNS):
        return PrivacyClass.THIRD_PARTY_SENSITIVE if THIRD_PARTY.search(text) else PrivacyClass.SENSITIVE
    return PrivacyClass.STANDARD


def automatic_memory_allowed(text: str) -> bool:
    """별도 동의 UX가 없는 v0.1은 sensitive/third-party/secret 자동 승격과 RAG를 허용하지 않습니다."""
    return classify_memory_text(text) == PrivacyClass.STANDARD


def blocked_memory_decision():
    """기존 completed/should_remember=false 계약을 사용해 privacy 차단의 재시도 loop를 막습니다."""
    from memory_schemas import MemoryExtractionDecision
    return MemoryExtractionDecision(should_remember=False, reason=PRIVACY_BLOCK_REASON,
                                    content="", kind="other", importance=0, confidence=0)


def validate_auto_decision(decision):
    """모델 출력도 authority가 아닙니다. content뿐 아니라 저장될 reason도 다시 검사합니다."""
    if not automatic_memory_allowed(decision.content) or not automatic_memory_allowed(decision.reason):
        return blocked_memory_decision()
    return decision
