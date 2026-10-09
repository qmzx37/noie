# Activity Lifecycle PostgreSQL verification

## 범위와 안전 계약

- 허용 대상은 로컬 Docker `noie-lifecycle-pgtest`, `127.0.0.1:58704`, DB `noie_lifecycle_test`, user `noie_test`뿐입니다.
- `NOIE_SECURITY_TEST_DATABASE_URL`은 실행한 프로세스의 환경변수만 사용합니다. `.env`, `DATABASE_URL`, 운영 DB fallback은 없습니다. 비밀번호는 채팅/명령 인자/Git에 넣지 않습니다.
- URL query를 모두 거부하여 host/service/options 우회를 막습니다. 다른 host/port/DB/user/driver, 원격 Docker daemon, unhealthy 상태는 거부합니다.
- Docker 이름/ID/상태/포트와 `POSTGRES_USER`/`POSTGRES_DB`를 확인합니다. 비밀번호 설정은 조회하지 않습니다. Docker 내부와 외부 연결의 `pg_postmaster_start_time()`도 비교합니다.
- 기본 실행은 read-only transaction의 SELECT 검사뿐입니다. 전용 DB identity, CREATE 권한, PostgreSQL 13+ builtin UUID 함수, 미사용 격리 스키마 이름을 검사합니다. 스키마 생성/migration/fixture 쓰기는 하지 않습니다.
- 모든 오류 출력은 고정 reason code입니다. URL/비밀번호/raw exception/원문은 출력하지 않습니다.

## 실행 방법

DB URL을 안전한 방법으로 현재 PowerShell 프로세스의 `NOIE_SECURITY_TEST_DATABASE_URL`에 설정한 뒤:

```powershell
cd C:\noie\backend
python -B -m evals.run_activity_lifecycle_pg
```

이 명령은 사전 검사만 수행합니다. URL 미전달 또는 Docker 접근 권한이 없으면 HOLD입니다. 사용자 health/SELECT 1 확인과 실행기의 대상 검증은 별개의 증거입니다.

**이번 준비 단계에서는 아래 쓰기 명령을 실행하지 않습니다.** 사전 검사 통과 및 별도 실행 승인 후:

```powershell
python -B -m evals.run_activity_lifecycle_pg --run-writes --ack-test-writes noie-lifecycle-pgtest
```

## Alembic 격리

- 부모의 환경변수와 `.env`를 바꾸지 않습니다. 자식 프로세스에서 운영 NOIE/DB/OpenAI/Supabase/libpq 설정을 제거하고 dotenv를 비활성화합니다.
- 쓰기 자식에만 검증된 URL을 `DATABASE_URL`로 주입합니다. 일반 운영 `migrations/env.py`는 실행하지 않습니다.
- 전용 `evals/lifecycle_pg_migrations/env.py`가 검증된 연결을 받습니다. 버전 파일만 기존 `migrations/versions`에서 읽습니다. head가 `20261008_0021`이 아니면 자동 진행하지 않습니다.
- 랜덤 `noie_lifecycle_pgtest_<32 hex>` 스키마를 생성하기 직전에 대상을 다시 검사합니다. search_path는 그 스키마 하나이며 public을 포함하지 않습니다. 테이블/enum/`alembic_version` 모두 격리됩니다.
- schema-local 버전 테이블과 실제 revision을 확인합니다. 신규 migration, 기존 revision 수정, downgrade는 없습니다.
- 기존 public/타 스키마 데이터는 쓰지 않습니다. 테스트 스키마는 자동 삭제하지 않고 결과에 이름을 남깁니다. 실패한 경우에도 임의 삭제하지 않습니다.

## 실제 경합 시나리오

각 시나리오는 별도 합성 사용자/Conversation/Message/Activity/확인된 Action을 생성합니다. 기존 Daily/Gateway/Action 확인/Executor를 재사용하고 SDK는 호출하지 않습니다.

1. 같은 ongoing + 서로 다른 completion: 첫 domain transaction을 commit 직전에 보류하고 두 번째 PostgreSQL worker를 진입시킵니다. 실제 `pg_blocking_pids`를 확인한 뒤 첫 commit을 해제합니다. 연결 1개, 후발 충돌을 요구합니다.
2. 같은 쌍 동시 재시도: 별도 승인 Action 두 개가 같은 쌍을 연결합니다. 실제 잠금 대기 후 최초 연결 1개와 후발 재사용, 완료 Action 재호출의 idempotency를 요구합니다.
3. rollback: 첫 worker가 flush 후 commit 전에 고정 합성 오류를 발생시킵니다. 잠금 대기 중인 두 번째 worker가 rollback 이후 연결하고, 첫 Action retry는 같은 연결을 재사용해야 합니다.
4. stale attempt: 별도 connection이 User/Action을 잠그고 attempt 증가 및 lease 만료를 반영합니다. 이전 worker가 실제 잠금 대기 이후 구 attempt로 쓰지 못해야 합니다. 현재 attempt retry만 연결합니다.

worker는 각각 독립된 PostgreSQL 연결을 사용합니다. Python Lock으로 DB 경합을 흉내내지 않습니다. 별도 모니터 연결이 실제 blocking PID를 검사합니다. READ COMMITTED 및 timeout을 고정하고 Session 종료/rollback을 보장합니다.

최종 검사는 사용자별 Activity 행 수, 연결 개수/대상/사용자 확인 근거와 원문·Activity 상태·known/unknown 시간 보존을 포함합니다. 검증되지 않은 실행기 자체를 기존 PASS 숫자로 대체하지 않습니다.

## 준비 단계의 제한

실제 migration/동시성/rollback/stale 테스트는 쓰기 승인 전에는 UNVERIFIED입니다. 안전 조건 unit test와 read-only preflight만으로 운영 배포를 승인하지 않습니다. 새 의존성이나 production 코드 변경은 없습니다.

지정 컨테이너의 이름/healthy/loopback 포트 및 비밀이 아닌 DB/user 설정만 실제 확인했습니다. Codex 프로세스의 테스트 URL은 미전달이라 실행기는 `TEST_URL_MISSING`으로 중단했습니다. DB 접속 fingerprint/권한/스키마 부재 검사는 미실행이며 현재 환경 verdict는 HOLD입니다. 안전 조건 unit test에는 잘못된 CLI 인자의 비밀값 반사 차단도 포함합니다.
