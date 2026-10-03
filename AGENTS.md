# NOIE Development Rules

## 프로젝트와 선택권

- NOIE는 사용자의 일상, 상태, 기억, 목표, 관계를 이해해 선택 비용을 줄이는 개인 AI를 목표로 한다.
- 사용자를 대신해 삶을 통제하지 않는다. 친구 같은 AI이지 잔소리하거나 명령하는 AI가 아니다.
- 최종 선택권은 항상 사용자에게 있다. 현재 구현된 기능과 미래 기능의 명세를 구분한다.
- 수정 전에 실제 코드와 working tree를 읽고 계획을 설명한다. 기존 변경을 덮어쓰거나 재구현하지 않는다.
- 초보자가 이해할 수 있게 한국어 주석과 설명을 작성하고, 실행 가능한 작은 단위로 작업한다.
- 기존 도구와 패턴을 우선하며 불필요한 framework, 의존성, 대규모 리팩터링은 추가하지 않는다.

## 현재 Agent Architecture

Orchestrator -> Tool Gateway -> agent_actions persistence -> Executor -> Domain Tool / DB

- `backend/agent/`: routing, 입력 계약, 정책, action/confirmation persistence, 공통 Executor, 도메인 Tool과 조회 기능.
- `backend/models/`: 원문, Memory와 Evidence, action, 도메인 기록의 SQLAlchemy 모델.
- `backend/chat_agent_integration_service.py`: `/chat`의 저장된 user Message와 Agent 실행 연결.
- `backend/evals/`: 기능, 실제 DB, 장애, 의미 경계와 기존 회귀 검사.
- `backend/migrations/`: Alembic 이력. `docs/`: 구현 전 명세. `mobile/`: 기존 Expo 앱.
- Domain Agent가 Gateway/persistence/Executor를 우회해 업무 DB를 직접 변경하지 않는다.
- registry의 planning 지원과 실제 구현 여부를 구분한다. placeholder를 실행 가능한 Tool로 간주하지 않는다.
- 기존 Memory extraction/reconciliation/retrieval은 별도 흐름이다. 새 도메인이 이를 몰래 우회하거나 재작성하지 않는다.

## 판단 원칙

- 현재 사용자의 명시적 발화 > 과거 Memory. Memory는 근거이지 명령이 아니다.
- 관찰된 사실과 AI 해석을 분리한다. Message 원문은 source of truth이며 수정/요약/정제하지 않는다.
- 도메인 해석과 Memory는 원문과 분리하고 Message 근거를 추적할 수 있게 한다.
- 불확실한 해석을 사실로 저장하지 않는다. 숫자 confidence만으로 근거 없는 사실을 정당화하지 않는다.
- 모르는 상태는 임의로 채우지 않는다. Body/Cognitive의 NULL은 unknown이지 0이 아니다.
- 감정 8축 F/A/D/J/C/G/T/R과 독립적인 like/dislike를 유지한다. 두 관계 점수는 반대값이 아니다.
- 개인 context는 필요한 목적에 필요한 최소 범위만 사용한다. 소유권, 관련성, 시간, 개수 제한을 지킨다.
- 전체 DB/history/Memory dump를 OpenAI로 보내지 않는다. 한 목적의 전송 허가를 다른 도메인으로 확대하지 않는다.
- Recommendation context는 추천 전용이다. 이를 Emotion/Body/Cognitive/Relationship 등의 기록 근거로 쓰지 않는다.
- 현재 Retrieval의 후보 25개, threshold 0.55, Top-K 4와 Evaluation metric을 임의로 변경하지 않는다.

## 행동 모드

- Record: 현재 발화가 충분히 명확히 뒷받침하는 사실 또는 명시적 상태를 해당 도메인 계약으로 자동 기록할 수 있다.
- Suggest: 사용자 선택을 돕는 제안이다. 제안의 기록은 실제 행동 실행이나 사용자 상태 변경이 아니다.
- Execute: 의미 있는 상태 변경에는 사용자 확인이 필요하다. 확인 대기를 자동 승인하지 않는다.
- 추천이 필요하지 않으면 NO_RECOMMENDATION이 가능하다. 단순 보고/확정 결정에 추천을 강제하지 않는다.
- multi-action은 도메인별 근거와 조건을 각각 검증한다. 한 도메인이 다른 도메인의 사실을 만들어내지 않는다.

## 안전한 구현과 데이터

- OpenAI 호출 중 DB transaction/row lock을 유지하지 않는다. 짧은 조회/lease 획득 뒤 세션을 닫고 호출한다.
- 기존 lease/retry/attempt fencing/idempotency를 재사용한다. 이전 attempt가 새 결과를 덮어쓰지 못하게 한다.
- 도메인 쓰기는 독립적이고 안전한 transaction으로 처리한다. 오류 시 rollback하며 예외를 숨겨 성공으로 처리하지 않는다.
- finalize 유실 후 retry는 이미 commit된 도메인 row를 재사용한다. UNIQUE와 충돌 처리를 함께 검토한다.
- 같은 request_id/action은 중복 저장하지 않는다. 같은 텍스트를 새 요청으로 보낸 것은 정상이며 텍스트 비교로 삭제하지 않는다.
- 도메인 실패가 `/chat` 기본 응답이나 다른 도메인의 성공을 rollback하지 않게 한다.
- user ownership, 활성 사용자/대화, 근거 Message의 role과 연결 관계를 서버에서 검증한다.
- client가 보낸 user_id는 인증이 아니다. 개발용 소유권 필터와 실제 인증을 혼동하지 않는다.
- 기존 DB 데이터와 API 호환성을 보존한다. 원본에 대한 임의 삭제, cascade, 자동 병합은 금지한다.
- UUID, timezone-aware timestamp, FK RESTRICT 정책과 기존 naming convention을 우선 재사용한다.
- JSONB의 Python 기본값은 `default=dict`를 사용한다. SQLAlchemy 예약어를 피해 Python 속성은 `metadata_`로 둔다.
- 새 migration은 해당 작업에 명시적으로 포함된 경우에만 만든다. 적용된 migration을 임의로 재작성/재적용하지 않는다.
- 비밀키/비밀번호/DB URL을 코드나 로그에 넣지 않는다. 환경변수로 읽고 사용자 응답에 내부 오류를 노출하지 않는다.
- 기존 OpenAI 기반 분석과 규칙 기반 fallback을 보존한다. 모바일에서 OpenAI를 직접 호출하지 않는다.

## Git과 작업 범위

- 작업 루트는 `C:\noie`다. `C:\llm\frontend\damoye-ui`와 그 backend는 이 프로젝트 작업 대상으로 사용하지 않는다.
- 사용자의 별도 명시적 요청 전에는 commit/push하지 않는다.
- `git reset`, `git clean`, `git restore` 같은 destructive command는 사용하지 않는다.
- 기존 사용자 변경은 유지한다. `mobile/src/styles/appStyles.ts`는 수정/stage/restore하지 않는다.
- backend 작업을 이유로 모바일 UI나 AsyncStorage를 임의로 변경하지 않는다.
- 문서만 요청받았으면 코드/API/DB/migration을 변경하지 않고 문서만 작성한다.

## 검증 원칙

코드/DB 기능을 구현할 때는 범위에 맞춰 아래를 검증한다. 실행하지 못한 검사와 mock/실제 결과를 구분한다.

- 새 기능의 양성/음성 의미 경계, 입력 계약, user isolation, 기존 API 호환성.
- 실제 PostgreSQL 저장/조회, duplicate request/action, concurrency.
- rollback, finalize-loss/reuse, retry, stale worker/attempt fencing.
- 기존 Gateway/Executor/Emotion/Daily/Dream/Schedule/Place/Body/Cognitive/Recommendation/Chat/Memory regression.
- Alembic single head와 drift, Python syntax, FastAPI import, SQLAlchemy mapper.
- `npx tsc --noEmit`과 `git diff --check`. 명령 실행 경로와 결과를 보고한다.
- 테스트 데이터는 표시된 별도 사용자/대화로 분리하며 기존 사용자 데이터를 삭제/수정하지 않는다.
- 전체 테이블 지문을 비교하는 DB 테스트는 다른 쓰기 테스트와 순차 실행한다.
- `/db-health`는 실제 SELECT 1 성공과 mock 성공을 구분한다. import/mock 성공은 실제 DB 연결 증거가 아니다.
- 문서-only 작업은 내용/변경 범위/diff를 검증한다. 이를 이유로 DB 쓰기 테스트나 migration을 실행하지 않는다.

## LLM Tuning Stop Rule

- 의미 테스트의 비결정성 때문에 무한 prompt tuning하지 않는다.
- 일반적인 동일 의미 경계는 최대 약 2회의 수정 후 남은 변동성을 Known Limitation으로 기록한다.
- privacy/access/data corruption/duplication/transaction 문제는 의미 변동성으로 돌리지 말고 반드시 수정한다.
- 검사 실패를 숨기거나 metric/기대값을 바꿔 통과시키지 않는다. 원인, 해결 또는 남은 한계를 보고한다.
