# Security Phase 11.8: Account Deletion / Data Lifecycle v0.1

## Scope and authority

기준 HEAD는 `560d21f`입니다. 사용자 삭제는 명시적 `POST /account/delete`만 수행하며 verified AuthPrincipal.user_id가 유일한 대상입니다. body/query/header user_id, dev-user fallback, OWNER cross-user purge는 허용하지 않습니다. 기존 CORS GET/POST 정책을 확장하지 않기 위해 DELETE /account와 동등한 POST 명령 경로를 사용합니다.

입력은 `{"confirmation":"DELETE_MY_NOIE_ACCOUNT"}` 하나이며 extra field는 422, query parameter는 400입니다. 입력 오류는 원문을 echo하지 않습니다. Auth OFF에서 Principal이 없으면 401입니다. 성공 응답은 HTTP 202 `{"status":"deletion_requested"}`이며 완전 삭제 완료를 뜻하지 않습니다. 마지막 활성 OWNER는 409로 거부합니다.

`GET /account`는 verified 자기 계정의 local user UUID 한 건만 반환합니다. 사용자 목록/타 계정 ID 입력/자동 bootstrap은 없습니다. 이는 mobile namespace의 계정 incarnation을 구분하기 위한 읽기 경계입니다.

## Changed files

신규 8개:
- backend/account_lifecycle_service.py
- backend/account_router.py
- backend/scripts/purge_deleted_accounts.py
- backend/evals/run_security_account_deletion_tests.py
- backend/migrations/versions/20261006_0020_add_account_deletion_audit.py
- mobile/src/auth/accountDeletion.ts
- mobile/src/features/auth/AccountDeletionControl.tsx
- docs/SECURITY_PHASE11_8_ACCOUNT_DELETION.md

기존 7개에 최소 변경:
- backend/main.py (router 연결만)
- backend/models/admin_audit_log.py (0020 action CHECK)
- backend/evals/run_security_admin_access_tests.py (0019 + 0020 최종 모델 비교)
- mobile/src/auth/accountIdentity.ts (검증된 local 계정 incarnation)
- mobile/src/noie/accountStorage.ts (계정별 queue/tombstone/purge)
- mobile/src/features/auth/AuthGate.tsx (명시적 삭제 control 연결)
- mobile/tests/accountStorage.test.cjs (기존 fixture 보존 및 lifecycle 회귀)

367개 기존 파일의 SHA-256 비교에서 위 7개만 변경했습니다. appStyles/Lv4/0019 및 다른 unrelated 변경은 동일하며 stage/commit/push는 하지 않았습니다. 새 dependency는 없습니다.

## Complete persistent inventory

SQLAlchemy metadata의 21개 테이블을 감사했습니다. 아래 순서는 실제 FK를 기준으로 고정합니다. 코드와 테스트가 전체 inventory를 비교하며 새 미검토 테이블이 추가되면 deactivate/purge를 fail closed합니다. ORM delete cascade에 의존하지 않고 명시적 Core SQL로 삭제합니다.

| Table | User FK | Conversation / Message / Memory / Action FK | ON DELETE | Soft delete | Purge order / class |
| --- | --- | --- | --- | --- | --- |
| memory_evidence | 없음 | memory_id, message_id | RESTRICT | 없음 | 1 / A |
| memory_extractions | 없음 | message_id, memory_id, matched_memory_id | RESTRICT | 없음 | 2 / A |
| body_state_events | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 3 / A |
| cognitive_state_events | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 4 / A |
| daily_life_events | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 5 / A |
| dream_goals | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 6 / A |
| emotion_events | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 7 / A |
| place_events | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 8 / A |
| recommendations | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 9 / A |
| relationship_events | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 10 / A |
| schedules | user_id | conversation_id, message_id, agent_action_id | RESTRICT | 없음 | 11 / A |
| chat_requests | 대화 경유 | conversation_id, user_message_id, assistant_message_id | RESTRICT | 없음 | 12 / A |
| agent_actions | user_id | conversation_id, message_id | RESTRICT | 없음 | 13 / A |
| messages | user_id nullable | conversation_id | user SET NULL, conversation RESTRICT | 없음 | 14 / A |
| memories | user_id | supersedes_memory_id 자기 참조 | RESTRICT | deleted_at/status | 15 / A |
| conversations | user_id | 없음 | RESTRICT | deleted_at | 16 / A |
| admin_break_glass_sessions | admin_user_id, target_user_id | 없음 | RESTRICT | revoked_at (허가 철회) | 17 / C |
| admin_grants | user_id | 없음 | RESTRICT | revoked_at/is_active | 18 / C |
| auth_identities | user_id | 없음 | RESTRICT | 없음 | 19 / B |
| users | 없음 | 없음 | 해당 없음 | deleted_at | 20 / A |
| admin_audit_logs | FK 없는 역사적 UUID | FK 없는 resource UUID | 해당 없음 | 없음 | 보존 / D |

| Class | Policy |
| --- | --- |
| A USER PRIVATE DATA | 비활성 계정의 원문, Memory/Evidence, caches, 추출 결과 및 9개 도메인을 전부 purge |
| B AUTH MAPPING | Phase A에는 유지, Phase B에서 User 직전에 제거 |
| C ADMIN ACCESS STATE | Phase A에 grant 및 대상/발급자 Break-glass 철회; Phase B에 제거 |
| D SECURITY AUDIT HISTORY | 최소 감사 행 별도 보존; 역사적 UUID는 남을 수 있음 |
| E EXTERNAL PROVIDER DATA | Supabase Auth 계정/토큰/외부 provider 로그 삭제는 미구현 |
| F DEVICE LOCAL DATA | 현재 검증된 account v2/v1 namespace의 7개 private key 제거; 다른 계정은 보존 |

Memory의 supersedes 자기 참조는 같은 삭제 계정의 행에서만 먼저 NULL 처리하고 같은 transaction 안에서 제거합니다. 다른 계정의 evidence/원문/도메인 등이 삭제 부모를 참조하거나 삭제 링크가 타 계정 부모를 참조하면 `CROSS_ACCOUNT_REFERENCE`로 전체 purge를 중단합니다. 다른 사용자 데이터에 cascade/SET NULL을 강행하지 않습니다. 이상 참조는 운영자가 별도로 조사해야 합니다.

## Two-phase transaction and recovery

Phase A: PostgreSQL transaction advisory lock으로 동시 OWNER 삭제를 직렬화 -> User FOR UPDATE -> 마지막 OWNER 검사 -> deleted_at 설정 -> grant 및 양쪽 Break-glass 철회 -> account.delete.request 감사 -> commit. 감사 실패도 비활성화를 rollback합니다. 기존 User/AuthIdentity 활성 검사 덕분에 이후 새 protected 요청과 bootstrap는 차단됩니다. 이미 실행 중인 OpenAI 호출을 중단하거나 응답을 소급 회수하는 기능은 아닙니다.

Phase B: 별도 세션/transaction -> deleted User FOR UPDATE -> inventory/교차 계정 검사 -> child-to-parent purge -> account.delete.purge 감사 -> commit. 중간 SQL/감사/commit 실패는 hard delete 전체 rollback이며 Phase A는 유지됩니다. User가 이미 없으면 안전한 no-op, active User는 purge 금지입니다. row lock은 같은 계정의 purge 재시도를 직렬화하며 FK는 삭제 완료 뒤 늦게 돌아온 worker의 고아 저장을 차단합니다. 외부 서비스 호출 중 lock을 보유하지 않습니다.

BackgroundTasks는 best-effort 실행일 뿐 durable queue 또는 삭제 완료 보장이 아닙니다. 실패 로그는 고정 `account_purge retry_required`만 사용합니다. 프로세스 종료/실패 후 복구 경로는 operator-only CLI이며 정확한 한 계정 UUID만 받습니다.

```powershell
cd C:\noie\backend
# 운영자가 비활성 계정임을 확인한 후 명시적으로 실행; 현재 작업에서는 실행하지 않음
python -m scripts.purge_deleted_accounts --user-id <DEACTIVATED_NOIE_USER_UUID>
```

마지막 OWNER 삭제 전 다른 active User에게 operator CLI로 OWNER를 부여해야 합니다. HTTP self-promotion/교차 계정 삭제 경로는 없습니다. 운영 CLI의 의도적 grant 철회/재배치는 별도 운영 권한이며 self-service 마지막 OWNER 보호가 이를 통제하는 기능은 아닙니다.

## Device lifecycle and no resurrection

verified Supabase `/user`와 NOIE `GET /account`가 모두 성공해야 앱이 mount됩니다. 새 namespace는 SHA256(`noie.account-local.v2:<provider UUID>:<local NOIE UUID>`)이며 외부 identity로 재가입해도 새 local UUID의 namespace는 달라집니다. v1 데이터를 새 v2로 자동 이전하지 않습니다. 기존 로그인 계정의 화면에서 옛 v1 데이터가 보이지 않는 호환성 변화가 있으므로 배포 전 사용자 안내가 필요합니다.

삭제 202 확인 뒤 같은 로그인 세대의 Auth session을 clear하고, 현재 v2와 검증된 해당 provider의 v1 alias만 정리합니다. 삭제 버튼의 stale A handler는 B 세션으로 요청할 수 없고, 늦은 A 응답이 B 세션을 clear하지 않습니다. private storage 작업은 namespace별 직렬화하며 purge 뒤 새 저장을 거부합니다. `deleted_v1` tombstone을 먼저 저장해 앱 재시작 후에도 삭제 namespace 사용을 차단합니다.

대상 key: chats/sessions, current chat id, traces, daily long records, dream torch, projects, project messages. 다른 account namespace/global auth와 무소유 legacy global key는 이 purge로 제거하지 않습니다. auth credential는 기존 SecureStore/Web session clear 경계에서만 처리합니다.

기기 저장 실패 또는 SecureStore 삭제 실패는 완료로 숨기지 않고 정리 실패를 알립니다. 실패한 tombstone write도 현재 프로세스의 메모리 차단과 새 incarnation 분리를 유지하지만 디스크의 물리 제거를 보장하지 않습니다. 다른 기기의 사본/백업은 원격 삭제하지 않습니다. 업데이트된 client는 NOIE 활성 계정 검사와 incarnation 분리로 옛 namespace를 다시 mount하지 않습니다. 이전 버전 client와 무소유 legacy 데이터는 별도 배포/기기 정리 정책이 필요합니다.

네트워크 timeout은 서버 삭제 rollback의 증거가 아닙니다. 확인되지 않은 접수를 성공으로 표시하지 않으며 사용자는 다시 로그인해 상태를 확인하고 필요하면 기기 앱 데이터를 정리해야 합니다.

## Audit, external systems and retention

감사 action은 account.delete.request/account.delete.purge입니다. 원문, 이메일, OAuth subject, token, DB URL은 기록하지 않습니다. purge 감사는 operator actor_kind와 역사적 target UUID만 남기며 FK가 없어 User 제거 후에도 보존됩니다. 감사 내용을 삭제해 downgrade를 통과시키지 않습니다.

현재 backend에 Supabase admin account deletion/service-role capability가 없으므로 새 secret나 외부 provider 삭제 기능을 도입하지 않았습니다. NOIE application data deletion과 Supabase authentication identity deletion은 다릅니다. local mapping이 제거된 뒤 동일 provider identity의 명시적 bootstrap는 새 NOIE 계정을 만들 수 있지만 옛 데이터는 복원하지 않습니다. Supabase access/refresh token 자체의 폐기까지 완료했다고 주장하지 않습니다. [Supabase 공식 계정 관리 문서](https://supabase.com/docs/guides/auth/managing-user-data)는 provider 삭제와 JWT 만료의 차이를 설명합니다.

DB hard delete는 live application rows에 대한 삭제입니다. 감사 historical UUID, DB 백업/WAL/replica/운영 로그/다른 기기 사본은 별도 retention 대상입니다. 법적 erasure compliance 전체를 달성했다는 의미가 아닙니다. 공개 전 감사·백업 보존 기간, 삭제 SLA/재시도 모니터링, provider backend-only 삭제, 사용자 고지/Privacy Policy를 정해야 합니다. incident/legal hold는 구현하지 않았습니다.

## Migration and verification

0019는 변경하지 않습니다. 0020은 admin_audit_logs action CHECK만 확장합니다. upgrade는 기존 감사 행과 원문 테이블을 변경하지 않습니다. downgrade는 새 삭제 audit가 남아 있으면 constraint 검증에 실패하여 transaction이 취소됩니다. 운영 데이터 삭제로 downgrade를 강행하지 마세요.

운영 DB는 0018이고 0019/0020을 이 작업에서 적용하지 않습니다. 운영 Alembic check는 target not up to date가 예상되므로 통과했다고 주장하지 않습니다. 배포와 삭제 API 활성 사용 전에 운영자가 별도로 검토/백업 후 migration을 적용해야 합니다.

배포 순서는 운영자 검토/백업 -> backend 0019/0020 적용 및 새 `/account` 경로 배포 확인 -> mobile v2 namespace 배포입니다. 기존 backend에 먼저 새 mobile을 배포하면 `/account` 404로 private 앱 진입이 fail closed됩니다. v1 local 데이터는 자동 이동하지 않으므로 이 호환성 변화와 기기 정리 정책을 먼저 고지해야 합니다.

```powershell
cd C:\noie\backend
python -m alembic current
# 운영자 실행용, 이번 작업에서 운영 DB 적용 금지
python -m alembic upgrade head
python -m alembic check
```

검증은 합성 계정/FK-enabled SQLite와 mock를 사용하며 실제 사용자/Render 삭제 요청이나 OpenAI/Auth 외부 호출은 하지 않습니다. 삭제 확인/권한/마지막 OWNER/철회/기존 토큰 및 pending bootstrap 차단/전체 도메인 purge/rollback/retry/교차 계정 보호/재가입 분리/지연 기기 저장을 검사합니다. 전체 deterministic suite, syntax/import/mapper, migration 정적/격리 검증, TypeScript와 diff 검사 결과는 완료 보고에 구분합니다.

완료된 검증:
- 삭제 전용 backend 20개 PASS, 전체 backend 786개 PASS. 기존 관리자 44개를 포함하며 skip/기대값 완화 없음.
- mobile 전체 96개 PASS. 기존 87개와 새 lifecycle 9개이며 provider/local identity 분리, v1 alias 정리, 지연 저장, 새 B 계정 보호, 기기 정리 실패를 검사했습니다.
- Python 230개 syntax, FastAPI import, mapper/전체 21-table inventory, TypeScript, diff/신규 파일 공백 검사 PASS.
- offline 0020 upgrade/downgrade와 실제 PostgreSQL 임시 schema의 0019 -> 0020 모델 비교/type/default 검증 PASS.
- 실제 PostgreSQL 합성 계정의 마지막 OWNER, 9개 도메인/requests/extractions/evidence purge, 실패 rollback, retry/no-op, B 보존, audit retention PASS. 새 삭제 audit가 있는 downgrade는 행 삭제 없이 안전하게 실패했습니다.
- 모든 PostgreSQL 격리 DDL/합성 데이터는 외부 transaction에서 전부 rollback했고 임시 schema 부재를 확인했습니다. 운영 revision 0018과 실제 사용자 데이터는 변경하지 않았습니다.

초기 임시 schema 비교는 복사 MetaData에 naming convention이 없어 UNIQUE 이름 3개가 달라 실패했습니다. 원래 naming convention을 보존하도록 검증 fixture만 수정하고 재검증했습니다. 운영 스키마를 고치거나 기존 0019를 재작성하지 않았습니다.

별도 미실행: 운영 HTTP 삭제 canary, 실제 multi-process 동시 OWNER 삭제/purge 경쟁, 대용량 부하 및 기기 LIVE 검증. 동시성 방어 코드/실제 PostgreSQL 잠금 SQL은 확인했지만 실운영 경쟁 검증까지 완료했다고 주장하지 않습니다. 대량 UUID는 Python 목록 대신 소유권 subquery로 처리해 bind parameter 한도를 피합니다. 공개 출시 전 삭제 SLA, 운영 CLI 복구 절차, 이전 client 업데이트/기기 사본 정책을 확정해야 합니다.

```powershell
$env:PYTHON_DOTENV_DISABLED = '1'
$env:DATABASE_URL = ''
$env:OPENAI_API_KEY = ''
$env:NOIE_AUTH_ENABLED = 'false'
$env:NOIE_RATE_LIMIT_ENABLED = 'false'
python -B -m unittest evals.run_security_account_deletion_tests
python -B -m unittest discover -s evals -p 'run_*tests.py'
cd C:\noie\mobile
node --test tests/*.test.cjs
npx tsc --noEmit
```

명시적인 격리 PostgreSQL 재검증 명령 (DB의 임시 schema 생성 권한 필요, 운영 revision 변경 없음):

```powershell
cd C:\noie\backend
python -B -u -m evals.run_security_account_deletion_tests --postgres-isolated
```

기존 Memory/Agent/Lv4 동작, 보호 파일, 0019는 변경하지 않습니다. 이번 첨부는 21번 끝에서 종료되어 제공되지 않은 이후 요구사항은 검증 완료로 취급하지 않습니다.
