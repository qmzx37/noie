# NOIE Security Phase 11.9: Adversarial Verification

## 먼저 읽을 결과

1. **시도한 공격:** 토큰 변조, 타인 Memory/Action 접근, 관리자 권한 위조, 삭제 후 늦은 작업 완료, 오류/로그의 비밀 반사, Memory privacy 우회, 비용 API 교차 호출과 동시 한도 소비입니다.
2. **막힌 것:** 실제 서명 검증, 일반 사용자 소유권, 관리자 감사 실패 시 읽기 차단, 비활성 계정의 신규 접근, 계정별 로컬 데이터 격리, limiter 동시 소비/활성 bucket 보호는 검사 범위에서 통과했습니다.
3. **발견한 구멍:** 비활성화 이후 늦은 chat/REINFORCE/Agent 완료가 반영됩니다. 일부 422 응답과 project fallback 로그는 입력/예외 원문을 반사합니다. 띄어 쓴 비밀번호 라벨은 Memory 휴리스틱을 통과합니다. 커밋 테스트는 미추적 fixture에 의존합니다.
4. **아직 못 한 것:** 별도 PostgreSQL 경합, 실제 기기/OAuth 철회/LLM injection, Render proxy/worker/백업 검증입니다. 운영 DB의 임시 schema 검사도 하지 않았습니다.
5. **다음에 고칠 한 가지:** 비활성화와 실행 중 작업의 최종 저장 사이에 삭제 fencing을 마련하고 전용 PostgreSQL에서 경합을 검증해야 합니다. 이번 감사에서는 고치지 않았습니다.

**Verdict: SECURITY_11_9_FINDINGS**

`release_approved: false`. 필수 미실행 검사가 남아 있으며 운영 보안 승인이나 전체 PASS가 아닙니다.

## 기준과 격리

- HEAD: `e779520967c51e9051556f198a285c1538af15f3`; main. HEAD/기존 working tree를 바꾸지 않았습니다.
- `git archive HEAD`를 임시 폴더에 추출했습니다. `.env`/미추적 Lv4 파일을 복사하지 않았습니다. 신규 audit harness만 외부 경로에서 archive 코드를 검사했습니다.
- import 전 NOIE/Supabase/OpenAI/DB/mobile 설정을 제거하고 dotenv를 비활성화했습니다. DB URL/비밀을 읽어 출력하지 않았습니다.
- 외부 socket/HTTPX 통신과 psycopg 연결을 차단했습니다. Windows asyncio 내부 socketpair용 루프백만 허용했습니다.
- DB 검사는 합성 A/B와 FK 활성 SQLite만 사용했습니다. 모델을 복사한 테스트 schema만 SQLite에 맞췄고 제품 모델은 바꾸지 않았습니다. PostgreSQL lock 의미를 입증하지 않습니다.
- 기존 개발 fixture는 명시적 auth OFF/rate OFF 환경에서 실행했습니다. 보안 테스트는 자체 ON을 설정합니다. 운영 auth OFF 권고가 아닙니다.
- 실제 RSA 서명 검사에는 공식 Supabase SDK를 사용했습니다. JWKS 조회만 합성 키로 대체했으며 verifier/서명 방어를 mock하지 않았습니다.
- mobile 검사는 커밋 source의 Node VM/fake HTTP/storage/adapter입니다. 기존 `mobile/node_modules`를 archive junction으로 재사용했고 clean install이나 실제 기기 검증은 하지 않았습니다.
- 신규 부하 검사는 시나리오당 24회, 최대 8 thread입니다. 실제 OpenAI 비용/운영 쓰기/외부 Auth 요청은 없습니다.

## 실행 결과

| 검사 | 이번 실행 결과 | 범위 |
| --- | --- | --- |
| Working tree 전체 backend | 801 실행, 795 PASS, 6 FAIL, 0 ERROR | 기존 786 PASS + 신규 15개 중 9 PASS/6 FAIL |
| Security suite | 150 실행, 144 PASS, 6 FAIL | account 20/admin 44/surface 15/auth config 8/privacy 24/rate 24 기존 검사 통과 |
| 커밋 source 기존 backend | 446 실행, 439 PASS, 7 import ERROR | 미추적 fixture 없이 전체 회귀 재현 불가 |
| 커밋 source 신규 공격 | 15 실행, 9 PASS, 6 FAIL | 반례가 미커밋 제품 수정 때문이 아님 |
| 커밋 source mobile | 96/96 PASS | VM 검사이며 기기 검증 아님 |
| TypeScript | archive/working tree PASS | 기존 의존성 재사용 |
| Syntax/FastAPI import/mapper | PASS | 외부 연결 증거 아님 |
| Alembic source | 단일 head `20261006_0020`, 0019 → 0020 연결 | DB current/check/upgrade/downgrade NOT_RUN |
| git diff --check | PASS | 기존 CRLF 경고는 whitespace 오류 아님 |

초기 harness의 이벤트 루프 차단과 개발 fixture 환경 불일치는 검증 환경 오류로 분리하고 재실행했습니다. 신규 limiter의 초기 API 인자 오류도 바로잡았습니다. 방어 기대값은 약화하지 않았으며 제품 반례 6개는 실패 테스트로 보존했습니다.

## Route Inventory와 대조군

57개 APIRoute의 method/path/중첩 dependency 전체는 RESULTS JSON에 있습니다.

- `/`, `/db-health`: 공개 health. safe 503 검사는 mock이며 실제 DB 성공이 아닙니다.
- `/internal/background-probe`: 기본 OFF/404. 새 진단 route를 열지 않았습니다.
- `/auth/bootstrap`: 외부 identity 검증 dependency. 나머지 Core/Memory/Agent/domain/admin/account/AI는 principal dependency입니다.
- 54개 비공개/non-probe route entry에 유효 UUID path와 위조 admin header를 보내도 미인증은 401, DB dependency 실행 0입니다. docs/probe 기본 404도 확인했습니다.
- 실제 B Memory/Evidence를 B는 200으로 조회하고 A는 404, 내용/근거 비노출 및 row 수 불변입니다.
- 자신의 Action confirm/execute/reject 성공과 타인의 동일 작업 차단을 함께 확인했습니다. 차단에서는 executor 미호출과 상태/attempt 불변을 검사했습니다.
- signature/claims 검사와 identity 전달을 대체한 HTTP ownership 검사는 서로 다른 층입니다. 후자는 실제 OAuth E2E 성공 증거가 아닙니다.

## Findings

### SEC119-001: 늦은 chat/Memory 저장 (HIGH, 로컬 재현)

- 위치: `backend/chat_persistence_service.py:320`, `backend/memory_reconciliation_service.py:156`.
- 전제: 활성 계정에서 context/extraction lease를 얻은 작업이 Phase A 후, purge 전에 반환됩니다.
- 최소 재현: authenticated chat 시작 → deactivate → complete_chat_request; extraction lease → deactivate → REINFORCE.
- 기대: 비활성 계정에 새 assistant Message/Evidence를 쓰지 않음.
- 실제: assistant Message commit과 REINFORCE Evidence 추가 성공.
- 피해: 삭제 요청 후 데이터가 추가되어 purge 지연/실패 시 남을 수 있습니다. 삭제 완료 신뢰성이 약해집니다. purge 후 late chat의 계정/데이터 재생성 차단은 통과했습니다.
- NEW/SUPERSEDE의 create_memory 경로에는 활성 사용자 검사 코드가 있지만 실제 삭제 경합은 미검증입니다.
- 권장 범위: 별도 작업에서 최종 저장 transaction의 활성 owner 재검증/삭제 fencing과 PostgreSQL lock 순서/경합 검사. AI 호출 동안 장기 lock을 잡는 해결책은 피합니다.

### SEC119-002: 늦은 Agent 결과 확정 (MEDIUM, 로컬 재현)

- 위치: `backend/agent/executor_service.py:141`.
- 전제/재현: lease 획득 → deactivate → `_finish_success`.
- 기대/실제: 비활성 계정 완료 반영 금지 / 동일 attempt이면 completed와 result commit.
- 피해: 삭제 경계 이후 작업 상태/결과가 진행됩니다. **domain Tool 실행/새 domain row 쓰기를 입증한 테스트는 아닙니다.**
- 권장 범위: 삭제 fencing 작업에 Action finalize 포함을 검토하되 attempt fencing은 유지합니다.

### SEC119-003: 422 입력 원문 반사 (LOW, 로컬 재현)

- 위치: `backend/chat_storage_schemas.py:56`, 일반 `backend/chat_storage_router.py` validation.
- 전제/재현: 인증 사용자가 자기 messages API의 invalid role에 합성 비밀을 입력.
- 기대/실제: 안전한 422 / input 필드에 marker 반사.
- 피해: caller 입력이 응답/응답 로그에 복제될 수 있습니다. 타인 데이터/실제 token 유출을 입증하지 않았습니다.
- 권장 범위: account/admin의 안전 validation과 일반 API 정책 일관성 검토. 상태 코드는 유지합니다.

### SEC119-004: project fallback 예외 logging (MEDIUM, 로컬 재현)

- 위치: `backend/main.py:1491`.
- 전제/재현: project provider 함수만 합성 marker 포함 예외로 대체하고 실제 fallback branch 실행.
- 기대/실제: 안전한 종류/code logging / 예외 marker stdout 반사. fallback reply는 정상입니다.
- 피해: provider 오류의 요청/비밀 정보가 log reader에게 노출될 수 있습니다. 실제 provider 요청은 없습니다.
- 권장 범위: 별도 raw exception log sanitation과 다른 문자열 formatting 위치 검토.

### SEC119-005: credential privacy 우회 (MEDIUM, 로컬 재현)

- 위치: `backend/memory_privacy.py:18`, `backend/memory_privacy.py:58`.
- 재현: 정상 목표/관계 및 명시 credential/제3자 진단 대조군 후 비밀번호 label을 글자별로 띄운 합성 진술.
- 기대/실제: 자동 Memory 제외 / STANDARD로 허용.
- 피해: 휴리스틱은 완전한 민감정보 장벽이 아닙니다. 실제 LLM extraction/외부 전송까지 증명하지는 않습니다. 원문 저장/전송과 Memory 정책도 별개입니다.
- 권장 범위: 제한적 정규화와 false-positive 대조군을 별도 검증. 완전 탐지를 주장하지 않습니다.

### SEC119-006: 커밋 test fixture 누락 (MEDIUM, archive 재현)

- 위치 예: `run_supabase_auth_tests.py:23`, `run_security_rate_limit_tests.py:20`, `run_auth_principal_tests.py:17`, `run_chat_background_observability_tests.py:17` (모두 backend/evals).
- 의존: 미추적 `evals.run_lv4_shadow_mode_tests` → 미추적 `run_lv4_relationship_calibration_tests` 및 하위 Lv4 fixture.
- 기대/실제: 커밋만으로 테스트 import 가능 / auth principal, endpoint probe, background observability, chat probe, security rate limit, shadow dispatch tail, Supabase auth의 7개 module import 실패.
- 피해: working tree PASS만으로 CI/커밋 보안 회귀 재현성을 보장하지 못합니다. 제품 FastAPI import는 성공했습니다.
- 권장 범위: 최소 공통 fixture를 별도 승인 작업에서 분리합니다. unrelated Lv4 전체 stage는 금지합니다.

## 잔여 위험과 NOT_RUN

- AuthGate 로그아웃은 local session clear만 하며 provider signout/revoke 요청을 하지 않습니다. 기존 access JWT 즉시 무효화를 구현했다고 주장할 수 없습니다. local 비활성 mapping은 신규 접근/pending purge bootstrap을 차단합니다.
- [Supabase session 문서](https://supabase.com/docs/guides/auth/sessions)는 엄격한 로그아웃 후 차단에 session_id의 서버 존재 확인을 설명합니다. 외부 문서만 조회했습니다. changelog markdown은 도구 content-type 제한으로 읽지 못했습니다.
- purge 후 기존 유효 provider identity로 명시적 bootstrap하면 새 local UUID가 생깁니다. 기존 데이터 복원이 아니며 새 namespace를 씁니다. fresh reauthentication을 요구하지 않는 정책은 잔여 위험입니다.
- 모바일 VM은 늦은 refresh/login, A/B 전환, OAuth callback, native 실패/우회 금지, legacy 미배정, wipe 실패/late write를 검사합니다. 실제 기기/다른 기기/백업 삭제는 미검증입니다.
- 삭제 응답 유실은 client에서 완료를 확정하지 않는 모호한 결과입니다. 서버 비활성화와 기기 정리는 별개이고 local 데이터가 남을 수 있습니다.
- OWNER full read는 허용된 정책입니다. 탈취 시 읽기 피해가 크고 MFA/재인증은 미검증입니다. SECURITY break-glass actor/scope/target/expiry/revoke 및 audit insert/commit 실패는 SQLite에서 검사했습니다.
- 실제 PostgreSQL의 OWNER 동시 삭제, 관리자 읽기/철회/삭제 경합, NEW/SUPERSEDE/9개 domain 늦은 finalize 경합은 **NOT_RUN**입니다. 전용 테스트 DB가 없으며 운영 임시 schema+rollback도 금지했습니다.
- limiter의 verified UUID budget/token 교체/group 교차/bucket 용량/동시 소비/header spoof는 로컬 검사입니다. NAT shared peer와 user budget은 다릅니다. 고정 창 burst/프로세스 재시작/multi-worker 독립 counter는 구조 한계이며 live proxy peer trust는 NOT_RUN입니다.
- CORS는 브라우저 응답 접근 정책이지 HTTP 방화벽이 아닙니다. 비허용/무 origin 요청도 인증을 요구한다는 기준입니다.
- text/history/message content의 byte-level request cap과 fleet 비용/동시 실행 cap은 확인되지 않았습니다. 큰 payload 폭격은 하지 않았습니다.
- 악성 모델 출력의 schema/registry/ownership/confirmation은 deterministic 코드 경계 검사입니다. 실제 LLM prompt injection 내성 전체는 NOT_RUN입니다.
- live migration current/drift/0019/0020 적용 여부는 미확인입니다. source chain 확인은 live DB 검사가 아닙니다.

## 재실행과 보존

```powershell
cd C:\noie\backend
python evals/run_security_adversarial_verification.py --backend-root . --suite attacks
python evals/run_security_adversarial_verification.py --backend-root . --suite security
python evals/run_security_adversarial_verification.py --backend-root . --suite baseline
```

현재 제품 반례 때문에 exit 1이 예상됩니다. 실패 테스트를 skip하거나 기대값을 취약 동작으로 바꾸지 않습니다.

최초 tracked/untracked 375개 SHA256은 모두 유지했습니다. appStyles/LV4_SPEC/미추적 Lv4와 unrelated 변경을 보존했습니다. 새 파일은 감사 runner/공격 tests/문서/RESULTS JSON뿐입니다. stage/commit/push/migration/운영 요청은 없었습니다.

11.10 release gate에서 live/device/proxy/backup/migration을 별도로 검증해야 합니다. 이 문서는 운영 배포 승인이 아닙니다.
