# Place v0.1

## 의미와 범위

현재 원문에 명시된 사용자 자신의 장소 방문(visit), 현재 장소(context),
장소 호감/불호(preference: like/dislike)만 구조화합니다.
Message가 원문 기준이며 PlaceEvent는 틀릴 수 있는 AI 해석입니다.
미래 계획, 희망, 질문, 타인의 방문, Memory로만 특정 가능한 지시어는 기록하지 않습니다.
GPS, 좌표, 주소 추정, 지도/검색 API, 추천, 장소 정규화는 구현하지 않습니다.

## 처리 경로

기존 /chat 원문/답변 저장 이후 background Orchestrator가 현재 user Message를 읽습니다.
record_place_event는 record confidence 0.40 이상일 때 자동 실행 allowlist에 들어갑니다.
기존 record_place/record_place_interest는 미구현 planning 항목으로 그대로 남아 있습니다.
Daily와 Place는 별도 Action과 transaction으로 처리합니다. Place 실패는 채팅이나 Daily 성공을 취소하지 않습니다.
Schedule은 기존처럼 확인 대기만 저장하며 자동 실행하지 않습니다.

## 저장과 보호

- UUID PK, 모든 FK는 RESTRICT, agent_action_id는 UNIQUE입니다.
- kind와 preference 관계는 Pydantic과 PostgreSQL CHECK 모두 검증합니다.
- occurred_at은 nullable timestamptz입니다. 오늘/지금만으로 시각을 만들어 저장하지 않습니다.
- created_at/updated_at은 timestamptz이며 updated_at은 기존 ORM onupdate 정책입니다.
- metadata는 Python default=dict와 DB '{}'::jsonb를 사용합니다.
- 원문 전체를 복사하지 않고 user/conversation/message/action FK로 근거를 연결합니다.
- Executor는 활성 소유자/대화, user 역할, message 소유권, 현재 attempt를 재검증합니다.
- 근거가 있는 경우 place_name은 현재 원문에 그대로 포함되어 있어야 합니다.
- 공통 Executor의 lease/retry/max attempts/fencing을 재사용합니다.
- domain commit 후 finalize가 유실돼도 UNIQUE와 ON CONFLICT로 기존 기록을 재사용합니다.
- 저장 transaction 안에서는 OpenAI를 호출하지 않습니다.

## 읽기와 검증

GET /place-events/{id}?user_id=UUID

GET /users/{user_id}/place-events?limit=50

목록은 created_at DESC, id DESC이며 기본 50개, 최대 100개입니다.
다른 user_id는 상세 조회 404입니다. 아직 인증이 없어 user_id 자체는 인증된 신원이 아닙니다.

```powershell
cd C:\noie\backend
python -B -m alembic upgrade head
python -B -m alembic current
python -B -m alembic check
python -u -B evals/run_place_tests.py
python -u -B evals/run_place_tests.py --live-routing
```

--live-routing은 실제 OpenAI 비용이 발생하며 실제 PostgreSQL에
__place_v1__ 접두사의 테스트 사용자와 데이터만 추가합니다. 데이터는 자동 삭제하지 않습니다.
Memory 자동 추출만 E2E 검증에서 제외하고 chat 답변/Orchestrator는 실제 OpenAI를 호출합니다.
downgrade는 place_events를 삭제하므로 운영 DB에서 실행하지 않습니다.

## 남은 한계

의미/주체/시각의 판단은 LLM 기반입니다. 정확한 장소 표현 대조는 보수적인 안전장치이며
별칭 정규화는 하지 않습니다. background 작업은 durable queue가 아니므로 서버 중단 시 유실될 수 있습니다.
Action 단위 중복 방지는 전체 파이프라인의 exactly-once 보장이 아닙니다.
LLM의 재판단으로 execution_order가 바뀌는 수동 재처리도 별도 안정화가 필요합니다.
인증/인가, durable queue, 개인정보 보존 정책은 후속 작업입니다.
