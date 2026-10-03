# Body State v0.1

## 의미

현재 사용자 발화에서 직접 지지되는 신체 상태만 구조화합니다.
센서 측정값, 실제 생리 상태의 확정, 질병 진단, 건강 위험도 평가가 아닙니다.
LLM은 틀릴 수 있으며 Message가 원문 기준입니다.

| 축 | 필드 | 의미 |
| --- | --- | --- |
| FAT | fatigue | 신체 피로 |
| SLP | sleepiness | 졸림 |
| ENG | energy | 현재 신체 활력 |
| HUN | hunger | 배고픔 |
| TEN | physical_tension | 몸의 물리 긴장 |
| DIS | discomfort | 신체 불편/통증 |

값은 0..1입니다. NULL은 미언급/알 수 없음이고 0은 명시적으로 매우 낮음입니다.
모든 축이 NULL인 Event는 만들지 않습니다. 알려진 값 0 하나만 있어도 유효합니다.
피곤함에서 배고픔 등을 보충하지 않습니다. 좋은 기분은 높은 신체 에너지가 아닙니다.
심리적인 발표 긴장은 몸의 물리 긴장과 다릅니다.
의욕/집중/정신적 복잡함을 Body 축으로 바꾸지 않습니다.
현재 발화를 과거 Memory보다 우선하며 타인/미래/과거에만 해당하는 상태는 제외합니다.
질병/의료 판단, 센서, wearable, 추천, Cognitive/Human Simulator 연결은 없습니다.

## 저장과 실행

record_body_state는 body_state/record, 확인 불필요, 구현된 Tool입니다.
routing/인자 confidence 중 낮은 값을 공통 Record 기준 0.40으로 검증합니다.
Executor도 같은 기준을 재확인합니다. 기존 도메인의 confidence 정책은 변경하지 않습니다.
Body와 Emotion은 같은 원문을 근거로 하더라도 별도 Action과 Event로 저장합니다.
원문 전체는 복사하지 않고 user/conversation/message/action FK로 연결합니다.

- UUID PK와 FK RESTRICT, agent_action_id UNIQUE를 사용합니다.
- 6축 nullable Float, 최소 한 축/각 축 범위/confidence CHECK를 둡니다.
- NaN/무한대는 Pydantic과 DB CHECK 양쪽에서 거부합니다.
- metadata는 default=dict와 '{}'::jsonb이며 timestamp는 timezone-aware입니다.
- updated_at은 기존 ORM onupdate 정책입니다. DB trigger는 추가하지 않습니다.
- 활성 소유자/대화, user Message 소유권과 현재 attempt를 검증합니다.
- lease/retry/max attempts/fencing/result reuse는 공통 Executor를 재사용합니다.
- 저장 transaction 안에서는 OpenAI를 호출하지 않습니다.
- commit 후 finalize가 유실되면 같은 Action row를 재사용합니다.
- /chat allowlist에 Body Record만 추가합니다. 실패는 다른 도메인/채팅과 격리됩니다.
- 기존 Memory, request_id idempotency, Emotion 8축은 변경하지 않습니다.

## 읽기

GET /body-state-events/{id}?user_id=UUID

GET /users/{user_id}/body-state-events?limit=50

created_at DESC, id DESC; 기본 50/최대 100입니다. 다른 소유자는 상세 조회 404입니다.
user_id 검증은 인증이 아닙니다. 아직 운영용 로그인/인가 체계는 없습니다.

## 검증

```powershell
cd C:\noie\backend
python -B -m alembic upgrade head
python -B -m alembic current
python -B -m alembic check
python -u -B evals/run_body_state_tests.py
python -u -B evals/run_body_state_tests.py --live-routing
```

실제 PostgreSQL에 __body_state_v1__ 접두사의 별도 테스트 데이터를 생성합니다.
기존 사용자 데이터를 삭제하지 않으며 테스트 데이터도 자동 삭제하지 않습니다.
--live-routing은 실제 OpenAI 비용이 발생합니다.
Chat E2E는 Memory 자동 추출만 제외하고 채팅/Agent/DB는 실제 연결합니다.
0014 downgrade는 Body 데이터를 삭제하므로 SQL 구조 검증만 하고 실제 실행하지 않습니다.

## 남은 한계

발화 기반 추정은 실제 생리 상태와 다를 수 있으며 LLM 오분류 가능성이 있습니다.
nullable 값은 미언급과 알 수 없음을 함께 표현합니다. 별도 unknown 사유는 아직 저장하지 않습니다.
background 작업은 durable queue가 아니고 Action 중복 억제는 전체 exactly-once 보장이 아닙니다.
인증/인가, 개인정보 보존 정책, 안정적인 background 재처리는 후속 작업입니다.
