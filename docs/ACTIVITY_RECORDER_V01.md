# Activity Recorder v0.1

## 책임과 실제 연결

Activity는 사용자가 했거나 하고 있다고 **보고한** 활동을 구조화한 데이터입니다. 현실 수행을 독립적으로 검증한 사실이나 습관/의미/인과 추론이 아닙니다. Message 원문은 source of truth이며 변경하지 않습니다.

이번 구현의 실제 저장 경로:

기존 Orchestrator Daily Record -> Tool Gateway -> AgentAction persistence -> 공통 Executor lease/fencing -> `record_daily_trace_executor` -> optional Activity Recorder -> Daily/Activity transaction commit -> 기존 finalize.

새 Agent, Tool registry, direct write API, queue, LLM 호출 또는 별도 실행 framework는 만들지 않았습니다. 기존 Daily Tool이 실행된 경우에만 추가 기록합니다. 모든 user message에 독립적으로 자동 routing하는 기능은 이번 v0.1에 포함되지 않습니다. Daily routing이 누락되거나 해당 action이 실패하면 Activity도 저장되지 않습니다.

Behavior는 행동명과 여섯 status를 해석합니다. Activity는 시간 접두어를 제한적으로 분리하고 기존 `BehaviorSpecialist`를 호출한 후 performed/ongoing만 허용합니다. 명시적인 `끝냈어`, `마쳤어`, `완료했어` 계열 완료 표현만 기존 performed 문형에 연결하며, Behavior 자체의 문형/상태 판단 코드는 바꾸지 않습니다. 이 임시 입력은 메모리 안에서만 사용하고 원래 quote/Message ID/관찰 시점을 별도로 보존합니다.

Lv4 State/Recommendation/Critic/Arbitrator/Shadow, OpenAI context, Memory v1, 모바일은 연결하거나 변경하지 않습니다.

## 최소 저장 구조

`activities`는 다른 domain의 summary와 의미가 다릅니다. 기존 `daily_life_events`는 action별 summary이고, typed 시간·unknown·충돌·Message별 중복 방지를 담는 동등한 컬럼/제약이 없어서 최소 테이블을 추가했습니다.

| 필드 | 의미 |
| --- | --- |
| id | PostgreSQL UUID, ORM uuid4 + DB gen_random_uuid fallback |
| user_id / conversation_id / message_id | 기존 소유자 및 원문 FK, NOT NULL / RESTRICT |
| agent_action_id | 저장을 허가한 기존 Daily Action FK, RESTRICT |
| record_index | 메시지 안의 순서, 0~15 |
| action / status | 행동명, performed 또는 ongoing만 허용 |
| activity_date | 명시적 날짜; unknown이면 NULL |
| start_time / end_time | 사용자가 말한 로컬 clock, TIME WITHOUT TIME ZONE; UTC instant로 오해하지 않음 |
| duration_minutes | 직접 제공 또는 안전하게 계산한 기간; unknown/conflict이면 NULL |
| observed_at | 원문 생성 시점, TIMESTAMP WITH TIME ZONE; 없으면 NULL |
| confidence | 기존 Behavior 값; 현재 v0.1은 NULL, Gateway confidence를 복제하지 않음 |
| metadata | JSONB, default=dict / DB {}; 기존 evidence, version, user_reported, time_issues, 직접/계산 duration |
| created_at / updated_at | timezone-aware; 기존 ORM onupdate=func.now 정책 |

UNIQUE `(message_id, record_index)`로 같은 Message를 여러 action/attempt로 처리해도 한 번만 기록합니다. PostgreSQL `ON CONFLICT DO NOTHING`을 사용하고 충돌 후 소유자/대화도 확인합니다. 기존 Activity를 덮어쓰거나 텍스트 비교로 삭제하지 않습니다. 새 Message ID로 같은 문장을 보낸 것은 새 활동입니다.

index:

- `(user_id, observed_at, id)` 제한된 최신 owner 조회.
- `(message_id, record_index)` UNIQUE가 Message 조회/FK index 역할도 함.
- `conversation_id`, `agent_action_id` FK index.

CHECK: status, 공백 아닌 행동명/500자, record_index, 0~525600분 또는 NULL, 0~1 confidence 또는 NULL, ongoing의 end_time NULL. 새 PostgreSQL ENUM/extension은 없습니다.

## 시간 정책

사용자 추가 승인에 따라 오전/오후 없는 **1~12시 표기는 unknown**으로 남깁니다. '3시'를 15:00으로, '5시'를 17:00으로 추측하지 않습니다. 명시적 오전/오후, 13~23시 또는 HH:MM 24시간 표기만 확정합니다. 한쪽 오전/오후 표기를 다른 쪽에 임의로 복제하지 않습니다.

- start만 있음: end/duration unknown.
- end는 `끝냈어` 완료 표현에 명시된 시각일 때만 확정. 단순 '3시에 운동했어'를 시작 시각으로 만들지 않음.
- 직접 duration만 있음: start/end를 역산하지 않음.
- start/end 둘 다 확정되고 종료가 앞서지 않으면 분 단위 차이 계산.
- 종료가 더 이르면 자동으로 다음 날이라고 가정하지 않고 duration unknown / end_before_start 보존.
- 직접 duration과 계산 duration이 다르면 둘 다 metadata에 보존하고 최종 duration NULL / duration_conflict.
- ongoing은 완료 end나 계산 duration을 만들지 않음. 사용자가 직접 말한 기간은 별도의 reported duration이며 완료 시간이 아님.
- '아침/저녁'만으로 정확한 clock을 만들지 않음.

오늘/어제/지금/방금은 원문의 aware observed_at과 기존 `NOIE_SCHEDULE_TIMEZONE` 설정을 사용하는 `schedule_time_context`로 해석합니다. 이 설정 또는 관찰 시점이 없으면 날짜도 unknown입니다. PC timezone/현재 조회 시간으로 채우지 않습니다. 날짜가 없는 보고는 관찰 날짜를 활동 날짜로 자동 복제하지 않습니다. 명시적 ISO 날짜는 직접 제공한 날짜로 읽으며 잘못된 날짜/상충 날짜는 unknown으로 표시합니다. 상대 '내일' 수행 보고는 future_activity_date로 보존하고 확정 날짜를 만들지 않습니다. '내일 운동할 거야'는 intended여서 Activity가 없습니다.

## 예제

| 발화 | 결과 |
| --- | --- |
| 15시부터 17시까지 NOIE 개발했어 | NOIE 개발 / performed / start 15:00 / end 17:00 / 120분; 날짜는 미제공이면 unknown |
| 3시부터 5시까지 NOIE 개발했어 | performed / clock와 duration unknown / ambiguous_clock |
| 오늘 운동했어 | performed / 날짜는 관찰 시점+설정 zone의 오늘 / clock·duration unknown |
| 2시간 공부했어 | performed / 120분 / start·end unknown |
| 오후 5시에 운동 끝냈어 | performed / end 17:00 / start·duration unknown |
| 오후 5시에 공부 완료했어 | performed / end 17:00 / start·duration unknown; 과거 ongoing 기록은 수정하지 않음 |
| 공부 마쳤어 | performed / 날짜·clock·duration unknown; 완료했다는 사용자 보고이며 현실 수행 검증이 아님 |
| 지금 NOIE 개발하고 있어 | ongoing / 완료 end·계산 duration 없음 |
| 15시부터 17시까지 3시간 개발했어 | 직접 180분, 계산 120분, 최종 NULL / duration_conflict |

## 안전성 / privacy

기존 User-first active-account lock과 Daily Action status/attempt_count row lock을 통과한 동일 Executor transaction 안에서만 저장합니다. 원문 작성자, user role, 활성 conversation, action/message/conversation 소유권을 다시 확인합니다. OpenAI 호출은 추가하지 않으며 DB lock 중 외부 호출도 없습니다.

Activity SQL 실패는 rollback하고 기존 Executor가 고정 예외 종류로 failed 처리합니다. 이 action의 Daily/Activity unit만 취소하며 이미 commit된 user Message나 다른 domain 성공을 취소하지 않습니다. finalize 실패 후 retry는 UNIQUE 기록을 재사용하고 오래된 attempt는 기존 Daily fencing에서 차단합니다.

기존 Memory privacy 감지 정책을 재사용하며 민감한 원문, 타인 보고, 인용, 가정, 수행 여부 질문은 활동으로 승격하지 않습니다. raw text/evidence/UUID/DB 오류를 새 로그에 출력하지 않습니다. 읽기 응답은 metadata/provenance/Message ID/owner ID를 제외합니다.

Activity가 새 개인정보 테이블이므로 기존 계정 lifecycle `PURGE_ORDER`에 명시적으로 추가했습니다. 평상시 FK는 RESTRICT이며, 기존 명시적 자기 계정 purge에서만 child-before-parent 순서로 함께 제거합니다. 타 계정 행은 보존하고 cross-account FK는 기존 purge 검증으로 거부합니다. 새로운 삭제 API는 없습니다.

## Owner-only read API

- `GET /activities?limit=50`: 검증된 현재 principal의 활동만; limit 1~100, observed_at DESC NULLS LAST / id DESC.
- `GET /activities/{activity_id}`: 본인 활성 근거만; 다른 사용자/없는/삭제된 근거는 동일한 404.

새 API는 user_id 입력을 받지 않으며 Auth OFF 상태에서도 익명 dev-user fallback을 하지 않습니다. raw evidence는 반환하지 않고 구조화된 활동, known/NULL 시간, confidence, 고정 time_issues code만 반환합니다. DB/저장 contract 이상은 원문 없는 503입니다. 기존 API request/response는 그대로입니다.

## Migration / 활성화 순서

새 이력은 `20261006_0020 -> 20261008_0021`입니다. upgrade는 activities와 해당 constraint/index만 추가하며 기존 데이터 변경/backfill이 없습니다. downgrade는 Activity 데이터를 제거하므로 파괴적이며 자동 실행하지 않습니다.

이번 작업에서는 실제 PostgreSQL/Render/OpenAI/Auth 요청, 실제 migration 또는 운영 환경변수 변경을 하지 않았습니다. 운영 배포 전에는 다음을 사용자가 별도로 검증해야 합니다.

1. DB 백업과 현재 revision 확인. 기존 account purge를 포함한 새 코드 배포 전에 0021 schema가 준비되어 있어야 함.
2. 기존 DATABASE_URL을 안전하게 설정한 본인 환경에서 실행:

```powershell
cd C:\noie\backend
alembic current
alembic upgrade head
alembic current
alembic check
```

3. 현재 v0.1 Recorder는 `NOIE_ACTIVITY_RECORDER_ENABLED` **기본 OFF**. 미설정/오타도 OFF. ON 값은 1/true/yes/on(대소문자/공백 허용).
4. 분리된 테스트 계정에서 기존 Daily Tool의 Gateway/Action/Executor로 저장·조회·duplicate·rollback·동시 요청·재시작 후 보존을 실제 PostgreSQL에서 확인한 후에만 활성화. 이 작업은 자동으로 flag를 설정하거나 배포하지 않음.
5. 상대 날짜가 필요하면 기존 명시적 IANA `NOIE_SCHEDULE_TIMEZONE` 설정을 확인. 계정별 timezone 시스템은 구현하지 않음.

Activity read route는 flag와 별개로 등록되므로 미적용 DB에는 503을 반환합니다. 다른 기존 reply/저장/flag 기본값은 그대로입니다.

## 로컬 검증 (2026-10-08)

| 검사 | 결과 |
| --- | --- |
| Activity 구조화 | 40/40 PASS |
| Activity 저장/소유권/보안/SQL migration | 33/33 PASS |
| Backend deterministic | 1264/1264 PASS, failure/error/skip 0 |
| Security deterministic | 460/460 PASS, failure/error/skip 0 |
| Mobile auth/storage | 96/96 PASS |
| `npx --no-install tsc --noEmit` | PASS |
| Python syntax / FastAPI import / SQLAlchemy mapper | PASS |
| model/migration column/type/default/FK/CHECK/index 비교 | PASS |
| Alembic offline SQL / single head | PASS, head 20261008_0021 |
| `git diff --check` | PASS; 기존 LF/CRLF 안내는 오류가 아님 |

전체 suite는 기존 `run_security_adversarial_verification.py`의 `--suite baseline`과 `--suite security` 격리 runner로 실행했습니다. 외부 네트워크 및 실제 PostgreSQL을 차단하며 실제 ORM 합성 SQLite와 실제 Gateway/Executor를 실행했습니다. 실제 PostgreSQL row lock/race, live migration drift/DB health/운영 routing 의미 품질은 이번 결과에 포함되지 않습니다.

## 이번 변경 파일

기존 파일 최소 수정:

- `backend/agent/record_daily_trace_executor.py`: 검증된 transaction 안에서 flag ON일 때 optional 기록.
- `backend/agent/router.py`: 두 read route 연결.
- `backend/models/__init__.py`: 모델 등록.
- `backend/account_lifecycle_service.py`: 삭제 inventory 한 항목 추가.

신규 파일:

- `backend/agent/activity_schemas.py`
- `backend/agent/activity_recorder.py`
- `backend/agent/activity_service.py`
- `backend/agent/activity_router.py`
- `backend/models/activity.py`
- `backend/migrations/versions/20261008_0021_add_activities.py`
- `backend/evals/run_activity_recorder_tests.py`
- `backend/evals/run_security_activity_recorder_tests.py`
- 이 문서.

## 개발 재개: 명시적 완료 보고 (2026-10-09)

- 기존 `끝냈어` 외에 `마쳤어` / `완료했어`와 해당 `다` / `어요` / `습니다` 어미를 지원합니다. Activity 내부 입력만 기존 performed 문형으로 연결하며 원문과 Behavior Specialist는 변경하지 않습니다.
- 기존 Daily Action이 실제로 실행되고 Recorder flag가 ON인 경우에만 저장합니다. routing, flag 기본값, DB/API 계약, migration 0021은 변경하지 않습니다.
- 새 완료 Message는 독립 보고입니다. 과거 ongoing 행을 완료로 바꾸거나 종료 시간/기간을 역산하지 않습니다. 부정, 질문, 의도, 인용, 타인 보고와 민감한 원문은 기존 경계를 유지합니다.
- 신규 테스트 12개(구조화 7 / 저장·보안 5), Activity 전체 85/85(47 + 38), working-tree Backend deterministic 1451/1451 PASS; failure/error/skip 0.
- Python syntax 284개 / FastAPI import / SQLAlchemy mapper / TypeScript / `git diff --check` PASS. 기존 0021 모델·migration 비교 및 offline SQL도 PASS.
- 결과는 현재 working tree의 합성 SQLite/Mock 검증입니다. clean commit 재현이나 실제 PostgreSQL/Render/OpenAI 검증·운영 배포 승인이 아닙니다. stage/commit/push/deploy와 실제 migration은 실행하지 않았습니다.

## Lifecycle v0.1: 사용자 확인 기반 완료 연결 (2026-10-09)

- `link_activity_completion` 한 기능만 추가합니다. 기존 Daily 자동 기록, 원문, Activity 상태 및 시간 필드는 변경하지 않습니다. 같은 행동명은 호환성 검사일 뿐 자동 연결 기준이 아닙니다.
- 기존 `/agent/tool-plan` -> `/agent/actions/plan` -> `/agent/actions/{action_id}/confirm` -> `/agent/actions/{action_id}/execute` 계약을 재사용합니다. arguments에는 정확한 `ongoing_activity_id`와 `completion_activity_id`만 넣습니다. type은 `daily_life`, intent는 `link_activity_completion`, mode는 `execute`입니다. Gateway가 확인을 강제합니다.
- 서버는 사용자/Conversation/Message와 정확한 대상 쌍의 hash를 Action metadata에 저장합니다. 동일 Action ID에서 대상이 바뀌면 충돌이며, 새 대상은 새 Action과 사용자 확인이 필요합니다. hash는 인증 대체물이 아닙니다.
- 활성 계정의 동일한 활성 Conversation에 속한 기록만 연결합니다. 원본 user Message, 기록한 Daily Action의 소유권, 저장된 분석과 원문의 일치 여부를 다시 검사합니다. 명시적 완료가 아닌 수행/부정/질문/의도 보고는 거부합니다.
- 기존 완료 Activity의 `metadata.activity_completion_link`만 추가합니다. 필드는 `version`, `ongoing_activity_id`, `completion_activity_id`, `basis=user_confirmed`, `confirmation_action_id`, `confirmation_id`, `confirmed_at`입니다. 이는 사용자 확인에 따른 연결 근거이지 실제 수행을 관찰했다는 증명이 아닙니다.
- User/Action과 UUID 정렬 순서의 두 Activity를 짧은 transaction에서 잠급니다. 같은 쌍은 재사용하고, 하나의 ongoing에 다른 완료 기록을 연결하거나 완료 기록의 대상을 바꾸는 요청은 거부합니다. 손상된 metadata/승인 근거는 fail-closed이며 실패 시 rollback합니다.
- 기존 Executor의 lease/retry/fencing을 유지합니다. domain commit 후 finalize 유실 시 다음 attempt는 이미 저장된 연결을 재사용합니다. 외부 호출, 새 테이블, migration 또는 의존성은 추가하지 않습니다. Recorder flag가 OFF이면 실행하지 않습니다.
- 합성 SQLite/Mock의 Lifecycle 보안 검사 42개와 기존 Activity 85개가 PASS했습니다. 실제 Gateway/Action 확인/Executor HTTP 계약, 타 계정 403, 중복/충돌, rollback/retry/stale attempt, 원문·unknown 시간 보존과 무로그 계약을 포함합니다.
- 최종 working-tree Backend deterministic 1493/1493 PASS, failure/error/skip 0. Python syntax 288개, FastAPI import, SQLAlchemy mapper, TypeScript 및 `git diff --check` PASS. clean commit 재현이나 운영 배포 승인과 구분합니다.
- 동시 요청 검사는 테스트용 직렬화 장치로 경합 결과를 검증하며 PostgreSQL row lock의 실제 증거가 아닙니다. PostgreSQL용 `FOR UPDATE` SQL 및 결정적 잠금 순서는 검사했습니다. 실제 PostgreSQL 동시 연결/격리 수준/재시작 검증은 별도 미완료입니다.
- 기존 Activity 조회 응답은 내부 연결 metadata를 노출하지 않습니다. 사용자 선택 UI, 자동 대상 탐색, 연결 조회 API 및 Lv4 연결은 이번 범위에 없습니다. JSONB의 연결에는 DB FK/UNIQUE가 없으므로 관리 SQL 등 service를 우회한 쓰기의 무결성은 보장하지 않습니다.

## Known Limitations / REVIEW_LATER

- 기존 Behavior의 제한된 행동명/문형만 지원. 시간 접두어가 있는 복합 행동은 범위를 여러 행동에 복제하지 않고 보류.
- date/clock은 사용자 보고 해석이며 실제 수행 시간 검증이 아님. timezone 없는 상대 날짜, 모호한 시각, 자정 넘김/복합 날짜는 추가 확인 필요.
- 확인된 정확한 쌍의 연결만 지원합니다. 자동 lifecycle 추론/병합은 미구현이며 새 Message는 별도의 보고로 보존합니다.
- 원문 Message별 record_index는 v0.1 분석 순서에 고정. 향후 parser 버전 변경 시 재처리/충돌 정책 별도 검토 필요.
- 자동 Daily routing의 비결정성은 그대로이며 이를 고치려고 Activity 전용 Agent/prompt/framework를 추가하지 않음.
- 실제 PostgreSQL 동시 경합/재시작 및 최소 live canary는 다음 승인된 검증 단계에서 실행 필요.
- Activity -> Lv4 adapter는 별도 다음 단계. 이번에는 추천/Pattern/Meaning/World Model 기능 없음.

판정: **ACTIVITY_RECORDER_V01_PASS** (로컬 구현·검증 범위). production migration/활성화/배포 승인이 아닙니다. stage/commit/push/deploy는 수행하지 않았습니다.
