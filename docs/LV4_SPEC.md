# NOIE Lv4 Multi-Agent Specification

## Status / Purpose

**Lv3/Lv4는 NOIE 내부 개발 단계 이름이며 공식 업계 레벨 표준이 아니다.**
상태: Phase 1~5 Specialist와 Phase 6 독립 Collaboration Pipeline 구현. 기존 production runtime은 미연결.
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

Phase 2 v0.1은 OpenAI 없이 typed StateContext를 받아 관찰을 나란히 정리한다.
Emotion은 기존 F/A/D/J/C/G/T/R, Body/Cognitive는 기존 축 이름과 nullable 값을 사용한다.
DB ID/metadata/다른 domain context를 받지 않으며 공통 입력 호환용 current_utterance는 고정 문자열이다.
StateContext의 as_of와 선택적 max_age_seconds는 호출자가 제공한다. Agent 내부 고정 유효 창/decay는 없다.
기준 이후/유효 창 초과 관찰은 evidence에는 보존하고 종합·confidence 집계에서 제외한다.
시각 미상/시점 차이/유효 창 미지정은 risks로 표시하며 결론은 최신 상태라고 확정하지 않는다.
confidence는 사용한 domain confidence의 최솟값이며 하나라도 None이면 None이다.
partial 또는 유효 관찰 없음은 NEEDS_INPUT, 후자는 insufficient_context risk로 표현한다.
suggested_actions는 항상 빈 목록이며 등록은 테스트에서만 명시적으로 수행한다.

### Recommendation Agent

- 입력: 현재 발화, State opinion, 질문 관련 기존 Memory retrieval, 필요한 Schedule/Relationship evidence context.
- 역할: 다음 선택/행동 후보를 작게 제안하며 tradeoff와 최소 근거를 제시한다.
- 이미 결정한 사용자, 추천 거부, 단순 보고에는 NO_RECOMMENDATION이 정상 결과다.
- 현재 질문의 근거가 부족하면 개인 사정을 지어내지 않고 현재 발화 중심 제안 또는 질문/보류를 반환한다.
- 기존 Suggest 종류·threshold·인자 계약을 adapter로 재사용한다. 실제 행동 실행 권한은 없다.

Phase 3 v0.1은 `RecommendationContext`의 current_utterance/reference_time, 선택적 State opinion,
Memory 최대 4개, Schedule 최대 3개, Relationship 최대 3개만 입력받는다. 모든 중첩 extra field/비유한 score를 거부한다.
State는 기존 opinion의 120분 내 관찰 근거만 참고한다. 제외된 상태가 섞이면 원래 결론도 전송하지 않는다.
Memory는 기존 관련성 helper, .55/Top-K 4를 유지한다. 전체 검색/DB 조회는 하지 않는다.
Schedule은 관련성 .55 이상, 진행 중 또는 기본 2시간/오늘·내일 계획 최대 24시간 범위로 제한한다.
Relationship은 질문에 명시된 person_label의 관련 사용자 진술만 받으며 현재 관계 정답/상대 의도로 확대하지 않는다.
기준 시각 이후 Memory/State/Relationship은 제외한다. Memory/관계의 과거·시각 미상 자료는 참고 이력이지 최신 사실이 아니다.
reasoner는 명시적으로 주입한다. `OpenAIRecommendationAdapter`는 기존 ORCHESTRATOR_SYSTEM_PROMPT,
추천 전용 JSON Schema와 RecommendationArguments를 재사용하며 used_evidence_refs 및 필수 정보 질문 필드를 출력 계약에 추가한다.
실제 OpenAI 호출은 adapter를 명시적으로 주입해 run할 때만 가능하며 이번 검증은 fake client만 사용한다.
전달 payload: current_user_utterance, reference_time, 최소화한 state_opinion(name/conclusion/confidence/status/needs_user_input),
recommendation_evidence(source_type/summary/opaque evidence_ref/observed_at/interpretation/relevance).
State 근거는 별도 evidence로 전달해 중복하지 않는다. 내부 DB ID/metadata/Goal/전체 history는 전달하지 않는다.
기존 recommendation_needed로 결정/보고/추천 거부를 reasoning 전에 제외하며, 출력이 참조한 허용 근거만 opinion에 남긴다.
현재 발화 참조와 관련 일정 참조를 요구한다. 최대 두 후보는 Suggest이며 저장/실행하지 않는다.
명백한 강제 표현과 일정 시작을 초과하는 명시적 숫자 소요 시간은 보수적으로 거부한다. 자연어 의미 전체를 검증하는 Critic이 아니다.
원래 필요성·주제 필터의 보수성, 자연어 시간/의도·일정 충돌 해석, LLM 지목 근거의 실제 사용 여부는 한계다.
예컨대 단독 '2시간 더 개발하고 싶어'는 기존 필요성 필터에서 제외될 수 있으며 별도 hardcode/정책 변경으로 강제 추천하지 않는다.
반환 오류는 안전한 보류/예외로 남기며 생성에 실패한 의견을 성공으로 위장하지 않는다. 제품 runtime에는 연결하지 않는다.

### Critic / Reviewer (검토자)

- 입력: 목적에 필요한 opinion과 최소 근거, 현재 의사 및 명확한 일정/안전 제약.
- 검사: 근거 없는 추론, 사용자 의사 침해, 과거 Memory 과대적용, 일정 충돌, 과한 추천, 의견 모순.
- 결과: 어떤 결론의 어떤 근거/위험을 보완할지 구조화해 제시한다. hidden reasoning은 요청하지 않는다.
- 최종 결정권자가 아니고 위험을 과장하는 보수적 명령자도 아니다. 데이터 부족과 실제 충돌을 구분한다.

Phase 4 v0.1은 typed CriticContext(현재 발화, 선택적 State/Recommendation opinion,
선택적 reference_time, 최소 Memory/Schedule/Relationship 제약)만 받고 DB/OpenAI를 호출하지 않는다.
역할 이름과 중첩 extra/score/시각 계약을 검증한다. 기존 State/Recommendation 구현은 수정하지 않는다.
명백한 현재 휴식 결정 침해, 강제/죄책감 표현, 과거 기억의 절대화, 관계 의도 과해석,
관찰 없는 상태 단정, 일부 axis 모순, 낮은 confidence의 강한 단정, 명시적 일정/시간 충돌을 검사한다.
State v0.1의 axis=value 근거를 읽으며 unknown을 다른 domain 점수로 채우지 않는다.
ENG 낮음+MOT 높음, FOC 높음+LOD 높음, CLR 높음+UNC 높음은 모순으로 취급하지 않는다.
과거 피로 경험과 2시간 이상 명시적 제안은 재평가 참고 risk이지 STOP/행동 취소 조건이 아니다.
PASS와 concerns는 공통 result_status=OK의 conclusion/risks로 구분한다.
검토 대상/필수 시각/처리 결과가 부족하면 NEEDS_INPUT이며 NO_RECOMMENDATION은 정상 검토 결과다.
수정 방향은 최대 2개의 reflection/review_opinion/Suggest 후보다. 실제 Tool 호출이나 추천 재작성 확정이 아니다.
confidence는 제공된 opinion confidence의 최솟값, 하나라도 unknown이면 None이며 의미 검증 정확도가 아니다.
risk 8개 초과 시 앞 7개와 추가 코드 요약을 반환한다. 문제 근거만 중복 제거해 최대 16개 보존한다.
결정론적 한국어 표현/숫자 시간 검사는 완전한 의미·시간·인과 parser가 아니다.
조건/부정/인용/복합 문장에 오탐·미탐이 가능하며 PASS가 모든 의미의 안전성을 보증하지 않는다.
관련성/소유권/동일 사용자 근거의 선별은 호출자 책임이고 이 계층은 인증이나 Entity resolution을 하지 않는다.
Arbitrator, 자동 등록, /chat, Gateway, Executor, DB 저장과 연결하지 않는다.

### Arbitrator (조정자 / 중재자)

- 입력: Specialist opinion, Critic 지적, 허용된 공통 정책과 최소 근거.
- 역할: 충돌을 정리해 제안/절충안/질문/NO_RECOMMENDATION 중 최종 사용자용 판단을 만든다.
- 우선순위: 접근·목적·실행 안전 경계 -> 현재 사용자 명시적 의사 -> 명확한 관련 제약 -> 관련 최신 근거 -> 과거 해석.
- 안전 경계가 과거 목표를 근거로 사용자를 강제하는 명분이 되어서는 안 된다.
- Specialist의 confidence 평균만으로 진실을 정하지 않는다. 권한 없는 제안은 Gateway에 보내지 않는다.
- 최종 판단은 AI 응답 정리이며 인간의 최종 선택권을 대체하지 않는다.

Phase 5 v0.1은 OpenAI 없이 최소 ArbitratorContext(current_utterance, 선택적 State/Recommendation/Critic
opinion, 선택적 reference_time)를 받는다. 전체 Recommendation/Critic context, DB ID/metadata/history는 받지 않는다.
State는 관찰, Recommendation은 기존 후보, Critic은 지적, Arbitrator는 최종 협업 의견을 담당한다.
최종 협업 의견도 실제 행동 실행권이나 사용자 대신 결정할 권한은 아니다.
판단은 현재 명시적 결정 -> 추천에 실제 참조된 직접 관찰 -> 연결된 가까운 제약 -> 과거 근거 순서다.
현재 결정/추천 거부는 NO_RECOMMENDATION, 뒤에서 다시 선택 질문을 하면 조정 가능하다.
Recommendation의 NO_RECOMMENDATION을 보존하고 State/Critic만으로 새 행동을 생성하지 않는다.
추천은 현재 발화와 정확히 일치하는 utterance evidence가 필요하다. 이름/높은 confidence만으로 승인하지 않는다.
Critic은 현재 발화 또는 해당 추천 인용 근거가 연결된 경우만 사용한다. 실패/근거 없는 지적은 자동 veto가 아니다.
과거 피로 risk/일정 충돌은 기존 행동의 명시적 소요를 빼고 짧은 시간 경계 후 재선택으로 완화한다.
새 고정 분/시간, 이동 소요, 새 행동을 만들지 않는다. 일정 전 가능한 범위라는 조건은 일정 충돌의 해소 증명이 아니다.
unsupported inference는 분리 가능한 인과절만 제거한다. 분리 불가/중요한 모순/강제 후보는 보류한다.
낮은 confidence의 과도한 확신은 지적된 후보의 단정 표현만 완화한다. 새로운 위험 탐지기는 구현하지 않는다.
약한 concern은 선택을 취소하지 않는다. State partial 자체도 추가 질문을 강제하지 않는다.
선택 근거/후보/필수 정보가 실제로 없거나 중요 충돌이 미해결이면 NEEDS_INPUT이고 후보는 비운다.
confidence는 실제 사용한 opinion들의 min, 하나라도 None이면 None이다. 현재 결정만 사용하면 None이다.
중요 미해결 충돌 및 unsupported/schedule/확신 과장 조정은 알려진 min의 0.5배다. max/평균/성공 확률로 해석하지 않는다.
최종 evidence는 현재 발화와 실제 사용한 근거만 중복 제거해 최대 16개다. 잘못된 추천 인용은 interpretation=True다.
risks는 최대 8개(초과 코드 요약), 후보는 원래 후보에서 최대 2개, mode=suggest만 허용한다.
Registry는 테스트에서만 명시적 등록한다. /chat/DB/agent_actions/Gateway/Executor/production pipeline과 연결하지 않는다.
결정/부정/인용/인과절의 한국어 의미 경계는 제한된 규칙이다. Critic 미검출 오류의 복구나 후보별 risk attribution은 보장하지 않는다.
근거의 소유권/관련성 선별과 의견의 동일 요청 연결은 호출자 책임이다. PASS가 안전/실행 승인을 의미하지 않는다.

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
공통 계약/registry에는 DB/Memory/context loader/OpenAI 실행이나 실제 Agent 자동 등록이 없다.
Phase 3의 선택적 OpenAI adapter는 별도 주입 경계이며 기존 chat import 경로와 미연결이다.

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

Phase 6 v0.1은 위 흐름 중 State -> Recommendation -> Critic -> Arbitrator만 Python에서 연결한다.
후속 action adapter/Gateway/agent_actions/Executor 및 /chat 연결은 아직 구현하지 않는다.
`Lv4CollaborationContext`는 원문 current_utterance, reference_time, 기존 StateContext와
기존 CriticConstraints(Memory 4/Schedule 3/Relationship 3)를 재사용한다. 상태 축 schema를 복제하지 않는다.
StateContext.as_of와 reference_time은 동일 시각이어야 하고 관찰 시각/원문은 수정하지 않는다.
State는 기존 고정 `state observations` 입력으로 관찰만 정리한다. 이후 세 단계는 동일 원문을 받는다.
Recommendation에는 State opinion과 제한된 제약을 전달하고 기존 Specialist의 필터/필요성 판단을 유지한다.
Critic 제약은 기존 prepare_evidence가 선택한 최소 근거로만 투영한다. 무추천이면 별도 제약은 비운다.
Arbitrator에는 현재 발화/기준 시각/세 opinion만 전달하며 raw root context나 추가 Memory bag을 주지 않는다.
Pipeline은 새 판단/추론/추천 정책 없이 context 연결과 고정 순차 실행만 담당한다.
네 Specialist는 필수 외부 주입이며 인스턴스 로컬 registry 계약 검사만 사용한다. 전역 자동 등록은 없다.
`Lv4CollaborationResult`는 네 선택적 opinion, COMPLETED/FAILED, 실패 시 failed_stage/failure_kind만 포함한다.
완료 결과의 최종 협업 의견은 arbitrator_opinion이다. COMPLETED는 사용자 정보가 충분하다는 뜻이 아니다.
NEEDS_INPUT/NO_RECOMMENDATION도 후속 검토/조정을 계속하며 정상 opinion을 그대로 추적한다.
각 단계 예외는 FAILED/exception, 명시적 ERROR/NOT_RUN은 FAILED/reported_failure로 후속 실행을 중단한다.
예외 단계 opinion은 None이고 이전 실제 결과만 보존한다. 명시적 실패 opinion은 해당 단계에 보존한다.
예외 문자열/traceback/내부 객체/로그 dump/가짜 정상 opinion은 만들지 않는다. 잘못된 root/config는 실행 전 예외다.
실행별 상태는 지역 변수이고 재사용 가능하다. retry/cache/timeout/병렬 실행/영속성을 새로 보장하지 않는다.
실제 OpenAI 없이 fake reasoner와 네 실제 Specialist로 계약을 검증한다. 주입 구현의 의미 품질은 별도 검증 대상이다.
DB read/write/Tool 실행/endpoint/migration/UI 변경은 없다. production 연결과 사용자 인증은 후속 별도 승인 범위다.

향후 production 진입 정책에서는 추천 불필요/사용자 결정/추천 거부에 협업 호출 및 추가 개인 context 조회를 건너뛴다.
현재 명시적으로 호출한 독립 pipeline은 진입 판단을 새로 만들지 않고 무추천도 네 단계 모두 거친다.
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
| 6 | 독립 Collaboration Pipeline | 네 단계 순차 실행/최소 context/무추천·정보부족/실패 추적/DI 계약 성공 | 미연결 협업 계층만. /chat/Gateway/action/Executor 통합은 후속 별도 승인 |
| 7 | Multi-Agent run observability | 구조화된 결과/근거/상태/지연/비용만, 비밀·hidden reasoning·전체 개인 context 없음 | 로그/조회 설계, 필요 DB 변경은 별도 승인 |
| 8 | E2E / eval / regression | 품질·무추천·현재 의사·privacy·실패 격리·기존 domain/Memory 회귀, 변동 결과 공개 | 실제 OpenAI 평가/DB 격리 테스트/최종 보고 |

단계마다 목적/완료 기준 충족 전 다음 구현을 시작하지 않는다. Phase 6은 독립 순차 협업 경계이며 Phase 7 이후와 production 통합은 미구현이다.

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
