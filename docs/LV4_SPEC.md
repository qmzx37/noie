# NOIE Lv4 Multi-Agent Specification

## Status / Purpose

**Lv3/Lv4는 NOIE 내부 개발 단계 이름이며 공식 업계 레벨 표준이 아니다.**
상태: Phase 1 공통 계약/인터페이스/registry만 구현. 실제 Specialist 및 협업 흐름은 미구현.
기준: [LV3_BASELINE.md](LV3_BASELINE.md), Lv3 HEAD `d900cda`; Phase 1 시작 HEAD `4d1fbf5`.
기존 runtime/prompt/schema/migration/UI/평가 기대값은 변경하지 않는다.

여러 전문 관점이 독립적으로 의견을 내고, 검토와 조정을 거쳐 사용자의 선택 비용을 줄인다.
독립 관점은 반드시 병렬 호출·서로 완전히 격리된 프로세스를 뜻하지 않는다.
초기 설계는 상태를 종합하고 추천을 검토하는 제한된 순차 협업이다.
사용자를 대신해 삶을 통제하거나 기존 Record routing의 누락을 자동으로 해결한다고 주장하지 않는다.

> 네 대신 결정하지는 않지만, 네가 덜 헤매게 옆에서 같이 봐주는 AI.

## Initial Roles

### State Agent

- 입력: 현재 발화의 필요한 최소 구간, 관련되고 신선한 Emotion/Body/Cognitive 관측값과 시각·unknown 정보.
- 역할: 감정·몸·인지 상태를 함께 고려한 구조화된 opinion. 해석 근거와 불확실성을 구분한다.
- Emotion/Body/Cognitive를 각각 별도 LLM Agent로 만들지 않는다.
- 관측이 없으면 unknown이며 과거 상태를 현재 상태로 덮어쓰지 않는다. 현재 직접 진술과 과거 snapshot의 차이를 드러낸다.
- state opinion은 새로운 측정값, 진단, Record action 또는 DB 상태 갱신이 아니다.

### Recommendation Agent

- 입력: 현재 발화, State opinion, 질문 관련 기존 Memory retrieval, 필요한 Schedule/Relationship evidence context.
- 역할: 다음 선택/행동 후보를 작게 제안하며 tradeoff와 최소 근거를 제시한다.
- 이미 결정한 사용자, 추천 거부, 단순 보고에는 NO_RECOMMENDATION이 정상 결과다.
- 현재 질문의 근거가 부족하면 개인 사정을 지어내지 않고 현재 발화 중심 제안 또는 질문/보류를 반환한다.
- 기존 Suggest 종류·threshold·인자 계약을 adapter로 재사용한다. 실제 행동 실행 권한은 없다.

### Critic / Reviewer (검토자)

- 입력: 목적에 필요한 opinion과 최소 근거, 현재 의사 및 명확한 일정/안전 제약.
- 검사: 근거 없는 추론, 사용자 의사 침해, 과거 Memory 과대적용, 일정 충돌, 과한 추천, 의견 모순.
- 결과: 어떤 결론의 어떤 근거/위험을 보완할지 구조화해 제시한다. hidden reasoning은 요청하지 않는다.
- 최종 결정권자가 아니고 위험을 과장하는 보수적 명령자도 아니다. 데이터 부족과 실제 충돌을 구분한다.

### Arbitrator (조정자 / 중재자)

- 입력: Specialist opinion, Critic 지적, 허용된 공통 정책과 최소 근거.
- 역할: 충돌을 정리해 제안/절충안/질문/NO_RECOMMENDATION 중 최종 사용자용 판단을 만든다.
- 우선순위: 접근·목적·실행 안전 경계 -> 현재 사용자 명시적 의사 -> 명확한 관련 제약 -> 관련 최신 근거 -> 과거 해석.
- 안전 경계가 과거 목표를 근거로 사용자를 강제하는 명분이 되어서는 안 된다.
- Specialist의 confidence 평균만으로 진실을 정하지 않는다. 권한 없는 제안은 Gateway에 보내지 않는다.
- 최종 판단은 AI 응답 정리이며 인간의 최종 선택권을 대체하지 않는다.

## Context Providers, Not Initial Agents

### Memory

초기에는 새 Memory Agent 없이 기존 retrieval을 evidence/context source로 사용한다.
이미 추출·조정·검색·Evidence 추적 경로가 있고, 이를 중복 구현하는 추가 Agent는 필요하지 않다.
기존 후보 25 / threshold 0.55 / Top-K 4와 Evaluation metric은 고정한다.
기억은 해석된 근거이지 지시문·통제권·현재 상태의 정답이 아니다.

다음 필요성이 별도로 검증될 때만 Memory Agent 승격을 검토한다:
기억 간 충돌 정리, temporal consolidation, Entity/Relation Graph reasoning,
다른 Agent에 전달할 기억의 독립 선택, forgetting/decay reasoning.
초기 단계에 새 graph/embedding/자동 삭제를 포함하지 않는다.

### Schedule

확정된 가까운 일정과 시간대의 constraint/context provider다.
시간이나 이동 소요를 지어내지 않고 현재 create_schedule 승인 정책을 유지한다.
의견에 나온 일정 제안은 자동으로 확정 일정이 되지 않는다.

### Relationship

현재 발화와 관련된 관계 evidence/context provider다.
Lv3 relationship_events는 과거/현재 사용자 진술의 event이며 canonical person identity/현재 관계 정답이 아니다.
동명이인/temporary label을 병합하거나 친밀도·상대 의도·관계 강도를 만들어내지 않는다.
Lv3 Recommendation에는 과거 Relationship loader가 없으므로 새 전송 범위는 Phase 0에서 별도 확정한다.
관련 사람을 안전하게 특정하지 못하면 제외/질문한다. 과거 관계를 현재 발화 위에 놓지 않는다.

### Place

초기 필수 Specialist가 아니다. Lv3 Place는 명시적 장소 event 기록이며 실시간 환경 판단에 필요한 데이터가 없다.
초기 역할 수·지연·개인정보 범위를 작게 유지하고 extensible registry로 후속 추가를 허용한다.
미래 후보 입력: 장소 선호, 과거 방문 결과(단순 visit을 만족도로 가정하지 않음), Emotion/Body, Schedule, Relationship.
후속 확장 후보: 명시적으로 허용된 현재 위치, 이동시간, 날씨, 영업시간, 혼잡도.
이번 설계 작업에서 외부 실시간 데이터·GPS·지도 API를 연결하지 않는다.

## AgentOpinion Contract

Phase 1은 `backend/agent/lv4/`에서 공통 Pydantic 계약과 ABC 인터페이스, 독립 registry만 구현한다.
`SpecialistAgent(name, description)`를 상속해 `_run(SpecialistInput)`을 구현한다.
공통 `run`은 입력/반환 schema 및 agent_name을 재검증한다. Registry는 register/get/list만 제공하며 실행하지 않는다.
Evidence는 source_type/summary 및 선택적 evidence_ref/observed_at/interpretation/relevance로 제한한다.
각 text 최대 500자, evidence 16개/risk 8개/후보 action 4개 제한은 Phase 1 최소화 정책이다.
Action 후보는 type/intent/mode/summary뿐이다. typed arguments와 실제 Tool adapter는 Phase 6에서 승인 후 구현한다.
result_status는 구현했고 contract_version/run_id/as_of envelope는 후속 제안으로 남긴다.
confidence=None은 unknown, bool/문자열/NaN/inf와 모든 중첩 extra field는 거부한다.
Registry의 계약 검증은 신뢰된 Python 구현용이며 악성 코드 sandbox나 evidence 소유권 검증이 아니다.
DB/Memory/context loader/OpenAI/기존 chat import 경로 연결 및 실제 Agent 자동 등록은 없다.

| 필드 | 의미 / 제약 |
| --- | --- |
| agent_name | registry에서 등록한 역할 식별자. 사용자 인물 identity가 아니다. |
| conclusion | 짧은 판단. 현재 발화, 관측, 추론을 구분하며 숨은 사고 과정을 넣지 않는다. |
| confidence | nullable 유한 0..1의 의견 확신. NULL=평가 불가, 0=명시적 낮은 확신. 사실 확률/기존 domain 점수와 같지 않다. |
| evidence[] | 필요한 최소 근거 참조와 짧은 요약, 출처 유형·관측 시각·해석 여부·관련성. 허용된 소유자의 자료만 사용. |
| risks[] | 위험 코드/간단한 설명/영향받는 결론 또는 근거 참조. 추측을 위험 사실로 확정하지 않는다. |
| suggested_actions[] | 제안 type/intent/mode와 typed arguments 후보. 아직 Gateway 승인/실행된 action이 아니다. |
| needs_user_input | 정보 부족이나 중요한 의사 확인이 필요한지 나타내는 boolean. 불필요한 질문을 강요하지 않는다. |

공통 envelope 제안: contract_version, run_id, result_status, as_of.
result_status는 OK / NO_RECOMMENDATION / NEEDS_INPUT / NOT_RUN / ERROR를 구분한다.
미실행·오류를 성공한 빈 추천으로 숨기지 않으며 부분 실패는 coordinator가 명시한다.
run_id는 관측용 식별자 제안이지 기존 request_id/action_id idempotency를 대체하지 않는다.

Evidence 제안 구조: evidence_ref, source_type, observed_at, summary, interpretation, relevance.
Message/Memory/event/다른 opinion 참조를 구분하고 원본까지 서버 내부에서 추적 가능하게 한다.
내부 소유권 ID는 접근 검증에 사용하되 모델에 불필요한 식별자/원문을 그대로 보내지 않는다.
모델에는 필요한 opaque 참조와 짧은 근거만 전달하고 결과 참조를 서버에서 검증한다.
존재하지 않는 근거를 만들어내거나 현재 발화가 과거 근거보다 우선한다는 정책을 confidence로 우회할 수 없다.

모든 역할은 동일한 공통 결과 계약을 따른다. domain별 부가 payload는 versioned capability로 제한한다.
새 Specialist 추가 시 Critic/Arbitrator가 계약/근거/위험 정책으로 검토할 수 있어야 한다.
역할별 문자열 분기마다 Critic/Arbitrator를 전면 재작성하는 구조는 지양한다.
hidden chain-of-thought, 내부 토큰 추론, 장황한 비공개 사고 로그는 저장·공유하지 않는다.

## Data Flow / Invocation

```text
User Message
  -> 추천/선택 협업 필요성 판단
  -> Relevant Context Selection
       <- Memory / Schedule / Relationship providers (필요할 때만)
  -> State Agent
  -> Recommendation Agent
  -> Critic / Reviewer
  -> Arbitrator
  -> opinion-to-action adapter (유효한 제안만)
  -> 기존 Gateway -> 기존 agent_actions -> 기존 Executor -> Domain Tool / DB
```

추천 불필요/사용자 결정/추천 거부에는 협업 호출 및 추가 개인 context 조회를 건너뛴다.
예: `뭐부터 할까?`, `지금 개발할까 쉴까?`는 후보; `오늘 기분 좋아`,
`광안리 다녀왔어`, `내일 3시에 수업 있어`, `오늘은 쉴래`는 협업을 자동 요구하지 않는다.
기존 일반 chat의 Memory retrieval과 Record routing은 별개로 유지한다.
필요성 판단의 구체 계약과 모호한 무질문 갈등 처리 기준은 구현 전에 평가 사례로 확정한다.

각 역할은 자신의 목적에 필요한 context subset만 받는다. 공통 전체 개인정보 bag은 만들지 않는다.
현재 utterance를 먼저 보고 필요한 범위만 읽는다. 전체 DB/history/schedule/goal/place/Memory dump 금지.
ownership, 활성 데이터, 발화 시점 이후 제외, 시간/개수/관련성 제한을 유지한다.
State에는 관련 최신 상태, Recommendation에는 필요한 opinion/근거,
Critic/Arbitrator에는 판단 검토에 필요한 최소 결과/제약만 전달한다.
원문은 현재 발화·직접 근거 추적에 필요한 최소 구간으로 제한한다.

Lv3 Recommendation 개인 context 사용 허가를 모든 Lv4 역할/목적으로 자동 확대하지 않는다.
State 종합 및 Relationship history 전송의 허용 필드·목적·보존·제외 조건은 Phase 0에서 승인 후 적용한다.
기존 Recommendation 전용 context를 Emotion/Body/Cognitive/Daily/Relationship Record 근거로 재사용하지 않는다.

## Record / Reasoning / Execution Boundaries

1. Record extraction: 현재 user 원문에서 기존 domain의 유효한 기록 후보를 추출한다.
2. State/recommendation reasoning: 최소 관련 근거로 독립 의견을 만들고 검토·조정한다.
3. Execution: typed action을 기존 Gateway/persistence/confirmation/Executor로 검증하고 실행한다.

State opinion이나 추천이 기록된 실제 상태/완료 행동/관계 사실로 자동 변환되지 않는다.
multi-action 누락을 고친다는 이유로 Record domain 전부를 Specialist로 옮기지 않는다.
향후 Record candidate extraction을 일반 routing과 분리하는 선택은 Future Work이며 이번 구현 범위가 아니다.

초기 action adapter는 기존 suggest_recommendation 계약에 맞는 제안만 연결한다.
NO_RECOMMENDATION은 가짜 추천 row를 만들지 않는다. 기존 Record는 별도 경로 그대로다.
새 Execute 도입은 별도 승인된 단계이며 사용자 confirmation을 생략하지 않는다.
Agent/Reviewer/Arbitrator가 DB/Tool을 직접 호출해 Gateway/Executor를 우회할 수 없다.

## Friend-like Policy / Reliability

- 잔소리·목표 미달에 대한 죄책감 압박을 하지 않는다. 과거 목표가 현재 휴식을 금지하지 않는다.
- 현재 명시적 의사를 우선하며 과거 Memory는 참고 근거로만 사용한다.
- 명확한 가까운 일정과 관련 안전 제약은 설명하되 모르는 제약/개인 사정을 지어내지 않는다.
- 절충안을 먼저 검토하며 주 제안과 소수 대안으로 선택 부담을 줄인다.
- Critic은 과도한 보수주의·명령자가 아니다. Arbitrator는 사용자 삶의 관리자도 아니다.
- 추천할 필요가 없으면 조용히 있을 수 있고 최종 선택권은 사용자에게 있다.

OpenAI 호출 중 transaction/row lock 금지. DB context read는 호출 전 종료한다.
기존 request_id/action_id, UNIQUE, lease/retry/max attempts/fencing/result reuse를 유지한다.
Specialist timeout/오류는 기존 chat과 다른 domain 기록을 rollback하지 않는다.
초기에는 반복 review loop 대신 1회 검토/조정 경로를 우선하며 추가 재검토의 상한·총 deadline·비용은 Phase 0에서 확정한다.
모델 의견의 충돌을 무한 재호출로 해결하지 않는다. 부분 실패 시 기존 응답/안전한 보류 정책을 사용한다.
새 observability 구조나 run persistence가 필요하면 별도 schema/migration 승인 후 구현한다.

## Specialist Registry / Extensibility

제안 registry entry: name, contract_version, capabilities, enabled, 목적별 context allowlist,
허용 output/mode, timeout/call budget, safe fallback, implementation adapter.
현재 Tool/executor registry와는 역할이 다르며 이것들이 이미 Lv4 registry를 구현한 것은 아니다.
오직 승인된 구현을 등록하며 모델이 임의 Agent를 생성/등록하거나 권한을 확대하지 못한다.
공통 계약 검증과 capability별 context 선택으로 확장하고 고정된 네 역할의 거대한 if/else에 결합하지 않는다.

Place Agent, 조건을 충족한 Memory Agent, 기타 Specialist는 후속 제안 가능하다.
Physical AI/Robotics는 미래 범위로, 별도의 물리 안전장치·사용자 승인·권한 계약이 필수다.
기존 Suggest 허가를 실제 장치 동작 허가로 해석하지 않는다. 이번 범위에 포함하지 않는다.

## Implementation Phases (Proposed)

| Phase | 목적 | 완료 조건 | 예상 영향 범위 |
| --- | --- | --- | --- |
| 0 | Lv3 baseline freeze, 정책 확정 | known limits/기존 회귀 기준 고정, 역할별 전송 허용·필요성·예산·fallback 승인 | 문서와 평가 계획. 기존 의미/metric 변경 없음 |
| 1 | AgentOpinion common schema + registry | strict 계약, 출처/상태/unknown 검증, 미등록 역할 차단, 확장 계약 테스트 | 새 협업 패키지, 기존 domain 유지 |
| 2 | State Agent | 최신/unknown/현재 의사 우선, 근거 없는 진단/쓰기 없음, 합성 사례 검증 | 상태 최소 context adapter와 opinion 생성 |
| 3 | Recommendation adapter / collaboration | State 활용, NO_RECOMMENDATION, 기존 추천 typed 계약·privacy 보존 | 추천 생성 adapter, 기존 persistence 재작성 금지 |
| 4 | Critic | unsupported claim/Memory 과대적용/일정/과추천/모순 구분, 명령 강요 없음 | read-only opinion 검토 |
| 5 | Arbitrator | 충돌·보류·질문·절충 선택의 명확한 정책, 사용자 agency 평가 | 제한된 결과 조정, 직접 Tool 실행 없음 |
| 6 | 기존 Gateway/action/Executor 통합 | 같은 request 중복·동시 요청·승인·rollback·retry/fencing·finalize loss 회귀 성공 | 최소 /chat adapter와 기존 실행 경로 연결 |
| 7 | Multi-Agent run observability | 구조화된 결과/근거/상태/지연/비용만, 비밀·hidden reasoning·전체 개인 context 없음 | 로그/조회 설계, 필요 DB 변경은 별도 승인 |
| 8 | E2E / eval / regression | 품질·무추천·현재 의사·privacy·실패 격리·기존 domain/Memory 회귀, 변동 결과 공개 | 실제 OpenAI 평가/DB 격리 테스트/최종 보고 |

단계마다 목적/완료 기준 충족 전 다음 구현을 시작하지 않는다. Phase 1은 공통 계약 기반만이며 Phase 2 이후는 미구현이다.

## Evaluation / Open Decisions

평가에서는 의미 품질과 결정론적 권한/무결성 테스트를 분리한다.
필수 사례: 현재 의사 > 오래된 Memory, unknown, 모순된 상태, 임박한 일정,
추천 거부/결정 완료, 무관한 관계 근거 제외, 모호한 label, 불필요한 Agent 호출,
Critic 과잉 거부, 유효한 절충안, timeout/부분 실패, duplicate/concurrent request, stale fencing.
기존 Memory metric/기준과 domain 기대값을 협업 성공률 향상을 위해 변경하지 않는다.
같은 LLM 의미 문제는 최대 약 두 번의 합리적 수정 뒤 known limitation으로 기록한다.
권한/개인 context 범위/무결성 문제는 의미 비결정성으로 숨기지 않고 해결한다.

구현 전에 확정할 사항:
- State/Reviewer/Arbitrator와 Relationship history의 OpenAI 목적별 전달 허용, 필드와 사용자 동의 경계.
- 무질문 갈등/단순 감정 공유/완료 결정의 협업 진입 기준과 필요하면 질문할 조건.
- 상태 유효 창·관계 evidence 관련성/시간/개수 및 label 모호성 처리. 기존 120분 창을 새 domain의 정답으로 확장하지 않음.
- 역할별 모델/총 호출 횟수/비용/deadline/review 상한, 오류/부분 성공의 사용자 노출 및 fallback.
- AgentOpinion의 상태/근거 envelope 최종 schema와 action adapter 계약, 관측 로그 보존/접근 권한.
- 일반 답변과 추천 합성의 위치, 같은 request 재시도 시 협업 결과 재사용 및 action ID 안정성.
- 실제 인증 도입 전 허용 환경. user_id만으로 공개 서비스를 안전하다고 선언하지 않음.

제외: 이번 단계의 Agent 구현, 새 migration, Record domain 재설계, Entity/Relation graph,
Human Simulator/Self Model, 자동 수락·실행·삭제, 외부 실시간 위치/날씨 연동, UI 변경.
