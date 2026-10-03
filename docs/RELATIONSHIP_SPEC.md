# Relationship v0.1 Specification

상태: 구현 전 설계 초안. 이 문서는 코드, API, 테이블 또는 migration을 추가하지 않는다.
조사 기준: HEAD `e30d4d1`의 Agent backend와 Recommendation v0.1.
미결정 정책은 마지막 결정 목록을 확인하고 구현 전에 확정한다.

## 1. 목적과 사실의 의미

현재 사용자가 자신의 사람 관계를 명시적으로 표현한 사실을 보수적으로 기록한다.
사용자의 관계를 평가하거나 통제하지 않고, 언급/행동 빈도로 친밀도나 관계 의미를 추론하지 않는다.

FACT는 외부에서 검증된 객관적 신분이 아니라 현재 사용자의 명시적 관계 진술이다.
`messages`는 실제 발화 원문이고, Relationship row는 그 진술의 구조화된 기록이다.
이 둘을 합치거나 원문을 수정하지 않는다. confidence는 진술 추출의 확신이지 실제 관계 존재 확률이 아니다.

예: "민수는 내 고등학교 친구야", "지영이는 회사 동료야".
"엄마랑 오늘 저녁 먹기로 했어"는 가족 맥락과 약속 표현이지만 이름 식별과 Schedule 조건을 별도로 검증한다.
한 번 저장된 진술이 상대방의 현재 상태/의사 또는 영구적인 관계 상태를 보장하지 않는다.

## 2. 현재 코드와 연결 위치

- 기존 경로: Orchestrator -> Tool Gateway -> agent_actions persistence -> Executor -> Domain Tool / DB.
- `agent/tool_registry.py`의 `record_relationship_event`는 Record placeholder이며
  planning_supported=false, implemented=false다. `update_relationship_status`도 실제 미구현이다.
- 현재 Orchestrator/Gateway에는 Relationship용 typed arguments가 없으며 업무 Executor/모델/조회 라우트도 없다.
- `/chat` 자동 Record 목록에는 Emotion, Daily, Dream, Place, Body, Cognitive가 있으며 Relationship은 없다.
- Schedule은 Execute 확인 대기 후 실행한다. Recommendation은 별도의 필요성 분기와 추천 전용 context를 사용한다.
- 기존 도메인은 Agent Action FK, UNIQUE, 원문 Message FK, 사용자 소유권과 짧은 transaction을 사용한다.

향후 구현에서는 새 실행 framework 없이 위 경로에 typed arguments와 업무 Tool을 연결한다.
Relationship Agent가 직접 DB를 쓰거나 기존 Memory extraction을 관계 저장 우회 경로로 사용하지 않는다.
이 문서는 placeholder 활성화나 `/chat` 자동 실행 목록 변경을 승인/실행하지 않는다.

## 3. FACT / OBSERVATION / INFERENCE

| 구분 | 예 | Relationship 처리 |
| --- | --- | --- |
| FACT | "민수는 내 친구야" | 이름과 현재 자기 관계가 명확하면 Record 후보 |
| OBSERVATION | "민수를 이번 주에 세 번 만났어" | 관계 종류를 생성하지 않음. 완료 사건은 Daily 조건을 별도 검토 |
| INFERENCE | "세 번 만났으니 민수와 매우 가까운 사이일 거야" | 관계 사실로 저장하지 않음 |

사용자가 "민수와 친해"라고 직접 말하더라도 v0.1의 친밀도 필드를 만드는 것이 아니다.
현재 관계 종류가 명시되지 않았다면 이를 friend로 변환하지 않는다. 원문은 Message에 남는다.

## 4. 자동 사실화 금지

- 자주 만남 = 친한 친구, 자주 연락함 = 가까운 사이로 바꾸지 않는다.
- 같이 일함 = 좋아하는 사람, 한 번 싸움 = 관계가 나쁨으로 바꾸지 않는다.
- 한 번 즐거웠음 = 친밀함, 같은 장소에 있었음 = 특정 관계로 바꾸지 않는다.
- 유명인 반복 언급 = 실제 지인으로 바꾸지 않는다.
- 사용자의 감정 상태를 상대와의 관계 상태나 상대의 감정/의도로 변환하지 않는다.
- 높은 confidence라도 추론, 모호한 이름, 잘못된 주체를 사실로 정당화할 수 없다.
- 과거 Memory의 인물/관계를 현재 발화에 없는 이름이나 관계 종류로 채우지 않는다.

## 5. Record 적격성과 NO RECORD

자동 Record 후보는 아래 조건을 모두 만족해야 한다.

1. 현재 활성 사용자의 저장된 `role=user` Message가 근거다.
2. 관계 주체가 현재 사용자이며 상대 이름이 현재 발화에 명시돼 있다.
3. 관계 종류가 현재 유효하다는 긍정 진술이 있고, 인용/농담/가정/질문/부정/종료/타인 관계가 아니다.
4. 사람과 관계 종류가 충분히 명확하고 아래 제외 조건에 해당하지 않는다.
5. Gateway 정책과 typed arguments 검증을 만족하며 실제 Executor에서 소유권/근거를 재확인한다.

| 현재 발화 | Relationship 판단 |
| --- | --- |
| "민수는 내 고등학교 친구야" | friend 후보, 고등학교 맥락은 진술에 보존 |
| "지영이는 내 회사 동료야" | colleague 후보, 회사 이름/직급을 추가 추정하지 않음 |
| "영희는 내 엄마야" | family 후보 |
| "민수랑 어제 세 번 만났어" | NO RECORD: 빈도로 관계 종류를 추론하지 않음 |
| "민수가 내 친구였으면 좋겠다" | NO RECORD: 가정/희망 |
| "민수가 내 친구야?" | NO RECORD: 질문 |
| "지영의 친구는 민수래" | NO RECORD: 제3자의 관계 |
| "민수는 예전에 내 친구였어" | NO RECORD: 과거만 진술 |
| "민수는 더 이상 내 친구가 아니야" | 새 current friend Record 금지, 기존 row 자동 변경/삭제도 금지 |
| "민수와 싸워서 화나" | 관계 종류 없음. Emotion/Daily는 각각 현재 조건 검토 |
| "손흥민을 자주 이야기해" | NO RECORD: 언급은 실제 개인 관계가 아님 |
| "해리 포터는 내 친구야" | NO RECORD: 가상 인물 관계를 실제 관계로 저장하지 않음 |
| "친구랑 카페 가고 싶어" | NO RECORD: 상대 이름이 없고 이미 명확한 희망을 임의 관계로 구체화하지 않음 |

NO RECORD는 관계 row를 만들지 않는다는 뜻이다. 원문이나 유효한 다른 도메인 기록을 버리지 않는다.

## 6. 이름, 유명인과 모호성

- `person_name`은 현재 발화의 명시적 이름 표현을 보존한다. 임의 실명, 성별, 연락처, 별칭 연결을 만들지 않는다.
- "친구", "형", "누나", "걔", "그 사람"만으로 새 row를 만들지 않는다.
- "엄마"만 있는 경우에도 v0.1 기본 초안은 이름 없는 row 생성을 보류한다.
  가족 역할만으로 대상을 허용할지는 구현 전 별도 결정한다. 약속 원문은 그대로 보존한다.
- 명확한 이름은 진술 대상을 표현할 뿐 전역적으로 유일한 person identity가 아니다.
- 같은 이름의 다른 사람을 합치지 않고 다른 사용자의 동명이인을 연결하지 않는다.
- 유명인/가상 인물 언급 또는 그런 관계 주장도 실제 개인 관계로 자동 기록하지 않는다.
- 이름만으로 유명인 여부를 확정할 수 없는 동명이인/모호한 대상은 보류한다.
  유명인 판별을 위해 검색/외부 조회나 인물 DB 연동을 몰래 추가하지 않는다.
- alias, 대명사 해소, 동명이인 분리, Entity Resolution은 미래 범위다.

## 7. 최소 관계 종류 제안

애플리케이션 enum은 다음 6개로 제안한다. 아직 코드나 PostgreSQL ENUM을 만들지 않는다.
현재 Dream/Place 패턴처럼 Pydantic Literal + VARCHAR/CHECK를 우선 검토해 DB ENUM 고정 비용을 피한다.

| 값 | 명시적 표현 범위 | 주의 |
| --- | --- | --- |
| family | 부모/형제/자녀/배우자 등 가족임을 직접 진술 | 가족 세부 호칭은 statement에 보존 |
| friend | 친구임을 직접 진술 | 고등학교 친구 등을 추가 enum으로 나누지 않음 |
| colleague | 직장/업무 동료임을 직접 진술 | 함께 일했다는 사건만으로 생성하지 않음 |
| acquaintance | 아는 사이/지인임을 직접 진술 | 관계 종류를 모른다는 뜻이 아님 |
| partner | 애인/연인임을 직접 진술 | 배우자는 기본 family 제안. 사업 파트너를 연인으로 변환하지 않음 |
| other | 스승 등 enum 밖의 관계가 명확히 진술됨 | 모호/unknown을 저장하는 fallback이 아님 |

매핑 불확실성은 NO RECORD/검토 대상으로 둔다. 친밀도나 우열에 따른 관계 등급은 없다.
partner와 family의 중첩, other의 허용 표현은 구현 전에 최종 확정한다.

## 8. 데이터 구조 제안

테이블명 초안은 `relationship_events`다. 사람 마스터나 현재 관계 graph가 아니라 근거 있는 진술 이벤트다.
아래는 미래 구현을 위한 제안이며 실제 DB 변경이 아니다.

| 필드 | 제안 | 근거/제한 |
| --- | --- | --- |
| id | UUID PK | ORM uuid4 + DB gen_random_uuid(), 기존 방식 재사용 |
| person_name | VARCHAR(120), NOT NULL | 현재 발화에 있는 이름, nonblank, 임의 alias 정규화 금지 |
| relationship_type | VARCHAR(20), NOT NULL, CHECK 6개 | 위 최소 enum, unknown 금지 |
| relationship_statement | TEXT, NOT NULL | 관계 진술의 최소 원문 구간, 입력 최대 300자/nonblank 제안, 사실 추가/요약 금지 |
| confidence | 유한 숫자 0..1, NOT NULL | 추출 확신, bool/NaN/Infinity 거부, DB CHECK |
| source_message_id | UUID FK, NOT NULL | 실제 user Message 증거. DB 컬럼은 기존 명명과 맞춘 message_id, API 명칭은 alias 검토 |
| conversation_id | UUID FK, NOT NULL 제안 | 근거 Message의 정확한 대화, 클라이언트 값을 그대로 믿지 않음 |
| user_id | UUID FK, NOT NULL | 현재 발화 소유자 |
| agent_action_id | UUID FK, NOT NULL, UNIQUE | 기존 AgentAction.id 연결, 같은 Action retry는 row 재사용 |
| metadata | JSONB, NOT NULL | Python metadata_, default=dict/DB {}, version/explicit_user_statement 근거 종류 등 최소 추적 정보 |
| created_at / updated_at | timezone-aware timestamp | 기존 TimestampMixin/ORM onupdate 정책, 새 trigger 없음 |

모든 FK는 원문 보호를 위해 RESTRICT 제안이다. 도메인 쓰기에도 활성 user/conversation과 Message의 role/소유권을 검증한다.
조회 인덱스는 `(user_id, created_at, id)`, 최신순은 created_at DESC/id DESC를 우선 제안한다.
metadata에 친밀도, 상대 성격, 감정 추측, 연락처, 전체 대화 history를 넣어 제한을 우회하지 않는다.
statement는 안전한 원문 구간 추출이다. 길이를 넘거나 근거 구간이 불명확하면 자의적 요약/잘림 대신 보류한다.

한 Action은 한 사람에 대한 한 관계 진술을 저장하는 것을 기본으로 한다.
같은 Message에 두 명 또는 두 개의 명시적 관계가 있으면 별도 action으로 표현하는 방식을 검토한다.
`UNIQUE(user_id, person_name)`은 사용하지 않는다. 동명이인과 여러 역할을 부당하게 합치기 때문이다.
다른 Message에서 다시 한 진술은 새 사건이 될 수 있다. 텍스트/이름 비교로 원문이나 사건을 삭제하지 않는다.

## 9. 부정, 종료와 이력

v0.1은 새 긍정 진술 기록만 다룬다. 부정/종료 발화를 기존 긍정 종류로 새로 저장하지 않는다.
기존 row를 자동 삭제, supersede, current status 변경하지 않고 `update_relationship_status`를 자동 실행하지 않는다.
정정/종료 원문은 Message에 남으며 기존 Memory 흐름은 별도로 유지한다.
향후 supersede/history 설계에서는 종료 근거 Message와 시점을 명시적으로 연결해야 한다.

이 제한 때문에 과거 이벤트 목록을 '지금도 모두 유효한 관계 목록'으로 반환/표현하면 안 된다.
향후 조회 화면/API는 당시의 사용자 진술 기록임을 밝혀야 한다. 현재 관계 snapshot 제공은 별도 설계가 필요하다.

## 10. 다른 Domain과 multi-action

Relationship은 Emotion/Daily Life/Schedule/Place/Memory를 대체하지 않는다.
같은 user Message에 서로 다른 직접 근거가 있으면 Relationship + Daily, Emotion, Schedule 등이 가능하다.
각 도메인의 조건과 transaction을 유지하고 관계 기록 실패가 다른 기록을 취소하지 않게 한다.

| 예시 | 조건별 처리 |
| --- | --- |
| "오늘 친구 민수랑 부산역에서 저녁 먹기로 했어" | friend 후보. 정확한 시각이 없으므로 Schedule 생성 불가/확인 필요. 미래 장소라 Place visit/context 아님. 완료 전이므로 Daily도 아님 |
| "오늘 친구 민수랑 부산역에서 저녁 먹었어" | friend + 완료 Daily + 명시적 Place visit 가능. 약속했다고 쓰면 완료로 바꾸지 않음 |
| "내일 오후 7시에 친구 민수랑 부산역에서 저녁 먹기로 했어" | friend + 명시적 timezone이 있으면 Schedule Execute 확인 대기. 미래 부산역을 현재 Place로 기록하지 않음 |
| "친구 민수와 싸워서 화나" | friend가 직접 명시된 경우만 관계 후보, 완료 사건/감정은 Daily/Emotion 별도 검토. 관계가 나쁘다는 상태 생성 금지 |

Schedule에 필요한 날짜/시각/timezone을 Relationship이 추측하지 않는다.
Place에 필요한 실제 방문/현재 위치/명시적 선호를 관계나 약속에서 만들어내지 않는다.
같은 Message의 인물 목록을 Recommendation context에 자동 추가하거나 다른 도메인 판단 근거로 전파하지 않는다.

## 11. 안전한 미래 연결과 목적 제한

- 미래 Tool 이름/intent는 기존 placeholder `record_relationship_event`, type=relationship, mode=record를 우선 재사용한다.
- 충분한 근거가 있어도 schema/Gateway/persistence/Executor 검증 없이 직접 저장하지 않는다.
- 현재 공통 Record threshold는 0.40이다. 이는 의미적 사실 보증이 아니며 Relationship의 별도 엄격한 기준 필요 여부는 미결정이다.
- confidence만 높여 제외 조건을 우회하지 않는다. 새 도메인 기준으로 기존 다른 도메인 threshold를 바꾸지 않는다.
- OpenAI 판단은 현재 발화의 관계 표현 중심으로 수행하고 DB lock 밖에서 완료한다.
- 다른 사람 관계, 오래된 상태, 추천 전용 개인 context를 관계 사실의 근거로 보내거나 사용하지 않는다.
- Recommendation용 과거 개인 context 전송 허가를 Relationship 목적으로 확대하지 않는다.
- 상대방 개인정보의 추가 저장/외부 전송은 별도 목적·최소화·권한 검토가 필요하다. 이번 문서 작업은 API 호출을 하지 않는다.
- 서버가 source_message_id -> conversation/user 연결을 확인한다. 임의 UUID, assistant/system 근거, 삭제된 사용자/대화는 차단한다.
- 기존 lease/retry/fencing/idempotency, attempt/lease 검증, UNIQUE/ON CONFLICT, commit/finalize 분리를 재사용한다.
- commit 전 실패는 rollback한다. commit 후 finalize 유실 retry는 같은 이벤트를 재사용하며 stale attempt는 반영되지 않는다.
- `/chat`의 user 원문 선행 commit과 최종 assistant 원문 저장을 보존하고 실패를 격리한다.
- 로그인 없는 개발용 user_id 필터는 인증이 아니다. 공개 배포의 인증/접근 통제는 별도 검토한다.

## 12. 구현 전 결정 목록

1. 가족 역할만 있는 "엄마/형/누나"와 명시적 애칭을 식별 가능한 대상으로 허용할지. 기본 초안은 이름 없으면 보류한다.
2. 유명인과 동명이인의 구분을 외부 조회 없이 어떻게 검증할지. 기본은 모호하면 보류하며 새 Entity Resolution은 하지 않는다.
3. partner/family 중첩과 other 허용 범위, 여러 명/여러 관계의 action 수와 근거 구간 계약.
4. source_message_id의 API alias와 필수 Message/conversation FK, 최대 이름/진술 길이를 최종 확정할지.
5. 공통 0.40 외 별도의 보수적 Relationship threshold가 필요한지. 의미 테스트로 결정하고 기존 정책은 유지한다.
6. 부정/종료 진술 이후 과거 긍정 이벤트를 어떻게 표시할지. v0.1은 자동 상태 갱신하지 않으며 current snapshot은 제공하지 않는다.
7. 읽기 API 범위, 인증 전 개발용 접근 제한, 보관/삭제와 민감한 관계 정보 정책. v0.1 구현 전에 목적과 노출 범위를 확정한다.

## 13. 미래 구현의 검증 기준

- 위 양성/음성 사례, 이름/주체/현재성/가정/부정/종료/유명인/가상 인물/동명이인 경계.
- 충분한 이름/관계 근거 없이 높은 confidence만 반환하는 경우 저장 거부.
- 실제 PostgreSQL 원문 근거 FK, 소유권, 다른 user/assistant/system/없는 Message 접근 차단.
- duplicate request/action과 동시 실행에서 같은 Action 이벤트 최대 1개, 새 요청의 동일 진술은 정상 기록.
- rollback, domain commit 후 finalize 유실/reuse, stale lease/attempt fencing, retry 상한.
- multi-action에서 다른 도메인의 계약/저장 결과가 유지되고 실패가 `/chat` reply를 깨뜨리지 않음.
- 기존 전체 regression, 실제 `/db-health`, Alembic single head/drift, syntax/import/mapper, tsc/diff-check.
- 의미 변동성 튜닝은 같은 경계 최대 약 2회. privacy/access/중복/transaction 문제는 반드시 해결한다.

이 목록은 미래 검증 계획이다. 이번 문서 작업에서 DB 테스트나 OpenAI 호출을 실행했다는 뜻이 아니다.

## 14. v0.1 제외와 미래 확장

친밀도 점수, contact frequency, relationship graph, trust/conflict score, 관계 예측,
상대방 성격/의도 자동 추론, Entity/Relation Graph, 추천에 관계 context 자동 활용,
연락처/GPS/SNS 연동, 자동 관계 병합/삭제/종료 갱신은 구현하지 않는다.
Memory v2 / Entity Relation Graph 연결 가능성은 근거 UUID와 사용자 경계를 보존하는 설계 수준에서만 남긴다.
새 Agent, API, migration, UI, 현재 관계 자동 갱신은 다음 작업에서 별도 승인·구현·검증한다.
