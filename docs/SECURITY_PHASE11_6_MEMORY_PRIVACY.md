# Security Phase 11.6: Memory Privacy / Sensitive Data Policy v0.1

## 기준과 범위

- 기준 HEAD: `213fb0a` (Security 11.5). 기존 작업 변경을 보존했습니다.
- 정책 버전: `memory-privacy-v1`. extractor/reconciler 버전은 변경하지 않습니다.
- 이번 범위는 **장기 Memory 승격과 자동 재사용**입니다. Memory v2나 동의 framework를 구현하지 않습니다.
- 원본 채팅 암호화, 전체 DB 암호화, 모든 OpenAI 전송 차단, 계정/데이터 삭제, 관리자 접근, 법적 privacy compliance를 해결한 작업이 아닙니다.
- 의존성, 모델, migration, 모바일, OAuth/Auth, Agent/Lv4/Shadow 변경은 없습니다.

## 실제 데이터 흐름과 복제 지점

1. `/chat`이 사용자 원문을 `messages`에 보존합니다. 원문은 source of truth입니다.
2. 답변 생성 경로는 기존대로 실행되고 assistant 원문과 idempotency 결과가 저장됩니다.
3. 성공 후 `run_memory_extraction_background`가 예약됩니다. UI `sensitive_event`/`savePolicy=ask`와 별개의 경로입니다.
4. extraction은 기존 ownership/role/lease 검증 후 세션을 닫고 원문을 privacy 검사합니다.
5. STANDARD일 때만 한 메시지를 extraction 모델에 보냅니다. 모델의 content/reason을 다시 검사합니다.
6. reconciliation은 새 해석과 동일 사용자의 최대 30개 기존 후보 중 STANDARD만 비교합니다. 조회 세션을 닫고 모델을 호출합니다.
7. 허용된 해석은 `memories.content`, 판단 근거는 extraction/reconciliation 감사 필드에 저장될 수 있습니다. 이 reason도 검사합니다.
8. `memory_evidence`는 원문을 복제하는 테이블이 아니라 message FK 연결입니다. 본인 detail 응답에는 evidence 원문이 포함됩니다.
9. retrieval은 동일 사용자의 활성 후보를 최대 25개 조회한 뒤 privacy 검사합니다. 관련성 모델에는 허용된 후보만 보냅니다.
10. 최종 선택도 재검사합니다. 기존 threshold 0.55 / Top-K 4를 유지하며 선택된 STANDARD Memory만 기존 chat context로 전달합니다.

같은 내용은 원문, 해석, 감사 reason, 모델 요청, API 응답에서 여러 번 나타날 수 있습니다. 정확한 고정 복제 횟수는 경로와 retry에 따라 달라집니다. Evidence 테이블에는 원문 복사본을 새로 만들지 않습니다. 기존 frontend 저장/AsyncStorage 정책은 변경하지 않았습니다.

## Privacy class와 코드 권한

| 분류 | 자동 extraction / RAG | 명시적 수동 생성 |
| --- | --- | --- |
| STANDARD | 기존 보수적 판단 유지 | 허용 |
| SENSITIVE | 차단 | 기존 authenticated ownership 검증 후 허용 |
| RESTRICTED_SECRET | 차단 | 거부 |
| THIRD_PARTY_SENSITIVE | 차단 | 별도 third-party consent 기능은 구현하지 않음; 기존 manual 계약 유지 |

`classify_memory_text`는 분류만 반환하며 민감 원문/값/상세 이유를 로그나 metadata에 복사하지 않습니다. 새로운 privacy metadata를 DB에 저장하지 않습니다. 기존 metadata가 없어도 매 사용 시 content를 검사합니다. privacy class는 authorization을 대체하지 않습니다.

모델의 `should_remember=true`는 저장 권한이 아닙니다. service의 post-gate 및 reconciliation write gate가 탐지된 private content/reason을 거부합니다. 모델 prompt도 credential/민감 개인정보/제3자 정보 저장과 성향 우회 추론을 금지하지만 prompt만을 방어선으로 사용하지 않습니다.

## 명백한 secret과 민감정보 탐지

- Secret: 명시적 password/token/API/secret key 할당, 소유 진술, Bearer, 알려진 key prefix, JWT 형태, private key block, 표시된 금융 식별값, 주민번호 형태.
- Sensitive: 개인의 진단/건강, 성생활/성적 지향, 종교, 정당 지지, 노조 소속, 범죄 이력, 구체적 재정, 상세 주소를 진술하는 문맥.
- Third-party: 위 민감 문맥과 친구/동료/가족 등 제3자 표현이 함께 나타나는 경우.
- 단순 주제 단어만으로 확정하지 않습니다. 병원 앱, 정치 뉴스 서비스, 비밀번호 관리 개발, 은행 API 공부, 친구와 운동하기는 STANDARD regression 사례입니다.
- 모든 fixture는 `SYNTHETIC_*` placeholder 또는 격리된 합성 예문입니다. 실제 토큰/개인정보를 사용하지 않습니다.

**한계:** 제한된 한국어/영어 문맥 및 형태 기반 탐지입니다. 우회/난독화, 모든 언어, 모든 질환/정당/주어/주소 변형, 간접 서술을 완전히 탐지하지 못합니다. 주제가 실제 개인 진술인지 애매한 경우 false positive/negative가 생길 수 있고 제3자 분류도 완전한 개체 추적이 아닙니다. 탐지된 내용에 대한 gate는 결정론적이지만, 모든 민감정보 차단을 보장하지 않습니다. topic 단어를 모두 차단하거나 프로젝트라는 단어가 있으면 무조건 예외 처리하지 않습니다.

## 자동 작업 상태와 기존 안전성

- 탐지된 private 입력/출력은 `completed`, `should_remember=false`, `memory_id=NULL`로 끝납니다.
- reason은 `Blocked by memory privacy policy.`로 고정하며 원문을 복사하지 않습니다.
- 기존 attempt fencing, lease, max attempts, 오류 retry 및 completed 재사용을 유지합니다.
- 완료된 과거 extraction을 새 정책으로 재실행/수정하지 않습니다. legacy Memory의 자동 사용은 retrieval/reconciliation 검사로 제한합니다.
- NEW / REINFORCE / SUPERSEDE의 STANDARD 경로, 원문 evidence 연결, 이전 Memory 보존을 유지합니다.
- matched Memory는 transaction 안에서도 다시 검사하므로 조회 뒤 private content로 바뀐 후보를 강화/대체하지 않습니다.
- 새 개인정보 카테고리 로그나 새로운 DB table/column은 없습니다.

## Manual, legacy, evidence와 UI

Explicit authenticated manual creation과 자동 background 승격은 다릅니다. manual SENSITIVE 생성은 허용하되 secret은 요청해도 거부합니다. 사용자/evidence ownership을 먼저 검증하므로 기존 cross-user 404 및 foreign evidence 거부 정책을 유지합니다. 개발 Auth OFF 경로를 실제 인증/동의로 과장하지 않습니다.

기존 Memory는 삭제/정정/재분류 write하지 않습니다. owner의 직접 detail/evidence 조회는 유지하되 자동 RAG와 reconciliation에서는 content 기준으로 private 후보를 제외합니다. 조회 최대 개수를 늘리거나 필터 후 refill하지 않으므로 후보 수가 줄 수 있습니다. sensitive query도 추가 retrieval 모델 호출을 하지 않습니다.

현재 UI의 `savePolicy=ask`는 장기 Memory 동의가 아닙니다. 이를 자동 Memory 허가로 해석하지 않고, 탐지된 민감 입력은 background에서 별도로 차단합니다. 원본 Message 저장, 기본 chat 모델 전송, 다른 domain/Agent 기록까지 차단하는 것은 아닙니다. 별도의 민감 Memory 동의/검색 UX는 후속 privacy/product 작업입니다.

## 로그와 오류

Memory extractor/selector/reconciler의 SDK 오류는 `RuntimeError` 같은 예외 종류만 출력합니다. 전체 SDK 예외 문자열은 출력하지 않습니다. 기존 extraction 실패 저장 및 background/retrieval 안전 로그도 종류 기반입니다. classifier는 원문이나 카테고리를 로깅하지 않습니다.

이 변경은 Memory 관련 경로에 한정합니다. 전체 서비스의 모든 logger/외부 SDK/운영 플랫폼 logging 안전성을 인증하는 작업이 아니며 일반 OpenAI 진단 경로 등 별도 로깅 감사는 남아 있습니다.

## 검증 결과

- 신규 privacy 24개 PASS: 목표/프로젝트/선호/루틴, false positive, secret prefilter, sensitive/third-party 차단, completed 재사용, 모델 post-gate, manual, ownership/role, legacy, payload, exception privacy, NEW/REINFORCE/SUPERSEDE, stale attempt fencing, lease/timeout/max attempts, failed retry.
- ATTACK-MEMORY-001/002: secret/명시적 기억 요청 차단, Memory 미생성, extraction 모델 호출 0, 원문 Message 보존.
- ATTACK-MEMORY-003: 제3자 건강/정치/종교/노조/성적/재정/주소/범죄 합성 예문 차단.
- ATTACK-MEMORY-004: 모델 true/content/reason을 코드 gate가 무효화합니다.
- ATTACK-MEMORY-005: legacy private Memory를 자동 후보/payload에서 제외하고 owner detail/원본 row는 유지합니다.
- 전체 deterministic backend: **722 PASS** (기존 698 + 신규 24), 삭제/skip 없음.
- Privacy + Auth fail-closed + API surface + Rate limit + Memory ownership 집중 검사: **91 PASS**.
- 전체 Python 217개 syntax, FastAPI import, SQLAlchemy mapper 검사 PASS.
- `mobile`의 `npx tsc --noEmit` PASS. 기존 모바일 파일은 수정하지 않았습니다.
- `git diff --check` PASS (Git LF/CRLF 안내만 존재). 신규 파일도 별도로 공백 검사합니다.
- 기존 파일 355개의 전후 SHA-256 비교에서 아래 Memory 6개만 변경됐습니다. 보호 대상/기존 사용자 변경은 동일합니다.
- 격리 SQLite 복사 모델 + mock SDK를 사용했습니다. PostgreSQL locking/concurrency/live retry 및 실제 LLM 품질평가를 수행했다는 의미가 아닙니다. 실DB 기반 기존 평가 스크립트는 실행하지 않았습니다.
- 실제 Render/DB 쓰기/OpenAI/Auth provider 요청, migration, stage/commit/push 없음.

재현 명령 (backend, PowerShell):

```powershell
$env:PYTHON_DOTENV_DISABLED = '1'
$env:DATABASE_URL = ''
$env:OPENAI_API_KEY = ''
$env:NOIE_RATE_LIMIT_ENABLED = 'false'
$env:NOIE_AUTH_ENABLED = 'false'
python -B -m unittest evals.run_security_memory_privacy_tests
python -B -m unittest discover -s evals -p 'run_*tests.py'
```

## 변경 파일

신규:

- `backend/memory_privacy.py`
- `backend/evals/run_security_memory_privacy_tests.py`
- `docs/SECURITY_PHASE11_6_MEMORY_PRIVACY.md`

수정:

- `backend/memory_service.py`
- `backend/memory_extraction_service.py`
- `backend/memory_extractor.py`
- `backend/memory_retriever.py`
- `backend/memory_reconciler.py`
- `backend/memory_reconciliation_service.py`

reconciliation 두 파일은 legacy 민감 후보가 비교 모델로 별도로 전달되거나 강화되는 경로를 닫기 위한 최소 추가 범위입니다.

## 남은 debt와 다음 단계

- 휴리스틱의 탐지 범위/오탐 평가, sensitive explicit consent/retrieval UX, 전체 서비스 secret 로그 정책, raw conversation retention/암호화/삭제는 별도 범위입니다.
- 수동 제3자 sensitive 저장을 허용하는 기존 계약에 대한 제품/동의 정책도 후속 검토 대상입니다.
- 직접 owner 조회는 legacy sensitive 원문을 반환할 수 있으므로 접근/감사 정책을 별도로 관리해야 합니다.
- 다음 Phase는 **11.7 Admin Access / Break-glass / Audit Log** 하나입니다.
- v0.1의 명시된 로컬/mock 계약 기준 verdict: `SECURITY_11_6_READY`. 완전한 개인정보 탐지나 법적 compliance 인증을 의미하지 않습니다.
