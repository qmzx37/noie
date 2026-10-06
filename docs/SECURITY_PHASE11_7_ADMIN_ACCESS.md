# Security Phase 11.7: Admin Access / Break-glass / Audit Log v0.1

## 기준과 현재 상태

- 기준 HEAD: `bcd9c83` (Memory Privacy 11.6). 기존 722-test 계약을 보존합니다.
- 감사 결과 관리자 authority나 ownership bypass는 없었습니다. `admin_view`는 감정 분석 점수 응답 이름입니다. Message.role은 채팅 작성자 구분이며 관리자 role이 아닙니다.
- 기존 JWT 검증 -> AuthIdentity -> AuthPrincipal 흐름은 그대로입니다. 관리자 권한은 검증된 **local user UUID + NOIE DB grant**로만 결정합니다.
- email/display name/provider/client metadata/body/query/header의 role은 권한이 아닙니다.
- 일반 `/memories/{id}`, conversation/messages 등 ownership 코드는 수정하지 않았습니다. 관리자도 다른 사용자 자원은 기존 404입니다.
- Auth OFF의 dev-user fallback은 `/admin`에 적용되지 않습니다. verified Principal이 없으면 401이며 audit를 생성하지 않습니다.

## Role matrix

| Role | 계정 summary | OWNER 직접 원문/도메인 읽기 | 비상 읽기 발급/사용/철회 | Audit 조회 |
| --- | --- | --- | --- | --- |
| support_admin | 가능 | 금지 | 금지 | 금지 |
| security_admin | 가능 | 금지 (원문은 Break-glass 필요) | 가능 | 가능 |
| owner | 가능 | 가능 (Break-glass 불필요, 감사 필수) | 가능 | 가능 |
| 일반 사용자 | 금지 | 금지 | 금지 | 금지 |

OWNER has audited read access to user-owned data through explicit admin APIs. OWNER status does not bypass ownership checks on ordinary user APIs.

OWNER provisioning은 operator-only CLI로 관리합니다. HTTP self-promotion/grant 편집 endpoint는 없습니다. CLI 실행 권한은 서버/DB 운영 접근권이며, HTTP의 OWNER role이 서버 CLI 접근권을 자동으로 부여하지 않습니다. initial OWNER는 운영자가 정확한 local UUID를 확인한 뒤 명시적으로 부여합니다.

## 새 DB 구조

### admin_grants

UUID id, user_id -> users RESTRICT, role, is_active, created_at, revoked_at.
UNIQUE(user_id, role), role allowlist CHECK, active/revoked_at 일관성 CHECK.
같은 role 재부여는 기존 행을 재사용합니다. 철회는 is_active=false와 revoked_at 기록이며 삭제하지 않습니다.

### admin_break_glass_sessions

UUID id, admin_user_id/target_user_id -> users RESTRICT, scope, reason_code, case_reference, created_at, expires_at, revoked_at.
scope는 memory_read/conversation_read만 허용합니다. reason은 user_support_request/security_incident/account_recovery/other만 허용합니다.
created_at/expiry는 timestamptz이며 expires_at > created_at CHECK가 있습니다. 각 user FK 조회 index를 추가했습니다.
기본 TTL 600초, 최대 900초입니다. API/service에서 1~900초만 허용하고 초과 요청은 거부합니다. DB의 expiry CHECK는 양의 시간만 강제하고 900초 상한은 application 계약입니다.

### admin_audit_logs

UUID id, actor_user_id nullable, actor_kind(user/operator), target_user_id nullable, action, resource_type/id nullable, outcome, reason_code/case_reference nullable, created_at.
actor/outcome/action/reason에 CHECK allowlist를 사용합니다. created_at/id, actor/created_at, target/created_at index를 둡니다.
audit UUID 참조에는 FK를 두지 않았습니다. 미존재 대상 접근 기록과 향후 계정 purge 뒤 역사적 기록을 보존하기 위함입니다. grant/session FK는 RESTRICT입니다. 향후 lifecycle 작업에서 audit 보존 기간/식별자 처리를 별도로 정해야 합니다.

case_reference는 선택적인 `CASE-` + 최대 12자리 숫자만 허용합니다. 자유 reason/email/private text 입력을 허용하지 않습니다. 개인 식별번호를 case로 재사용하지 않는 것은 운영자 책임입니다.

## API 계약

- `GET /admin/users/{user_id}/summary`: 정확한 UUID 한 건의 id, active/inactive, created_at, 활성 conversation 수, active Memory 수만 반환합니다. 이름/email/provider subject/metadata/content/evidence는 제외합니다. 전체 사용자 목록은 없습니다.
- `POST /admin/break-glass`: target_user_id, scope, reason_code 필수. ttl_seconds 기본 600, case_reference 선택. active target만 허용하며 발급 + audit를 같은 transaction으로 commit합니다.
- `POST /admin/break-glass/{session_id}/revoke`: 발급한 관리자 본인만 철회할 수 있습니다. 반복 철회는 idempotent합니다. 만료/이미 철회된 허가도 철회 응답을 재사용할 수 있습니다.
- `GET /admin/break-glass/{session_id}/users/{user_id}/memories/{memory_id}`: 특정 active Memory + 기존 evidence 원문. metadata는 반환하지 않습니다. legacy의 다른 사용자/삭제된 대화 evidence가 섞이면 전체 응답을 404로 차단합니다.
- `GET /admin/break-glass/{session_id}/users/{user_id}/conversations/{conversation_id}/messages`: 특정 활성 대화 원문. limit 기본 50/최대 100, offset 0~100000. created_at ASC, id ASC로 정렬합니다.
- `GET /admin/audit-logs`: security_admin/owner만 허용. limit 기본 50/최대 100, offset 0~100000, 최신 created_at/id 순서. audit 테이블만 읽으며 원문 테이블 join은 없습니다. 조회 자체를 audit합니다.

인증 email/token/provider subject와 임의 metadata는 반환하지 않습니다. 관리자 request validation 오류도 고정 문구이며 입력값을 echo하지 않습니다. UI, Agent 실행, Memory/domain 변경, 계정 설정 변경 기능은 없습니다. grant/session/audit 보안 bookkeeping만 새로 씁니다.

## OWNER Full Read 보충 정책

다음 경로는 active OWNER grant만 허용하며 Break-glass session을 요구하지 않습니다. SECURITY_ADMIN과 SUPPORT_ADMIN은 직접 원문 경로를 사용할 수 없습니다.

- `GET /admin/users/{user_id}/memories/{memory_id}`: active Memory 및 해당 사용자 소유 활성 대화의 evidence 원문.
- `GET /admin/users/{user_id}/conversations/{conversation_id}`: 활성 대화 정보.
- `GET /admin/users/{user_id}/conversations/{conversation_id}/messages`: 원문 메시지, 기본 50/최대 100건, created_at ASC/id ASC.
- `GET /admin/users/{user_id}/records/{record_type}`: emotion, daily, dream-goal, schedule, place, body, cognitive, recommendation, relationship 중 하나. 기존 response schema의 필드만 사용하고 사용자별 최신 created_at/id 순으로 기본 50/최대 100건을 반환합니다.

각 조회는 검증된 Principal -> active local user/OWNER grant 재검사 -> 명시적 target UUID와 실제 resource/evidence 소유자 확인 -> payload 직렬화 -> audit INSERT/commit -> 반환 순서입니다. 실패한 audit는 고정 503이며 private payload를 반환하지 않습니다. 잘못된 소유자/없는 자원은 동일한 404입니다. 삭제된 대상/대화 및 inactive Memory는 기존 정책처럼 제외합니다. 도메인의 conversation/message/action 참조도 대상 소유인지 확인합니다.

대화/도메인 metadata는 extractor_version/version/record_kind/pipeline/evidence_basis의 알려진 운영 코드만 허용합니다. 임의 JSON, 내부 추천 context dump, 인증정보는 제외합니다. Memory metadata는 반환하지 않습니다. 사용자 목록/전체 DB dump, 사용자 impersonation, 수정/삭제/실행 기능은 없습니다. 독립 Project DB 테이블이 없으므로 프로젝트 관련 읽기는 저장된 Dream/Goal 및 project Memory에 한정합니다. 모바일 로컬 프로젝트 데이터는 노출하지 않습니다.

OWNER A도 일반 사용자 API에서 B의 Memory/대화에 접근하면 기존 404입니다. SECURITY_ADMIN의 원문 읽기는 기존 Break-glass target/scope/expiry/revocation 검사를 그대로 거칩니다. OWNER grant 철회 후 다음 요청부터 직접 읽기가 차단됩니다. role은 명시적인 DB provisioning만으로 부여하며 self-promotion은 없습니다.

공개 출시 전 Privacy Policy에 운영자/OWNER의 사용자 데이터 접근 가능성, 목적, 감사 및 통제 정책을 명확히 공개해야 합니다. 이 문서는 개인정보처리방침을 대체하지 않습니다.

## 비상 읽기 경계

1. 기존 JWT/identity verifier가 AuthPrincipal을 확인하고 기존 user rate limit을 적용합니다.
2. 현재 active local user + active DB grant를 재검사합니다. SUPPORT는 여기서 차단됩니다.
3. session은 발급 관리자 본인에게 묶이며 활성/미만료/미철회여야 합니다.
4. session의 target 및 scope는 고정입니다. 다른 대상/다른 resource는 없는 자원과 같은 404입니다. 만료/철회/wrong scope는 403입니다.
5. target user와 요청 resource/evidence의 ownership/활성 상태를 확인합니다.
6. whitelist response를 먼저 직렬화합니다.
7. audit INSERT + commit이 성공해야만 payload를 반환합니다.

grant와 session은 읽기 시 짧은 DB lock으로 검증하고 내부 ORM 캐시도 갱신합니다. grant 철회는 이후 요청부터 차단됩니다. 이미 승인되어 진행 중인 응답을 소급 회수하는 기능은 아닙니다. 외부 API/OpenAI 호출이 없어 lock 중 네트워크 업무 호출을 하지 않습니다.

inactive target은 신규 발급/비상 읽기에서 404로 처리합니다. 운영 summary만 inactive 상태를 알 수 있습니다. soft-deleted conversation/Memory, non-active Memory는 비상 원문 조회에서 제외합니다. 삭제 정책 전체와 purge 구현은 11.8 범위입니다.

## Audit와 fail-closed

action allowlist:
admin_summary.read, break_glass.create/revoke, memory.break_glass_read, conversation.break_glass_read, audit_log.read, admin_grant.provision/revoke, owner.memory.read, owner.conversation.read, owner.record.read.
outcome: success/denied/not_found/failed.

내용이 아니라 누가/어느 대상/어떤 자원/어떤 action/outcome에 접근했는지만 저장합니다. token/email/subject/Authorization/IP/원문/Memory/evidence/민감 category를 저장하거나 로그 출력하지 않습니다.

authenticated 업무 접근의 성공과 role/session/scope/target 거부는 audit합니다. 초기 401, 422 validation, rate limit 429 등 business boundary 전 거절은 audit row를 만들지 않습니다. 무인증 요청으로 무제한 감사 DB를 만들지 않습니다.

audit INSERT/commit 실패는 rollback + 고정 503입니다. 먼저 읽은 private payload도 반환하지 않습니다. 허가 발급/철회/provisioning의 보안 write도 audit와 같은 transaction이므로 감사 실패 시 함께 rollback합니다. audit DB 자체가 불능이면 그 실패를 동일 DB에 durable 기록할 수 없으며 대신 접근을 차단합니다.

SQLAlchemy commit/rollback 경계는 [공식 Session 설명](https://docs.sqlalchemy.org/en/20/orm/session_basics.html#framing-out-a-begin-commit-rollback-block)을 따릅니다. API audit update/delete 기능은 없지만 DB owner/superuser 및 DB credential을 가진 코드의 직접 변조를 막는 tamper-proof storage는 아닙니다.

## Provisioning

DB 연결 가능한 operator 환경에서만 다음을 실행합니다. 인증 토큰/email/service-role key는 입력하지 않습니다. 실제 값 대신 placeholder를 표기합니다.

```powershell
cd C:\noie\backend
python -m scripts.grant_admin_role --user-id <LOCAL_NOIE_USER_UUID> --role owner --reason-code security_incident --case-reference CASE-123
python -m scripts.grant_admin_role --user-id <LOCAL_NOIE_USER_UUID> --role security_admin --reason-code security_incident
python -m scripts.grant_admin_role --user-id <LOCAL_NOIE_USER_UUID> --role security_admin --reason-code security_incident --revoke
```

active local user 존재, 역할 allowlist, 필수 reason code를 검사합니다. local user 자동 생성이나 dev-user fallback은 없습니다. 같은 user 행 lock + UNIQUE로 grant 생성 경쟁을 방어합니다. 성공/거부/미존재 사건을 audit하며 출력은 상태만입니다. 잘못된 CLI 값도 argparse에서 원문 echo하지 않습니다. DB credential 접근은 최고 수준 운영 신뢰 경계로 별도 관리해야 합니다.

## Migration과 적용 상태

- 기존 head/current: `20261005_0018`.
- 새 head: `20261006_0019`; 미적용 신규 migration의 action CHECK에 OWNER 읽기 코드만 추가했으며 0018 이하 migration은 변경하지 않았습니다. 0020은 만들지 않습니다.
- 신규 세 테이블만 추가하며 원본/user/conversation/Memory/AuthIdentity 변경 없음.
- offline upgrade/downgrade SQL 및 모델 column/constraint/index 일치 검사 PASS.
- 실제 PostgreSQL에서는 무작위 임시 schema의 단일 transaction 안에서 upgrade, Alembic compare_metadata(type/default 포함) drift 없음, downgrade를 검사한 뒤 전부 rollback했습니다. 임시 schema 부재를 확인했고 기존 데이터/운영 migration revision은 변경하지 않았습니다.
- 운영 DB의 실제 `alembic current`는 0018입니다. 운영 `alembic check`는 새 0019가 미적용이라 `Target database is not up to date`로 보류됩니다. 운영 check를 통과했다고 주장하지 않습니다.
- downgrade는 보안 허가/감사 데이터를 삭제합니다. 정상 운영에서 실행하지 말고 보존/백업 정책을 먼저 검토해야 합니다.

사용자가 배포 시 직접 실행할 명령:

```powershell
cd C:\noie\backend
python -m alembic current
python -m alembic upgrade head
python -m alembic current
python -m alembic check
```

이후 정확한 local UUID로 OWNER를 provisioning하고 verified token을 사용하는 별도 운영 canary로 summary/허가/읽기/audit를 확인합니다. 이번 작업은 production /chat/OpenAI/Auth 요청, 실제 grant 발급, 운영 schema upgrade를 실행하지 않았습니다. 환경변수/secret 값도 변경하지 않았습니다.

## 검증

- 새 관리자 테스트 **44 PASS**: 기존 33개와 OWNER 보충 11개. 권한 위조, role matrix, TTL/reason, target/scope, 만료/철회, 원문/evidence, 감사 INSERT/commit 실패, role 재검증, ORM cache refresh, 일반 ownership 404, CLI, DB CHECK/UNIQUE, pagination, rate limit, model/migration 일치, OWNER 직접 읽기/9개 도메인/잘못된 참조/쓰기 차단을 검사했습니다.
- ATTACK-ADMIN-001~007 전부 합성/mock 테스트에서 차단 확인.
- 보안 집중 검사 **135 PASS**: 관리자 + 기존 Memory Privacy/Auth fail-closed/API surface/rate-limit/ownership.
- 전체 deterministic backend **766 PASS** = 기존 722 + 신규 44. 삭제/skip 없음.
- Python 전체 225개 syntax/FastAPI import/SQLAlchemy mapper PASS.
- mobile `npx tsc --noEmit` PASS. 모바일 변경 없음.
- 기존 파일 358개의 SHA-256 비교: 이번 변경은 main.py/models/__init__.py만. protected appStyles/Lv4 및 기존 unrelated 파일은 동일합니다.
- OWNER 보충 작업 시작 시점 367개 파일과 비교: admin_access_service.py, admin_router.py, admin_audit_log.py, 신규 0019, 관리자 테스트, 이 문서의 6개만 변경했습니다. 기존 11.7 나머지 파일과 appStyles/Lv4/모바일/unrelated 변경은 보존했습니다.
- stage/commit/push 없음. `git diff --check`와 신규 파일 공백 검사를 별도로 수행합니다.

로컬 재현 (backend, 외부 호출 없는 테스트):

```powershell
$env:PYTHON_DOTENV_DISABLED = '1'
$env:DATABASE_URL = ''
$env:OPENAI_API_KEY = ''
$env:NOIE_AUTH_ENABLED = 'false'
$env:NOIE_RATE_LIMIT_ENABLED = 'false'
python -B -m unittest evals.run_security_admin_access_tests
python -B -m unittest discover -s evals -p 'run_*tests.py'
```

## 파일과 남은 debt

신규: models/admin_grant.py, models/admin_break_glass_session.py, models/admin_audit_log.py, admin_access_service.py, admin_router.py, scripts/grant_admin_role.py, evals/run_security_admin_access_tests.py, migrations/versions/20261006_0019_add_admin_access.py (모두 backend), 이 문서.
수정: backend/main.py (router 연결만), backend/models/__init__.py (모델 등록만). 의존성 추가 없음.

남은 작업: 운영 migration/canary, 독립 운영 DB 계정 최소 권한, 관리자 MFA/step-up/이중 승인, 감사 보존/모니터링/반출, DB-level append-only/tamper-evident/WORM, 별도 운영자 신원 체계. CLI의 actor_kind=operator/actor_user_id=NULL만으로 실제 OS 운영자를 식별하는 감사 체계는 완성되지 않습니다.

기존 프로세스별 rate limiter를 재사용합니다. 여러 worker/replica를 통합하는 분산 제한이나 422 감사 폭주 방지 체계는 이번 작업에서 만들지 않았습니다. PostgreSQL schema 검증은 실제였으나 운영 commit/HTTP canary 및 concurrent revoke 경쟁 실험을 수행했다는 뜻은 아닙니다.

다음 Phase는 **11.8 Account Deletion / Data Lifecycle** 하나입니다.
구현/격리 검증 기준 verdict: **SECURITY_11_7_READY**. 운영 활성화 완료나 모든 관리자 접근 위험 해소를 의미하지 않습니다.
