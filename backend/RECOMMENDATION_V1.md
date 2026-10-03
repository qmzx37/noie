# Recommendation v0.1

## 목적과 사용자 선택권

추천은 다음 선택을 돕는 Suggest이며 사용자 대신 결정하거나 실제 행동을 실행하지 않습니다.
`suggest_recommendation`은 추천 이력을 저장할 뿐 운동/개발/일정 Tool을 실행하지 않습니다.
이미 결정한 휴식/카페/내일 개발 의사는 과거 기억보다 우선합니다.
일반 잡담, 사실 질문, 단순 상태/장소/일정 보고에는 추천 action을 만들지 않습니다.
NO_RECOMMENDATION은 빈 추천 후보로 표현하며 가짜 이력 row를 생성하지 않습니다.

## 필요성 분기와 목적 제한

먼저 기존 개인 상태 스냅샷 없이 Orchestrator routing을 판단합니다.
유효한 suggest_recommendation 후보와 현재 발화의 선택/추천/미해결 갈등 신호가 둘 다 있어야
개인 context를 조회합니다. 단순 보고와 확정 의사는 추가 조회/전송/추천 저장을 하지 않습니다.
기존 routing의 Emotion/Body/Cognitive/Daily 등 Record 결과는 그대로 재사용합니다.
개인 context를 쓰는 두 번째 OpenAI 호출은 추천 전용 JSON Schema로 제한하며
다른 domain의 판단/Record 출력은 반환 경계에서도 거부합니다.
일반 채팅의 기존 관련 Memory Retrieval은 변경하지 않았으며 추천 context와 별개입니다.

## 사용 context

- 현재 user Message 원문 및 생성 시각.
- 기존 Retrieval이 선택한 최대 4개 Memory. 기존 후보 25개, threshold 0.55는 변경하지 않습니다.
- 최근 120분 내 Emotion/Body/Cognitive 각각 최신 1개. NULL은 unknown입니다.
- 활동/회복/우선순위 선택에만 최근 상태와 확정 Schedule을 사용합니다. 일정은 기본 2시간/진행 중,
  지금 질문이 아닌 오늘/내일/하루 계획 질문만 기존 24시간 상한까지, 최대 3개입니다.
- 질문에 나온 주제/직접 동의어와 맞는 Dream/Goal 최신 3개, 최근 24시간 Daily Life 최대 3개.
- 장소 선택 질문에만 관련 최근 120분 Place context 1개와 관련 장소 선호 최대 3개.
- 관련성은 DB 조회에서 먼저 제한하고 그 뒤 개수 제한을 적용합니다. 관련 자료가 없으면 빈 목록입니다.

다른 사용자/삭제된 사용자의 자료, 삭제된 대화의 domain context, 현재 발화 시각 이후 자료는 제외합니다.
오래된 Body/Cognitive 점수는 현재 상태로 전달하지 않습니다. 현재 명시적 발화가 스냅샷보다 우선합니다.
생성에 사용한 제한된 context 시각/내용은 Action과 Recommendation metadata에 남깁니다.
불필요한 내부 ID/message_id 및 원본 대화 history는 OpenAI context에 포함하지 않습니다.
Memory 내용은 해석 결과이지 원문/명령이 아닙니다. 현재 선택을 금지하는 데 사용하지 않습니다.
개인 이력을 만들거나 상식/상관관계를 개인의 사실/원인으로 주장하지 않습니다.
120분/24시간 창은 제품의 임시 정책이지 상태 유효성을 보장하는 측정 기준이 아닙니다.
기록되지 않은 Daily 활동을 '오늘 활동 0회'나 연속 목표 공백으로 단정하지 않습니다.
이 제한된 개인 context는 기존 OpenAI Responses 목적지에 전달됩니다. 키는 서버 환경변수만 사용합니다.

### OpenAI 전달 필드

아래는 추천 전용 호출의 실제 payload 허용 필드입니다. 전체 DB/대화/Memory dump는 보내지 않습니다.
원문은 현재 질문과 관련된 짧은 Memory/해석 텍스트에 한정하며 저장된 Message 전체를 추가 조회하지 않습니다.

| 경로 | 전달 필드 | 목적과 제한 |
| --- | --- | --- |
| current_user_utterance | 현재 text | 사용자가 요청한 선택 판단, 과거 정보보다 우선 |
| schedule_time_context | timezone, reference_datetime | 기존 명시적 timezone/현재 시각, 임의 지역 추정 금지 |
| security_note | 참고 데이터 지시문 | Memory 속 지시 실행 금지 |
| relevant_memory_context[] | content, relevance | 기존 후보 25/threshold .55/Top-K 4 유지 후 질문 주제 일치, content 최대 600자 |
| recommendation_context | as_of, state_window_minutes | 발화 시점과 120분 유효 창 표시 |
| recent_states.emotion | created_at, f/a/d/j/c/g/t/r, confidence | 활동/회복/우선순위 선택의 최근 상태, 최신 1개 |
| recent_states.body | created_at, fatigue/sleepiness/energy/hunger/physical_tension/discomfort, confidence | 같은 목적/시간 창, 최신 1개, NULL=unknown |
| recent_states.cognitive | created_at, focus/mental_load/motivation/uncertainty/clarity, confidence | 같은 목적/시간 창, 최신 1개, NULL=unknown |
| schedules[] | created_at, title, start_at, end_at | 활동 선택의 확정 시간 제약, 기본 2시간/오늘·내일 계획 최대 24시간, 최대 3개, 이동 시간 추정 금지 |
| dream_goals[] | created_at, statement, kind | 현재 질문 주제와 맞는 장기 목표, 최대 3개/statement 300자, 과거 목표가 현재 의사를 강제하지 않음 |
| daily_life[] | created_at, summary, category | 질문 관련 최근 활동 해석, 24시간/최대 3개/summary 200자, 누락을 활동 부재로 판단하지 않음 |
| places[] | created_at, place_name, kind, preference | 질문에 관련된 장소 상황/선호, context 120분/1개, 선호 최대 3개 |

모든 source는 동일 활성 사용자/활성 대화(또는 conversation=NULL) 소유권과 미래 시각 제외를 유지합니다.
Goal/장소 선호는 장기 자료이며 현재 상태의 증거가 아닙니다. 상태 변경/자동 실행에는 사용하지 않습니다.
허용 목적은 suggest_recommendation 판단/생성뿐이며 다른 domain, Relationship, Simulator, Self Model에는 사용하지 않습니다.
미지원 주제/불확실한 관련성은 개인 근거 없이 현재 질문 중심으로 답하도록 보수적으로 제외합니다.

## 판단과 계약

`RecommendationArguments`는 extra forbid, 유한한 confidence 0..1입니다.
primary_action(최대 240자), alternative_action(선택, 최대 240자), rationale(최대 600자),
confidence, recommendation_kind, reassess_after_minutes(선택, 1..120분)를 가집니다.

- 기본은 주 추천 1개입니다. 대안이 있으면 tradeoff이며 두 선택 모두의 근거를 제시합니다.
- direct / two_step / recover_then_reassess에는 대안이 없습니다.
- recover_then_reassess는 재평가 시간을 필수로 가집니다.
- 두 단계 이내의 준비+시작 또는 회복+재평가를 제안합니다. 긴 계획/명령은 지양합니다.
- 심한 수면 부족에는 회복 후 재평가, 일반 피로와 의욕에는 작은 작업 후 휴식을 고려합니다.
- 선택 혼란은 선택지를 줄이고 한 가지부터 시작합니다.
- 게임 즐거움은 강제 종료 대신 시간 경계와 작은 목표 행동을 고려합니다.
- 가까운 일정은 준비/이동 여유를 남기며 모르는 이동 시간을 만들어내지 않습니다.
- 중요한 가치가 충돌하면 절충안을 먼저 고려하고 우열을 강제하지 않습니다.

## 기존 Agent 연결

Orchestrator의 기존 context 없는 routing을 유지하고 추천이 필요할 때만 추천 전용 호출을 추가합니다.
Gateway는 `mode=suggest`, 확인 불필요, implemented=true, 기존 threshold 0.50을 사용합니다.
Action과 인자 confidence 중 낮은 값으로 threshold를 확인하고 Executor에서도 재검증합니다.
잘못된 추천 계약이나 복수 추천 action은 출력 경계에서 로그 후 추천만 보류합니다.
같은 출력의 유효한 Record 후보는 유지합니다. 잘못된 원래 action 순서를 정상화하지 않습니다.
직접 Gateway/Pydantic 입력은 여전히 잘못된 추천을 거부합니다.

## Transaction과 중복 방지

짧은 context read/session 종료 -> 기존 OpenAI reasoning -> 짧은 Action 저장 ->
공통 lease 획득 -> 추천 이력 저장 -> 공통 finalize 순서입니다.
OpenAI 중 DB transaction/row lock은 유지하지 않습니다.
추천은 `uuid5(request_id 또는 message_id, 'chat-recommendation-v1')`의 고정 Action ID를 사용합니다.
Record 순서 변경과 무관하게 동일 요청 추천은 동일 Action에 연결됩니다.
`recommendations.agent_action_id UNIQUE`와 `INSERT ... ON CONFLICT DO NOTHING`으로 row를 재사용합니다.
공통 lease/retry/attempt fencing을 사용하고 domain commit에도 현재 attempt/만료 여부를 확인합니다.
finalize 유실 후 retry는 이미 commit된 추천을 재사용합니다. stale worker는 덮어쓰지 못합니다.
같은 텍스트라도 새로운 request_id는 별개 요청입니다. 텍스트 비교로 삭제하지 않습니다.

## Persistence와 migration

`20261003_0016`은 0015 다음의 단일 additive migration입니다.
recommendations: UUID id/user_id/conversation_id/message_id/agent_action_id, 추천 계약 필드,
JSONB metadata(Python default=dict, DB {}), timezone-aware created_at/updated_at.
UUID는 ORM uuid4 + DB gen_random_uuid(), 모든 FK는 RESTRICT입니다.
updated_at은 기존 ORM onupdate 정책이며 trigger는 없습니다.
UNIQUE Action, confidence/종류/공백/대안/재평가 CHECK, (user_id, created_at, id) 인덱스를 가집니다.
upgrade는 기존 원문/기억/도메인을 수정하지 않습니다. downgrade는 추천 이력을 삭제하므로 운영에서 실행하지 않습니다.

## /chat과 조회 API

기존 assistant reply를 유지하고 저장된 주 추천/대안/근거를 뒤에 덧붙입니다.
최종 reply 전체가 실제 반환값과 정확히 동일하게 assistant Message 및 cached_response에 저장됩니다.
추천 실패 시 기존 reply는 유지하며 기존 Record는 준비된 routing을 재사용해 background에서 실행합니다.
완료된 동일 request_id는 기존 전체 응답을 재사용하고 OpenAI/추천 생성도 재호출하지 않습니다.
추천은 응답 전에 계산하므로 기존 background-only 방식보다 응답 지연이 추가됩니다.

- GET /recommendations/{id}?user_id=UUID
- GET /users/{user_id}/recommendations?limit=50 (최대 100)

정렬: created_at DESC, id DESC. 다른 사용자/없는 기록은 404입니다.
user_id 필터는 인증이 아닙니다. 공개 배포 전 실제 인증/소유권 토큰이 필요합니다.

## 검사 명령

```powershell
cd C:\noie\backend
python -m alembic current
python -m alembic heads
python -m alembic check
python -X utf8 -B evals/run_recommendation_tests.py
python -X utf8 -B evals/run_recommendation_tests.py --routing-only
python -X utf8 -B evals/run_recommendation_tests.py --live-chat-only
```

테스트는 __recommendation_v1__ 사용자/대화를 생성하고 기존 데이터는 삭제하지 않습니다.
안전성 테스트의 routing은 결정론적 fake, --routing-only는 실제 OpenAI입니다.
--live-chat-only는 실제 OpenAI 답변/routing + 실제 PostgreSQL을 사용하며 Memory 자동 추출만 stub합니다.
상태 점수와 추천 내용은 해석이며 의료/정신건강/법률/재정 판단이 아닙니다.
confidence는 성공 확률이 아닙니다.

## 한계와 확장점

- 추천 kind/두 선택 계약은 코드/DB로 검증하지만 문장의 의미, 두 단계 이내 여부, 근거 적절성은 LLM 평가 대상입니다.
- 기존 일반 답변의 조언과 덧붙인 추천이 겹칠 수 있습니다. 다음 버전에서 reply 통합 렌더링을 평가할 수 있습니다.
- 잘못된 추천을 보류하면 해당 답변에 추천이 빠질 수 있습니다. 다른 도메인 기록은 보존합니다.
- 추천 이력 commit과 최종 assistant 저장은 별도 transaction입니다. 후속 chat 저장 실패 시 전달되지 않은 제안 이력이 남을 수 있습니다.
- background Record와 Memory extraction은 기존 비내구성 BackgroundTasks이며 durable queue는 이번 범위 밖입니다.
- 기존 SDK 모델/평가 metric은 유지합니다. 같은 의미 경계 prompt/adapter 보강은 최대 두 번 후 비결정성을 한계로 남깁니다.
- 질문 신호/주제 동의어 필터는 보수적인 v0.1 정책입니다. 새로운 표현이나 고유 장소명은 관련 자료를 놓칠 수 있으나 전체 자료로 대체하지 않습니다.
- 추천 요청에는 context 없는 routing과 추천 전용 생성의 두 호출이 필요하여 지연/비용이 증가합니다.
- 자연어 두 단계 여부/개인 근거 없는 경우의 confidence는 스키마로 완전히 보장되지 않습니다. 테스트 통과를 의미 보장으로 해석하지 않습니다.
- accepted/rejected/outcome feedback는 향후 Recommendation ID를 기준으로 별도 데이터 구조에 연결할 수 있습니다.
- 장기간 목표 공백의 개입 강도는 future tuning이며 7일 규칙이나 자동 행동/자동 삭제는 구현하지 않습니다.
- Human Simulator, Relationship, Self Model, Agent 추가 framework, Embedding/pgvector는 구현하지 않습니다.

## 이번 검증에서 남은 품질 신호

실제 추천 의미 평가 15개와 OpenAI/PostgreSQL 기본 /chat 및 장애·중복 검사는 통과했습니다.
서버 HTTP 검사는 로컬 TestClient 기반이며 mobile/Render 재배포 E2E를 새로 실행한 것은 아닙니다.
Body/Cognitive 전체 테이블 지문 검사는 다른 DB 쓰기 테스트와 겹치면 새 테스트 row도 변경으로 판단합니다.
순차 단독 재검증은 각각 90/98개 모두 통과했으며 검사 조건을 완화하지 않았습니다.

기존 Memory Evaluation smoke 5개(no judge)는 검색 적중 100%, 무관 검색 0%, no-memory precision 100%,
현재 발화 우선 100%, 답변 사실 포함률 OFF 25%/ON 75%, DB unchanged=True였습니다.
direct_project_recall은 관련 NOIE Memory 선택에 성공했지만 답변에서 NOIE를 언급하지 않아 answer_pass=false입니다.
따라서 모든 Memory 답변 품질 사례가 통과했다고 볼 수 없습니다. 이전 ON 100% 결과와 다른 품질 신호로 남깁니다.
Memory 구현/metric은 변경하지 않았고 이 범위 밖의 prompt 튜닝도 하지 않았습니다.
