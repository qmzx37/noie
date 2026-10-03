# Relationship v0.1 Specification

상태: 구현 계약. HEAD 325c1c4의 기존 Agent 경로를 확장한다.
이번 요청으로 확정한 정책은 이전 설계 초안을 대체한다.

## 1. 기록 철학

NOIE는 사용자가 의미 있게 말한 사람 정보를 원문 evidence로 보존한다.
기록 != 사회관계 fact 확정이다. messages는 수정하지 않는 source of truth다.
FACT / OBSERVATION / STATE / MEANING RELATION / INFERENCE를 구분한다.
FACT도 외부 검증 사실이 아니라 사용자 자신의 명시적 진술이다.
confidence는 추출 확신이며 실제 관계 존재 확률이 아니다.
AI INFERENCE를 사용자의 직접 진술로 저장하지 않는다.

## 2. 기존 Architecture 연결

Orchestrator -> Tool Gateway -> agent_actions -> Common Executor -> Relationship -> PostgreSQL.
record_relationship_event, type=relationship, mode=record, 확인 불필요.
update_relationship_status는 미구현 상태로 유지한다.
한 action의 records[]에 최대 8개 근거를 보존한다.
한 사람의 friend + colleague, 사회관계 + 명시적 상태가 함께 가능하다.
별도 실행 framework나 직접 DB 쓰기 우회 경로는 없다.

## 3. 근거 종류

| record_kind | 의미 | 관계 필드 |
| --- | --- | --- |
| social_relation | 사용자 자신의 명시적 사회관계 FACT | relationship_type 필수, meaning_relation_type NULL |
| relationship_state | 사용자 직접 표현한 불편함/서운함/회복 등 STATE | 두 type 모두 NULL |
| meaning_relation | 팬/롤모델/영향/관심 등 MEANING RELATION | meaning_relation_type 필수, relationship_type NULL |
| observation | 명시된 만남/연락/도움/싸움 등 OBSERVATION | 두 type 모두 NULL |

state enum이나 normalized_state를 추가하지 않는다.
relationship_statement가 사용자의 표현을 그대로 보존한다.
따라서 observation을 friend로, 싸움을 bad relationship으로 바꾸지 않는다.
관찰에는 사용자와 상대의 실제 상호작용 근거가 필요하며 단순 이름 목록은 기록하지 않는다.

## 4. 사회관계

family / friend / colleague / acquaintance / partner / other 여섯 개를 유지한다.
partner는 명시적 연인, 배우자는 family. 사업 파트너는 명시적 other.
other는 알려진 enum 외의 명시적 관계이지 unknown fallback이 아니다.
한 사람에게 여러 종류를 허용하며 overwrite하지 않는다.
"민수는 고등학교 친구인데 지금 회사 동료야"는 friend와 colleague 두 근거다.
사용자와 무관한 "민수와 철수는 친구야"는 social_relation이 아니다.

## 5. 시간과 이력

temporal_scope는 past / current뿐이다.
"민수는 예전에 친구였어"는 past friend.
"민수는 지금 친구야"는 current friend.
과거 근거는 삭제/수정하지 않고 새로운 근거를 append한다.
미래 만남은 Relationship temporal scope가 아니라 Schedule 조건을 별도 적용한다.
valid_from / valid_to / current resolver / supersede / update / delete는 없다.
단발성 완료 사건과 "이야기하고 풀었어"의 완료 회복 근거는 past,
현재 반복 만남/연락과 직접 말한 현재 상태는 current다.
updated_at은 기존 ORM TimestampMixin의 onupdate이며 수정 API는 제공하지 않는다.

## 6. 관계 상태

"민수는 친구인데 요즘 좀 불편해": friend + 명시적 상태 근거.
"민수한테 요즘 서운해": state만, 사회관계 종류 추론 금지.
"민수랑 싸웠어": observation, bad_relationship/state 자동 추론 금지.
"민수랑 이야기하고 풀었어": 새 state 근거, 과거 불편함은 보존.
상대 감정/의도, 갈등 점수, 신뢰/친밀도 등은 만들지 않는다.

## 7. 이름 없는 사람

person_label은 현재 발화에 있는 표현 그대로다.
identity_kind=named / temporary. 실제 이름을 생성하지 않는다.
"헬스장 형", "같은 과 누나", "엄마" 등 식별 가능한 역할 label은 temporary 가능.
"걔", "그 사람", "그 개발자"처럼 식별 정보가 부족한 표현은 보류한다.
다른 날짜의 같은 temporary label을 같은 Entity라고 자동 확정하지 않는다.
named label도 전역 identity가 아니며 동명이인/별칭 병합은 없다.

## 8. 유명인과 의미관계

fan_of / role_model / inspired_by / follows / likes 다섯 개로 시작한다.
"손흥민 팬이야" -> fan_of, friend/acquaintance 금지.
"아이유는 내 롤모델이야" -> role_model.
"유튜버 A를 자주 봐" -> follows 근거; 실제 지인이라는 뜻은 아니다.
"그 개발자한테 영향을 많이 받았어" -> 대상 불충분하면 보류.
"아이유는 실제 내 친구야" -> 사용자 자신의 명시적 social 진술로 기록 가능.
유명인 여부만으로 거부하지 않으며 외부 진위 검증/인물 검색을 하지 않는다.
원문은 사용자 진술이지 외부 검증된 사실이 아님을 유지한다.

## 9. 데이터 계약

relationship_events는 canonical person graph가 아닌 evidence event 테이블이다.

| 필드 | 타입/정책 |
| --- | --- |
| id | PostgreSQL UUID PK, uuid4 + gen_random_uuid() |
| user_id | NOT NULL UUID FK users, RESTRICT |
| conversation_id | NOT NULL UUID FK conversations, RESTRICT |
| message_id | NOT NULL UUID FK messages, RESTRICT, source_message_id 역할 |
| agent_action_id | NOT NULL UUID FK agent_actions, RESTRICT |
| record_index | 0..7, 묶음 내 위치 |
| person_label | nonblank VARCHAR(120), 현재 근거의 정확한 표현 |
| identity_kind | named / temporary CHECK |
| record_kind | 위 4개, 관계 필드 CHECK로 종류 검증 |
| relationship_type | social_relation일 때만 위 6개, 나머지 NULL |
| meaning_relation_type | meaning_relation일 때만 위 5개, 나머지 NULL |
| relationship_statement | nonblank TEXT, 최대 500자 정확한 원문 구간 |
| temporal_scope | past / current CHECK |
| confidence | 유한 숫자 0..1, bool/문자열/NaN/Infinity 거부 |
| metadata | JSONB, metadata_, default=dict, DB {} |
| created_at / updated_at | timezone-aware, 기존 ORM onupdate 정책 |

UNIQUE(agent_action_id, record_index): 같은 action retry/reuse에서 각 근거 최대 1개.
Index(user_id, created_at, id): 최신순 조회.
action row lock과 묶음 전체 transaction으로 일부만 저장된 성공을 방지한다.
UNIQUE(user_id, person_label)은 사용하지 않는다.
같은 말을 새 요청으로 보낸 것은 정상이며 텍스트 비교로 과거 기록을 삭제하지 않는다.
동일 action 안의 완전히 같은 근거 중복은 입력에서 거부한다.

## 10. RECORD / NO RECORD

RECORD:
- 활성 user/conversation의 저장된 user Message 근거.
- 현재 발화에서 label과 온전한 statement를 정확히 추적 가능.
- 명시적 own social/state/meaning 또는 실제 사용자 관련 observation.
- 과거와 현재를 구분하고 enum/nullable/모드/신뢰도 계약 충족.
- 공통 Record threshold 0.40 유지, 모든 근거 중 최저 confidence로 gating.
- numeric confidence가 근거 없는 inference를 정당화하지 않음.

NO positive social RECORD:
- 질문, 가정, 희망, 인용된 가정, 부정/관계 종료.
- 제3자끼리의 관계, 이름 없는 관계를 임의 실명으로 구체화.
- 빈도/장소/감정/싸움만으로 friend/close/enemy를 추론.
NO RECORD가 원문 삭제를 의미하지 않는다.
관계 종료 발화는 새 positive current friend를 만들지 않고 기존 근거도 삭제하지 않는다.
DB/Executor는 role/소유권/활성 상태/원문 구간을 검증한다.
사회관계 명백한 질문/부정/가정의 보수적 방어선도 적용한다.
일반 의미 해석은 LLM이며 원문 substring 검사만으로 의미 진실을 증명하지 않는다.

## 11. Privacy / OpenAI 전달 필드

Relationship authoritative 판단은 현재 user Message뿐이다.
일반 routing에 기존 relevant Memory가 있는 경우 Relationship 후보는 전용 호출로 재판단한다.
전용 Structured Output 호출의 user payload는 current_user_utterance 하나뿐이다.
Recommendation context, Emotion/Body/Cognitive/Schedule/Goal/Daily/Place/Memory를 추가하지 않는다.
전용 응답은 Relationship action 하나 또는 actions=[]만 허용한다.
Memory를 받았던 초안의 관계 인자는 버리고 전용 결과로만 교체한다.
기존 다른 Record routing과 Memory retrieval은 그대로 보존한다.
Recommendation 전용 context 호출에서는 Relationship 판단/실행을 허용하지 않는다.
원문 전체 history/DB dump, 상대 개인정보 검색/보충, Entity resolution은 없다.
현재 사용자 발화에 나온 사람 표현 전송은 이번 구현 요청의 분석 목적에 한정한다.
별도 연락처/과거 관계 정보/다른 domain context 전송 허가로 확대하지 않는다.

## 12. 안전한 저장과 /chat

OpenAI 호출은 DB transaction/row lock 밖에서 수행한다.
Common Executor의 lease / retry / max attempts / attempt fencing / result reuse를 사용한다.
현재 action row lock 아래 활성 소유자/대화/user Message 연결을 재검증한다.
원문 content는 변경하지 않고 statement가 원문에 있는지 재확인한다.
commit 전 오류는 rollback, domain commit 후 finalize 유실은 최초 묶음 reuse.
만료 lease/이전 attempt는 쓰기를 거부한다.
같은 chat request의 Relationship action ID는 routing 순서에 독립적이다.
Relationship 실패는 기본 reply와 다른 domain transaction을 rollback하지 않는다.
사용자 원문 선행 commit 및 최종 assistant 원문 저장은 변경하지 않는다.

## 13. Read API 의미와 노출

GET /relationship-events/{event_id}?user_id=UUID
GET /users/{user_id}/relationship-events?limit=50
활성 소유자 필터, 기본 50/최대 100, created_at DESC/id DESC.
반환값은 당시의 person/relationship evidence records, 최종 현재 인간관계 정답이 아니다.
다른 소유자/없는 기록은 동일한 404.
user_id 필터는 인증이 아니며 공개 배포 전 인증/접근 통제 검토가 필요하다.
update/delete/supersede/current resolver API 없음.

## 14. 검증과 제외

새 migration은 20261003_0017 하나, 기존 0016까지 수정하지 않는다.
실제 DB 양성/음성/소유권/role/UNIQUE/CHECK/원문 보존 검사.
duplicate, concurrency, rollback, finalize loss/reuse, stale fencing, multi-action 실패 격리.
실제 OpenAI 의미 eval과 /chat E2E, 기존 모든 domain 및 Memory 회귀.
Alembic single head/drift, health, syntax/import/mapper, tsc/diff-check.
DB 쓰기 검사 간섭은 검사 완화 없이 순차 재실행한다.
LLM 의미 경계 튜닝은 동일 문제 약 2회 후 known limitation으로 기록한다.
privacy/access/integrity/duplicate/transaction/fencing/regression은 반드시 수정한다.
downgrade는 새 근거 데이터를 삭제하므로 실데이터 DB에서는 실행하지 않는다.

제외: 친밀도/신뢰/갈등 점수, 빈도 기반 사실 추론, 관계 graph/prediction,
상대 성격/의도, Entity resolution, 자동 병합/삭제/현재 상태 정정,
Recommendation에 관계 context 추가, 연락처/GPS/SNS, mobile UI 변경.

## 15. 일반 /chat routing 조사와 Known Limitations (2026-10-03)

실제 한국어 /chat 추적에서 Daily 누락은 OpenAI 원본 structured output에서 최초 발생했다.
Relationship은 normalization, Gateway, agent_actions 등록, Executor 완료까지 보존됐다.
기존 "사람 만남은 relationship event만 기록" 문구를 관계 강도 추론 제한으로 좁히고,
명시적 관계와 사용자 완료 생활 사건의 독립 routing을 두 차례의 prompt 수정으로 보완했다.
Gateway/Executor 저장 흐름, Recommendation 목적/개인 context 경계, DB schema와 0017은 재작성하지 않았다.
진단용 PowerShell stdin은 UTF-8을 지정해야 한다. ASCII로 손상된 문장은 한국어 routing 평가 근거가 아니다.

일반 routing 8-case 통과 및 실제 /chat 7-case 통과 실행이 있었지만,
반복 /chat에서는 Daily가 다시 선택되지 않은 실행도 확인됐다. 항상 두 action을 보장한다고 주장하지 않는다.
Relationship 전용 22-case도 22/22 이후 반복에서 21/22가 나왔다.
"민수는 이제 친구가 아니야"를 positive social이 아닌 원문 relationship_state로 분류한 결과가
현재 평가의 actions=[] 기대와 불일치했다. 평가 기대값은 변경하지 않았다.
이 두 의미 경계는 추가 prompt tuning 없이 남은 한계로 기록한다.

명백한 미래 희망/계획을 observation/current state로 오분류한 후보는 기존 원문 검증에서 fail-closed 처리한다.
이는 모든 한국어 시간 표현을 해석하는 parser가 아니며 복합 문장은 보수적으로 보류할 수 있다.
원본 Message는 그대로 보존되며 미래에 대해 이야기했던 실제 과거 대화 사건은 별도 양성 테스트로 확인한다.

이번 회귀에서 Chat Integration 9/9, Daily 20/20, Daily hardening 11/11,
Recommendation DB/계약/목적 제한 108개는 통과했다.
실제 OpenAI Recommendation 의미 평가는 13/15로, 할 일 혼란의 Cognitive 중복 점수 충돌은
기존 validator에서 routing 전체를 거부했고 가까운 약속 사례는 추천이 선택되지 않았다.
validator나 평가 기대값을 완화하지 않았으며 Recommendation prompt를 별도로 수정하지 않았다.
Memory smoke 5-case는 검색 적중/현재 발화 우선 100%, 무관 검색 0%, 답변 정보 OFF 25%/ON 100%였다.
평가 대상 messages/memories/memory_evidence/memory_extractions/chat_requests의 전후 row count는 같았다.
미래 관찰/상태 저장 차단은 실제 Executor와 PostgreSQL에서도 failed/0 row/원문 보존으로 확인했다.
schema/0017/UI 변경, commit/push는 없으며 모든 의미 경계의 반복 안정화 완료로 선언하지 않는다.
