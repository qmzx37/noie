# Security Phase 11.9.1: Post-Deactivation Write Protection

- 날짜: 2026-10-07
- 기준 HEAD: `e779520967c51e9051556f198a285c1538af15f3`
- 검증 대상: 기존 미추적 파일을 포함한 `C:\noie` working tree
- 판정: **SECURITY_11_9_1_PARTIALLY_VERIFIED**
- `release_approved = false`
- 운영 요청, 실제 OAuth/OpenAI/DB 연결, migration, stage/commit/push: 하지 않음

## 쉬운 설명

1. 계정을 비활성화한 뒤에도 먼저 시작했던 답변/기억/Agent 작업이 돌아와 결과를 저장할 수 있었습니다. 삭제 버튼 클릭이 아니라 Phase A transaction의 commit이 기준입니다.
2. 이제 최종 저장 transaction에서 원래 User 행을 먼저 잠그고 DB의 활성 상태를 다시 확인합니다. 검사를 통과한 transaction이 끝날 때까지 삭제가 먼저 commit할 수 없도록 합니다.
3. 기존 늦은 chat, REINFORCE evidence, Agent finalize 세 공격 테스트가 같은 기대값으로 FAIL에서 PASS로 바뀌었습니다.
4. 범위 밖 기존 공격 실패 3개는 그대로입니다. 실제 PostgreSQL 두 connection 경합 검증도 아직 하지 못했습니다.
5. 다음 최우선 작업은 명시적으로 승인된 별도 테스트 PostgreSQL에서 두 transaction의 commit 순서와 lock timeout을 검증하는 것입니다. 현재 결과는 운영 보안 승인이나 배포 승인이 아닙니다.

## 수정 전 재현

기존 `run_security_adversarial_tests.py`와 검증 실행기, 기존 11.9 보고서/RESULTS JSON을 변경하지 않았습니다.

| Finding | 기존 테스트 (`OwnershipAttackTests`) | 수정 전 | 수정 후 |
| --- | --- | --- | --- |
| SEC119-001 | `test_late_chat_finalize_after_deactivation_must_not_write` | FAIL | PASS |
| SEC119-001 | `test_late_reinforce_after_deactivation_must_not_add_evidence` | FAIL | PASS |
| SEC119-002 | `test_late_agent_finalize_after_deactivation_must_not_complete` | FAIL | PASS |

수정 전 동일 격리 실행기의 attacks는 15개 중 9 PASS/6 FAIL/0 ERROR, 전체 working-tree discover는 801개 중 795 PASS/6 FAIL/0 ERROR였습니다. 실패 6개를 독립 취약점 6개로 간주하지 않습니다. SEC119-001에 두 실패가 대응합니다.

수정 전 정상 대조군 및 기존 회귀는 같은 전체 실행에서 통과했습니다. 수정 후에는 실제 FK 활성 SQLite에서 active chat 원문/응답/duplicate, Memory NEW/REINFORCE/SUPERSEDE, Daily domain 저장/Agent 완료를 추가 대조했습니다.

### 원인과 transaction 경계

- `complete_chat_request`: User 원문 저장과 별도인 응답 저장 transaction에서 ChatRequest만 잠그고 assistant/응답 JSON을 commit했습니다. 시작 시의 User 검증은 최종 저장을 보호하지 못했습니다.
- `apply_reconciliation`: extraction/Memory 잠금과 attempt fencing은 있었으나 REINFORCE evidence 및 최종 reason 저장에 User lifecycle 잠금이 없었습니다. NEW/SUPERSEDE의 단순 active 조회도 조회 이후 삭제 commit과 경합할 수 있었습니다.
- `executor_service._finish_success`: Action attempt만 일치하면 result/completed를 저장했습니다. 개별 domain executor도 Action을 먼저 잠근 뒤 active User를 단순 조회했으므로 같은 TOCTOU 위험이 있었습니다.
- 기존 삭제/purge는 User `FOR UPDATE`를 먼저 잡았습니다. 이 잠금에 참여하는 결과 저장 경계가 필요했습니다.

## 최종 저장 규칙

새 `account_write_guard.py`는 다음 계약만 제공합니다.

1. User의 `id`, `deleted_at` 컬럼을 직접 읽습니다. ORM identity map에 이미 들어 있는 User 객체를 판단 근거로 사용하지 않습니다.
2. `db.no_autoflush` 안에서 검사하여 pending 개인정보가 검사보다 먼저 자동 flush되지 않도록 합니다.
3. PostgreSQL에서는 `SELECT ... FOR SHARE`로 원래 User를 잠급니다. 활성 여부 조회와 결과 쓰기/commit은 같은 transaction입니다.
4. helper가 성공할 때 commit하지 않습니다. 잠금은 호출자의 commit/rollback/session close까지 유지됩니다.
5. missing/deleted이면 pending 변경을 rollback하고 거부합니다. DB 검사 예외도 rollback합니다. 이 경우 기존 개인정보 저장 경로로 fallback하지 않습니다.
6. transaction-local `lock_timeout = '3s'`를 설정합니다. 삭제/purge도 같은 대기 한도를 사용합니다. 이 변경은 LLM timeout이나 lease/retry 설정 변경이 아니며 자동 재시도를 추가하지 않습니다.

`FOR SHARE`는 User의 비활성화 UPDATE 및 삭제의 `FOR UPDATE`와 충돌합니다. `FOR KEY SHARE`는 일반 non-key UPDATE를 막지 못하므로 사용하지 않습니다. 이 동작은 [PostgreSQL row locking 문서](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)에 근거한 설계이며 실제 두 connection 검증과는 구분합니다. `SET LOCAL lock_timeout`은 [PostgreSQL client defaults 문서](https://www.postgresql.org/docs/current/runtime-config-client.html)를 참조했습니다.

### 잠금 순서

```text
입력/lease 준비 -> 짧은 transaction 종료 -> 외부 생성
-> User FOR SHARE -> ChatRequest / Extraction / Action / Memory 잠금
-> 결과/근거/domain 쓰기 -> commit

비활성화: 기존 owner advisory lock -> User FOR UPDATE -> 권한 철회/감사 -> commit
purge: User FOR UPDATE -> 기존 child-to-parent 삭제 -> 감사 -> commit
```

User 보호 잠금을 이미 가진 transaction에서 Memory 생성 helper가 같은 User 잠금을 다시 요청하는 것은 다른 User나 새로운 transaction을 만드는 것이 아닙니다.

설계상 두 순서:

- writer가 먼저 User 보호 잠금을 얻으면 저장 commit/rollback이 먼저 끝나고 삭제 commit이 그 뒤에 옵니다. timeout이면 삭제 요청은 실패하고 rollback합니다. 실패한 삭제를 성공으로 표시하지 않습니다.
- 삭제가 먼저 commit하면 뒤늦은 writer는 inactive를 확인하고 결과를 저장하지 않습니다. purge가 먼저 끝났으면 User/부모 행을 다시 만들지 않습니다.

`database.py`는 isolation level을 명시하지 않습니다. 운영 DB의 실제 isolation 설정은 접속하지 않았으므로 확인하지 않았습니다. PostgreSQL 기본 READ COMMITTED에서는 대기 후 변경된 행을 읽고, REPEATABLE READ/SERIALIZABLE에서는 변경 충돌이 발생할 수 있으므로 예외를 성공으로 처리하지 않습니다. 실제 배포 설정 검증은 남아 있습니다.

### 적용한 경로와 오류 동작

- chat 시작: 원래 local user를 확정한 뒤 User 잠금을 획득합니다. bootstrap 내부 commit 이후에도 새 저장 transaction에서 다시 검사합니다. guard 장애는 legacy dev fallback으로 우회하지 않습니다.
- chat 완료: 원래 User와 Conversation/ChatRequest/Message 연결을 검증한 뒤 assistant, cache/checkpoint 응답 JSON을 한 번에 commit합니다. `/chat`은 `reject_unsafe_response=True`로 호출하며 거부 시 안전한 403만 반환합니다. 생성 reply/checkpoint를 반환하거나 Memory/Agent/Shadow를 후속 등록하지 않습니다.
- 기존 내부 boolean 호출은 실패 시 False를 유지합니다. 외부 응답 처리자인 main은 명시적인 거부를 사용합니다. DB 미설정의 기존 dev-only 무저장 진입 경로 자체를 새 인증 기능으로 바꾸지는 않았습니다.
- chat 실패 정리: User -> request 순서와 Conversation 소유권을 확인하고 기존 processing 행의 status만 failed로 만듭니다. payload를 추가하거나 사라진 request를 만들지 않습니다.
- Memory lease, 수동 Memory/evidence, NEW/REINFORCE/SUPERSEDE, no-memory reason, 실패 경로를 보호합니다. extraction-message-owner 연결도 최종 확인합니다. inactive 계정의 실패 처리에서 예전 private 결과를 성공처럼 반환하지 않습니다. inactive extraction은 기존 processing 상태로 남을 수 있으나 신규 lease 진입에서 차단되고 purge 대상입니다.
- Agent plan/arguments, confirmation, lease, 9개 domain executor, 공통 성공/실패 finalize, 추천 context snapshot 저장을 보호합니다. 계획 저장이 이미 commit된 후 context를 쓰는 경우 새 transaction에서 User를 다시 잠급니다.
- inactive Agent의 **현재 attempt**에는 예외적으로 기존 행에 failed/`account_inactive`, result=NULL, lease 해제를 기록합니다. 개인 payload는 추가하지 않습니다. stale attempt는 새 attempt를 취소하지 못합니다. 내부 거부 표식은 ORM 비영속 속성이며 public execute 경로는 안전한 오류를 반환합니다.
- 작업 ID는 기존 local User/Message/Action UUID를 유지합니다. 외부 identity를 다시 조회하여 재가입 User에게 재연결하지 않습니다.

## 실행한 검증

운영 `.env`는 로드하지 않았습니다. 기존 격리 실행기가 인증/DB/OpenAI 관련 환경을 비우고 dotenv, 외부 HTTP/소켓, psycopg 연결을 차단한 뒤 import합니다. 테스트 데이터는 FK 활성 합성 SQLite입니다. 외부 생성 결과만 mock하고 실제 deactivation/guard/저장 서비스는 실행했습니다.

| 검사 | 이번 실제 결과 |
| --- | --- |
| 수정 전 attacks | 15개, 9 PASS / 6 FAIL / 0 ERROR |
| 수정 후 원래 attacks | 15개, 12 PASS / 3 FAIL / 0 ERROR |
| 신규 lifecycle 검사 | 23개, 23 PASS |
| 전체 working-tree deterministic discover | 824개, 821 PASS / 3 FAIL / 0 ERROR / 0 SKIP |
| Mobile Node 검사 | 96개, 96 PASS |
| TypeScript `tsc --noEmit` | PASS |
| 전체 backend Python AST / FastAPI import / SQLAlchemy mapper | PASS |
| Alembic offline revision inventory | 단일 head `20261006_0020`, migration 변경 없음 |
| `git diff --check` | PASS, 기존 LF/CRLF 변환 경고만 있음 |
| 실제 PostgreSQL 경합/lock timeout/isolation | **NOT_RUN** |
| 실제 Render/외부 OAuth/OpenAI | **NOT_RUN** |

전체 discover 수에는 새 23개와 원래 공격 15개가 포함됩니다. 함수형 실제 PG eval을 discover가 실행한 것으로 계산하지 않습니다. 실제 PG eval은 별도 승인된 테스트 DB가 없어 실행하지 않았습니다.

이번 실행은 **미추적 파일을 포함한 working tree** 대상입니다. 커밋만 추출한 archive 검증을 다시 수행한 결과가 아닙니다. SEC119-006의 archive fixture 누락은 기존 역사적 증거 그대로이며 이번 작업에서 해결하지 않았습니다.

### 새 검증의 주요 범위

- active chat 원문/응답 보존과 request duplicate 재사용.
- active NEW/REINFORCE/SUPERSEDE 및 완료 결과 재사용.
- deactivation 후 위 세 Memory 행동/evidence와 no-memory reason/failure 반환 차단.
- active Agent/Daily 저장, 완료 재호출 fencing.
- deactivation 후 9개 domain 쓰기가 Action 잠금 전에 거부됨.
- 늦은 Agent 결과의 public API 반환 차단, 현재 attempt의 payload-free 실패, stale attempt의 변경 금지.
- 늦은 Orchestrator 계획 저장 거부와 후속 Executor 호출 0.
- 같은 Session에 캐시된 active User가 있어도 DB의 inactive 상태를 읽음. pending Memory INSERT가 guard 전에 실행되지 않음.
- purge 후 동일 외부 identity로 재가입해도 기존 chat/Memory/Agent 작업이 새 User에 저장되지 않음.
- A 비활성화 이후 B의 정상 chat 저장.
- guard DB 오류, commit 직전 오류, 실제 flush 후 rollback. cache/assistant/domain payload가 남지 않음.
- `/chat`이 늦은 reply를 성공으로 반환하지 않고 BackgroundTasks를 등록하지 않음.
- PostgreSQL dialect SQL의 `FOR SHARE`, User -> child -> INSERT 순서 및 3초 설정 확인.
- 순차 save-before-delete / delete-before-save 로컬 확인. 이는 동시 PostgreSQL row lock 증거가 아님.

기존 테스트 두 개는 새 guard의 `no_autoflush`/컬럼 조회를 흉내 내도록 DB double을 확장했습니다. guard를 mock으로 제거하지 않았고 기존 보안 기대값도 바꾸지 않았습니다. 원래 11.9 공격 테스트 파일은 바이트 그대로 보존했습니다.

### 재현 명령

```powershell
cd C:\noie\backend
python evals/run_security_adversarial_verification.py --backend-root . --suite attacks
python -c "from evals.run_security_adversarial_verification import isolate; isolate(legacy_fixtures=True); import unittest; unittest.main(module='evals.run_security_lifecycle_write_tests', verbosity=2)"
python evals/run_security_adversarial_verification.py --backend-root . --suite baseline
cd C:\noie\mobile
node --test tests/auth.test.cjs tests/accountStorage.test.cjs
npx --no-install tsc --noEmit
cd C:\noie
git diff --check
```

attacks와 baseline 명령의 exit code는 범위 밖 세 공격 실패가 남아 있으므로 1입니다. 신규 lifecycle 명령은 0입니다.

## 남은 검증과 한계

실제 PostgreSQL은 명시적으로 승인된 별도 테스트 DB가 없어 **접속조차 하지 않았습니다**. 운영 DB 임시 schema/rollback을 대체 수단으로 사용하지 않았습니다. 다음 검증이 완료되기 전 FIXED_LOCAL 또는 운영 안전을 선언하지 않습니다.

1. 독립 connection 두 개와 Event/Barrier로 Phase A commit -> writer guard 진입을 고정하여 새 payload commit이 없음을 확인.
2. writer의 User FOR SHARE 획득 -> deactivate 대기 -> writer commit -> deactivate commit 순서를 고정하여 역순 commit이 없음을 확인.
3. guard/삭제/purge의 3초 lock_timeout, rollback, 실제 session isolation 및 wait 후 최신 행 상태 확인.
4. 같은 두 순서를 chat, Memory 조정, Agent domain/finalize에 적용하고 최종 데이터 및 attempt fencing 확인.
5. purge/rejoin, A/B 격리와 비정상 종료 후 재시도를 같은 전용 PG에서 검증.

이미 실행된 외부 Tool 부작용을 되돌리는 기능은 구현하지 않았습니다. 이번 경계는 최종 DB 반영이며 HTTP 전송이 이미 시작된 응답을 회수하는 보장도 아닙니다. DB commit 뒤 응답 전송 사이의 계정 삭제를 원자적으로 묶었다고 주장하지 않습니다.

미해결 기존 finding:

- SEC119-003: invalid role의 422 응답에 합성 원문이 반사됨. 기존 실패 유지.
- SEC119-004: project fallback의 예외 원문 logging. 기존 실패 유지.
- SEC119-005: 띄어쓴 password label의 privacy 우회. 기존 실패 유지.
- SEC119-006: committed archive의 미추적 Lv4 fixture 의존성. 이번에는 재실행/수정하지 않음.

## 변경 파일과 보존

신규:

- `backend/account_write_guard.py`
- `backend/evals/run_security_lifecycle_write_tests.py`
- `docs/SECURITY_PHASE11_9_1_LIFECYCLE_WRITE_GUARD.md`

수정:

- `backend/account_lifecycle_service.py`
- `backend/chat_persistence_service.py`
- `backend/chat_storage_service.py`
- `backend/main.py`
- `backend/chat_agent_integration_service.py`
- `backend/memory_service.py`
- `backend/memory_extraction_service.py`
- `backend/memory_reconciliation_service.py`
- `backend/agent/action_service.py`
- `backend/agent/executor_service.py`
- `backend/agent/record_emotion_executor.py`
- `backend/agent/record_daily_trace_executor.py`
- `backend/agent/record_dream_goal_executor.py`
- `backend/agent/create_schedule_executor.py`
- `backend/agent/record_place_event_executor.py`
- `backend/agent/record_body_state_executor.py`
- `backend/agent/record_cognitive_state_executor.py`
- `backend/agent/suggest_recommendation_executor.py`
- `backend/agent/record_relationship_event_executor.py`
- `backend/evals/run_chat_ownership_tests.py`
- `backend/evals/run_security_memory_privacy_tests.py`

작업 전 기존 379개 tracked/untracked 파일의 SHA256과 비교하여 위 21개 이외의 기존 파일 변경이 없음을 확인했습니다. `appStyles.ts`, `docs/LV4_*`, `backend/evals/lv4_*`, `run_lv4_*`, 기존 11.9 보고서/RESULTS/공격 테스트/실행기는 보존했습니다. `.env`, 모델, migration, 모바일, classifier, Shadow 정책은 수정하지 않았습니다. 자동 stage/commit/push를 하지 않았습니다.
