# NOIE Lv3 Baseline

기준일: 2026-10-04. 코드 기준 HEAD: `d900cda4d30c5a02bdc67ff0cc93e20a1d91b641`.
Lv3는 NOIE 내부 개발 단계 이름이다. 이 문서는 실제 구현의 기준선이며 모든 의미 평가의 반복 성공을 선언하지 않는다.
이번 작업은 코드 읽기와 문서 작성만 수행했다. DB 연결, migration, OpenAI 평가를 새로 실행하지 않았다.
기존 사용자 변경 `mobile/src/styles/appStyles.ts`는 기준선 변경 대상이 아니다.

## Architecture

개념적 업무 경로:

```text
User -> /chat -> Memory retrieval -> Orchestrator -> Gateway
     -> agent_actions -> Executor -> Domain Tool / DB
```

실제 코드는 응답과 업무 처리를 다음처럼 분리한다.

```text
/chat
  -> begin_chat_request: request_id 검사, user 원문 선행 저장 또는 완료 응답 재사용
  -> 관련 Memory 검색 (실패하면 빈 목록)
  -> 감정 분석 + 일반/프로젝트 OpenAI 답변 또는 fallback
  -> prepare_chat_recommendation
       -> 일반 Orchestrator: Record 및 추천 후보 판단
       -> 유효한 추천 후보 + recommendation_needed(현재 발화)인 경우에만
          최소 개인 context 조회 -> 추천 전용 Orchestrator
          -> Gateway -> agent_actions -> Executor -> recommendations
       -> 추천 성공 시 기존 reply 뒤에 제안 추가, 실패 시 기존 reply 유지
  -> complete_chat_request: 최종 assistant reply와 응답 캐시 저장
  -> 저장 성공 후 FastAPI BackgroundTasks
       -> Memory extraction / reconciliation
       -> run_chat_agent_integration
          -> 준비된 일반 routing 재사용 또는 일반 Orchestrator
          -> Gateway -> agent_actions
          -> 허용된 Record Tool 각각 실행
          -> create_schedule은 확인 대기만 저장
```

추천은 응답 전에 처리되고 Record와 Memory 추출은 응답 저장 후 실행된다.
완료된 동일 request_id는 캐시를 반환하므로 이 흐름을 새로 실행하지 않는다.
DB 저장이 실패한 상황에서 모든 응답의 영속성을 보장하는 것은 아니다.
Gateway 자체는 정책 계획 생성기이며 `execution_enabled=False`이다. 실제 실행은 별도의 공통 Executor가 담당한다.

주요 근거: `backend/main.py`, `chat_persistence_service.py`, `chat_storage_service.py`,
`chat_agent_integration_service.py`, `agent/orchestrator.py`, `agent/tool_gateway.py`,
`agent/action_service.py`, `agent/executor_service.py`, `agent/executor_registry.py`.
파일명 기준의 연결 설명이며 DB를 새로 검증한 결과가 아니다.

## Implemented Domains

아래 Record/Suggest/Execute는 업무 의미다. LLM으로 구현된 독립 Specialist Agent 수를 뜻하지 않는다.

| 기능 | 역할 / 모드 | 저장 위치 | 연결과 현재 한계 |
| --- | --- | --- | --- |
| Memory retrieval | 답변용 관련 기억 선택, 읽기 전용 | 기존 memories / memory_evidence 읽기 | 같은 사용자 active 기억 후보 최대 25, relevance 최소 0.55, Top-K 4. 선택은 LLM이며 Embedding/pgvector 검색이 아니다. 실패 시 빈 context. |
| Memory extraction / reconciliation | 저장된 user 원문에서 해석 기억 생성·조정, 별도 기록 경로 | memory_extractions, memories, memory_evidence | NEW / REINFORCE / SUPERSEDE, completed 재사용, lease/retry/fencing. `create_memory_candidate` Gateway Tool의 구현을 의미하지 않는다. 추출이 사실의 외부 검증은 아니다. |
| Emotion | 한 시점 F/A/D/J/C/G/T/R 해석, Record | emotion_events | record_emotion -> 공통 Executor. /analyze-emotion 및 /chat 분석의 독립 like/dislike와 user_view/admin_view는 별도 응답 계약이다. emotion_events에는 like/dislike 컬럼이 없으며 두 구조를 합쳐 기술하지 않는다. 의료 진단이 아니다. |
| Body | fatigue, sleepiness, energy, hunger, physical_tension, discomfort, Record | body_state_events | 원문과 action FK로 근거 추적. nullable 0..1, NULL=unknown, 0=근거 있는 낮음. 전부 unknown이면 기록하지 않으며 센서 측정값이 아니다. |
| Cognitive | focus, mental_load, motivation, uncertainty, clarity, Record | cognitive_state_events | Body와 별개 action/event. NULL과 0 구분. 상충하는 중복 축은 임의 평균으로 해결하지 않는다. 주관적 발화 해석이다. |
| Daily Life | 사용자가 실제 완료한 생활 사건, Record | daily_life_events | record_daily_trace로 summary/category 저장, 원문 Message는 별도 보존. 미래 계획/제3자 사건을 완료 기록으로 바꾸지 않는다. 일반 routing에서 선택 누락 가능. |
| Dream / Goal | 명시된 장기 꿈/목표, Record | dream_goals | record_dream_goal, kind=dream/goal, statement와 evidence FK. 자동 진행률 갱신/일정 생성/목표 강요는 없다. |
| Schedule | 구체적인 일정 생성, Execute | schedules 및 agent_actions의 승인 상태 | create_schedule만 업무 Executor 구현. 명시적 timezone·시각 계약, 사용자 승인 후 실행. /chat은 승인 대기만 저장. update/delete는 미구현, 모바일 승인 UI·실제 인증은 없다. |
| Place | 명시된 방문/현재 장소/선호, Record | place_events | record_place_event, visit/context/preference. 장소 표현과 원문 근거 검증. GPS/지도/영업시간/혼잡/이동시간 조회나 독립 Place Agent는 없다. |
| Recommendation | 다음 선택 지원, Suggest | recommendations | 필요성 이중 분기 후 추천 전용 context/call. direct/two_step/recover_then_reassess/tradeoff. 저장되는 것은 제안 이력이며 실제 행동 실행·accept/reject/outcome은 없다. |
| Relationship | 사용자 진술의 사람·관계 근거, Record | relationship_events | record_relationship_event의 records 최대 8개. social_relation/state/meaning_relation/observation, named/temporary, past/current. 관계 graph·Entity Resolution·현재 관계 resolver가 아니다. |
| Orchestrator | 현재 발화의 구조화된 routing | 반환 JSON, 필요한 action만 agent_actions에 저장 | 일반 routing과 추천 전용/Relationship 원문 전용 계약. JSON/schema 성공이 의미 완전성을 보장하지 않는다. 자체 Tool 실행 없음. |
| Tool Gateway | Tool/mode/confidence/confirmation 정책 검증 | 계획 반환, 별도 persistence로 저장 | ready/pending_confirmation/needs_review/rejected/not_implemented 구분. planning_supported와 implemented는 다르다. ready가 곧 실행 완료는 아니다. |
| Action persistence | 실행 계획·승인·처리 상태 보존 | agent_actions | action_id/idempotency_key/confirmation_id UNIQUE, 소유권 검증. confirmation은 사용자 의도 확인이지 로그인 인증 대체가 아니다. |
| Common Executor | 등록 Tool의 안전한 실행 | agent_actions 결과 + 각 domain 테이블 | 짧은 lease 획득 -> lock 밖 Tool -> fenced finalize. registry에 없는 Tool은 실패 처리, 임의 executor fallback 없음. |
| /chat integration | 원문/최종 답변 저장과 업무 흐름 연결 | messages, chat_requests, agent_actions 및 domain | 일반/프로젝트/rule/fallback의 최종 반환 reply 저장. Record 실패는 chat 답변/다른 domain과 분리. 비내구성 background 작업의 유실 가능성은 남는다. |

업무 Executor가 연결된 Tool은 7개 Record와 create_schedule, suggest_recommendation의 9개다.
테스트 전용 Tool은 제품 기능으로 세지 않는다. Routine/Hobby, update_relationship_status,
update/delete_schedule, update_dream_progress 등 registry 항목의 존재만으로 구현 완료라고 쓰지 않는다.
기존 모바일/프로젝트 기능과 이 업무 Tool의 구현 범위도 동일하다고 가정하지 않는다.

### Memory와 Relationship의 근거 의미

Message는 수정·요약하지 않는 원본 기준 데이터이며 Memory/도메인 event는 틀릴 수 있는 해석이다.
memory_evidence는 memory-message 다대다 연결이고 같은 연결은 UNIQUE로 중복 방지한다.
SUPERSEDE는 이전 Memory를 보존하고 successor로 연결하며 원문을 대체하지 않는다.
Relationship의 person_label은 그 발화의 표현이다. 실명/임시 label이 같아도 전역 인물 동일성은 확정하지 않는다.
관계 종료·부정은 positive current friend로 바꾸지 않으며 기록 부재가 원문 삭제는 아니다.

## Safety / Reliability

### Idempotency / transaction

- chat_requests의 request_id와 요청 hash로 중복 요청·다른 payload 재사용을 구분한다. completed 응답은 재사용하고 processing/conflict는 409 경로가 있다. 같은 텍스트의 새 UUID는 새 요청이다.
- request_id는 구버전 호환을 위해 선택적이다. 없는 요청에는 chat_requests 기반 중복 방지 보장이 없다. hash는 사용자 text만 대상으로 하므로 같은 UUID에 history/project payload만 바꾼 재요청까지 검출하는 계약은 아니다.
- user 원문은 OpenAI 처리 전에 commit한다. 최종 assistant reply와 캐시 완료는 별도 저장 단계다. 답변 출처는 원문 metadata에 보존할 수 있으며 원문 텍스트 비교로 중복을 제거하지 않는다.
- Action은 action_id/idempotency_key UNIQUE를 사용한다. Relationship/Recommendation의 /chat action UUID5는 request_id 또는 message_id 기반으로 routing 순서와 독립적이다.
- 다른 Record의 결정론적 action ID에는 execution_order/type/intent가 들어간다. 임의의 재-routing 순서 변화까지 동일 action으로 묶는 보장으로 확대하지 않는다.
- 각 domain은 action 연결 UNIQUE 및 conflict reuse를 사용한다. Relationship은 UNIQUE(agent_action_id, record_index)로 묶음 전체를 transaction 처리한다.
- commit 전 실패는 rollback한다. domain commit 후 finalize 유실 시 기존 domain row를 재사용한다. 추천 이력 commit과 최종 chat 저장은 단일 원자 transaction이 아니므로 전달되지 않은 제안 이력이 남을 수 있다.

### Lease / retry / fencing / isolation

- 공통 Executor는 짧은 row lock으로 lease를 확보하고 attempt_count를 증가시킨 뒤 commit한다. 기본 timeout 300초, max attempts 3이며 환경변수로 설정한다.
- 유효한 processing lease는 다른 worker가 가져가지 않는다. failed 또는 만료 processing은 한도 내 retry 가능하며 completed는 executor 재호출 없이 반환한다.
- finalize는 status/attempt_count를 확인한다. domain 저장도 현재 attempt와 만료 lease를 검증하여 늦은 worker의 쓰기를 차단한다.
- Memory extraction에도 별도의 lease/attempt fencing과 completed 결과 재사용이 있다. 오래 처리 중인 chat_requests를 자동 재시도하는 동일 기능이라고 일반화하지 않는다.
- OpenAI 호출 동안 DB transaction/row lock을 유지하지 않는다. context는 짧게 읽고 session을 닫은 뒤 전달한다.
- Record별 실행 오류와 추천 실패는 다른 업무/기존 reply를 rollback하지 않는다. 격리는 모든 저장을 한 번에 성공시키는 분산 transaction 보장이 아니다.
- get_db는 예외 시 명시적 rollback 후 재-raise, finally close. UUID, timezone-aware timestamp, 안전한 JSONB default와 naming convention을 사용한다.
- 사용자/대화는 soft-delete 기반이며 주요 근거 FK는 RESTRICT다. messages.user_id의 기존 SET NULL 예외를 포함해 모든 FK가 동일 정책이라고 주장하지 않는다. 자동 삭제/purge는 없다.

### Ownership / privacy

- domain 쓰기는 활성 user/conversation과 저장된 role=user Message 연결을 재검증한다. 다른 사용자의 Message를 근거로 사용할 수 없다.
- user_id 필터는 인증이 아니다. 공개 배포 전 로그인/토큰 기반 실제 접근 제어가 필요하다.
- /chat 저장 문맥은 NOIE_DEV_USER_ID/NOIE_DEV_CONVERSATION_ID 환경변수를 우선하고, 없으면 개발용 이름의 활성 사용자와 최신 활성 대화를 재사용하거나 생성한다. 클라이언트별 로그인 사용자·대화 분리 구현이 아니며 이 개발 정책으로 여러 실제 사용자의 데이터를 분리한다고 주장하지 않는다.
- 일반 routing은 현재 발화와 기존 관련 Memory를 받는다. Recommendation 개인 context는 유효한 추천 후보와 현재 선택 필요성 조건을 모두 만족할 때만 조회한다.
- 최근 Emotion/Body/Cognitive 각각 120분 내 최신 1개, 필요한 확정 Schedule 최대 3개(기본 2시간/하루 계획 최대 24시간), 관련 Goal 3개, 관련 Daily 24시간/3개, 관련 Place 현재 context 120분/1개 및 선호 3개로 제한한다.
- 추천용 Memory는 기존 Retrieval 결과 중 현재 질문 주제에 맞는 최대 4개, 각 content 최대 600자다. 전체 DB/대화/history/Memory dump를 추가 전달하지 않는다.
- Recommendation context는 추천 전용 판단에만 사용하고 일반 Record의 증거로 확장하지 않는다. 현재 명시적 발화가 과거 Memory보다 우선한다.
- 기존 관련 Memory가 있는 일반 routing에서 Relationship 후보가 나오면 현재 발화만 전달하는 전용 호출로 재판단한다. 이는 새 Relationship 후보의 누락을 모두 복구하는 호출이 아니다.
- 현재 Recommendation context loader에는 Relationship history가 없다. Lv4의 Relationship provider는 아직 설계 사항이며 기존 허가의 범위를 자동 확장하지 않는다.

## Known Limitations

### Multi-action routing nondeterminism

`민수는 내 친구야. 오늘 친구 민수랑 저녁 먹었어.` 실제 /chat 추적에서
Relationship action은 나왔으나 Daily action은 **OpenAI 원본 structured output에서 이미 없었다**.
나온 Relationship은 normalization -> Gateway -> agent_actions -> Executor까지 보존됐다.
이 관찰을 Gateway/Executor/DB/Relationship 저장 자체의 결함으로 단정하지 않는다.

관계 추론 제한과 독립적인 완료 Daily 기록의 구분, 명시적 관계 선언과 복합 발화 coverage를
기존 prompt/action 계약에 두 차례 보완했다. 한 실행의 성공 후 반복에서 Daily 누락이 다시 관찰됐다.
추가 무한 prompt tuning이나 키워드로 action 강제 생성 없이 남은 비결정성으로 기록한다.
진단용 PowerShell stdin의 한국어 인코딩 손상도 있었으나 유효한 UTF-8 입력의 Daily 누락을 설명하지는 않는다.

### Semantic / operational limits

- Structured Output, 원문 substring, confidence 검증은 의미 판단의 정확성 증명이 아니다. confidence는 성공 확률·관계 진실 확률이 아니다.
- Relationship 전용 22-case의 22/22 실행 이후 반복 21/22가 관찰됐다. `민수는 이제 친구가 아니야`를 원문 relationship_state로 분류한 결과와 actions=[] 기대가 달랐다. positive friend를 생성한 실패와는 구분한다.
- Recommendation 의미 회귀는 최근 Relationship 조사에서 13/15였다. 상충하는 중복 Cognitive 축이 전체 routing validator에서 거부된 사례와 가까운 일정 추천 누락이 있었다. metric/validator를 완화하지 않았다.
- 미래 희망/계획의 Relationship observation/state 저장을 보수적으로 차단하지만 완전한 한국어 시간 parser는 아니다.
- FastAPI BackgroundTasks는 durable queue가 아니다. 응답 저장 뒤 프로세스 중단으로 extraction/Record가 미실행될 수 있으며 완료 응답 재전송이 자동으로 이를 복구한다고 보장하지 않는다.
- 추천용 context의 주제/동의어 필터와 필요성 분기는 보수적이다. 지원하지 않는 표현의 관련 정보를 놓칠 수 있고 120분 창도 상태 유효성의 객관적 보장이 아니다.
- 일반 답변의 조언과 별도 추천이 겹칠 수 있고, 응답 전 routing/추천 호출로 비용·지연이 증가한다.
- Entity Resolution, current relationship resolver, 관계 graph, 자동 병합/삭제, embeddings/pgvector, Tool별 완전한 업무 workflow, 실제 인증은 구현 범위 밖이다.

### 기존 검증 기록의 해석

`RELATIONSHIP_SPEC.md`의 이전 기록에는 Chat Integration 9/9, Daily 20/20,
Daily hardening 11/11, Recommendation 안전성/계약 108개 성공이 있다.
Chat Integration 스크립트는 실제 PostgreSQL fixture를 쓰지만 routing/reply는 fake이므로
OpenAI multi-domain 의미 안정성의 증명이 아니다. 테스트 실행은 DB 쓰기를 포함한다.
Memory smoke의 최근 기록은 5-case에서 검색/현재 발화 우선 100%, 무관 검색 0%,
답변 정보 OFF 25%/ON 100%, 평가 대상 5개 테이블 row count 동일이다.
이전 `RECOMMENDATION_V1.md`에는 ON 75%도 있어 반복 품질 변동을 숨기지 않는다.
row count 동일은 DB 전체 내용 fingerprint 동일을 의미하지 않는다.
본 문서 작업에서 이 평가나 실제 DB health/Alembic을 재실행하지 않았다.

## Lv3 Freeze Rule

- Lv4는 기존 domain 위의 collaboration layer다. 기존 domain을 대체하거나 모든 Record를 Multi-Agent로 옮기지 않는다.
- Emotion 8축과 독립 like/dislike, Body/Cognitive unknown, 완료 Daily/장기 Goal/명시적 Place/관계 evidence 의미 경계를 유지한다.
- Message source of truth, Evidence 추적, RESTRICT/soft delete, 기존 idempotency/lease/retry/fencing/rollback/실패 격리를 유지한다.
- Memory 후보 25 / threshold 0.55 / Top-K 4 및 기존 Evaluation metric을 임의 변경하지 않는다.
- 현재 발화 우선, context 목적/소유권/관련성/시간/개수 제한과 Execute confirmation을 유지한다.
- 기존 Gateway -> agent_actions -> Executor 경로를 우회하지 않는다. Opinion은 실행 권한이나 기록 사실이 아니다.
- known limitation을 baseline에 남긴다. 안정성 주장을 위해 prompt/validator/테스트 기대값을 몰래 완화하지 않는다.
- 새로운 정책·schema·migration·UI 변경은 별도 승인된 단계에서 한다. 이번 문서는 그것들을 구현하지 않는다.

관련 설계: [LV4_SPEC.md](LV4_SPEC.md), [RELATIONSHIP_SPEC.md](RELATIONSHIP_SPEC.md).
