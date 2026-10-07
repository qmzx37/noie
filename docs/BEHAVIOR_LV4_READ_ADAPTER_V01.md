# Behavior -> Lv4 Read Adapter v0.1

## 범위와 실제 경로

기존 `BehaviorSpecialist`의 읽기 전용 결과를 기존 State -> Recommendation -> Critic -> Arbitrator -> `/chat` reply 경로에 연결합니다. 별도 Agent/pipeline, 활동 기록, DB write, migration, UI 또는 dependency는 추가하지 않습니다.

`try_lv4_production_reply`의 기존 production feature flag, 추천 필요성 gate와 활성 계정 권한 검사 안에서만 `read_behavior`를 호출합니다. 기본 flag 값과 Shadow gate/allowlist는 바꾸지 않습니다. 일반 설명 질문, 단순 보고, flag OFF, cached duplicate는 이 조회를 추가로 실행하지 않습니다.

현재 요청의 `user_message_id` 하나만 조회합니다. 원문의 소유자, conversation 소유자, 활성 user/conversation, user role과 작성자, 현재 요청 text 일치를 기존 owned service에서 검증합니다. dev-user 재선택이나 다른 계정/history 조회는 없습니다. 짧은 조회 세션을 닫고 나서 State와 OpenAI 판단을 실행합니다.

## State 입력과 의미

`StateContext.behaviors`는 optional typed list이며 기본값은 빈 배열, 최대 4개입니다. 다음 정보를 받습니다.

- action: 행동명.
- status: 기존 여섯 상태를 그대로 사용.
- confidence: 기존 값 또는 None. 새 숫자로 채우지 않음.
- evidence: 기존 OpinionEvidence 원문 절, Message 참조, interpretation, 관찰 시점.

| status | 의미 |
| --- | --- |
| performed | 사용자가 했다고 보고 |
| ongoing | 사용자가 하고 있다고 보고 |
| intended | 앞으로 하려는 의도 |
| desired | 하고 싶은 욕구 |
| not_performed | 하지 않았다고 보고 |
| candidate | 선택 또는 고려 후보 |

어떤 상태도 현실 수행 검증을 뜻하지 않습니다. intended/desired/candidate를 performed로 승격하거나 Body/Cognitive/Emotion 숫자로 변환하지 않습니다. confidence 0도 기존 값 그대로 보존하며 사용한 관찰 중 하나라도 unknown이면 State 종합 confidence도 None입니다.

State는 원래 provenance와 별도의 최소 의미 evidence를 나란히 보존합니다. Recommendation의 State 경계는 정확한 Message UUID 참조와 바로 뒤의 유효한 Behavior 의미 관찰이 짝지어진 원문 evidence만 추가 허용합니다. 임의의 다른 domain opinion/action/evidence는 계속 거부합니다.

관찰 시점은 메시지 관찰 시점이며 활동이 실제로 일어난 시각이 아닙니다. 미래/유효 창 초과 관찰은 내부 provenance를 남기되 추천 입력에서 제외합니다. 현재 메시지의 시점이 unknown이면 unknown으로 남기며 timestamp를 만들지 않습니다.

## 질문 관련성 및 외부 전송

명시적 추천/선택 질문 절에서 행동명이 관련되는 경우만 사용합니다. 일반적인 '뭐부터 할까' 같은 질문은 현재 발화에 보고된 행동을 제한적으로 참고합니다. 최대 4개이며 무관한 절의 행동이나 UUID를 포함한 행동명은 제외합니다. 전체 Behavior history는 읽지 않습니다.

사용자가 승인한 Recommendation 목적에만 OpenAI의 기존 단일 Responses 호출에 다음 optional `behavior_observations` 필드를 추가합니다.

| 필드 | 전달 조건 / 목적 |
| --- | --- |
| action | 질문과 관련된 행동명만 전달 |
| status | 기존 여섯 의미로 판단 지원; 수행으로 승격 금지 |
| confidence | 존재하는 숫자만 전달; None이면 키 자체를 생략 |
| observed_at | 기존 timezone-aware 관찰 시점이 있을 때만 ISO 문자열 전달 |
| ref | `behavior_0`~`behavior_3` 호출 내 로컬 참조. 기존 used_evidence_refs 계약 연결용이며 계정/메시지 식별자가 아님 |

추가 Behavior 전송에는 UUID, Message ID, raw evidence 객체, 원문 절, 기타 metadata가 없습니다. 기존 모델 입력의 current_user_utterance는 원래 질문 그대로이며 원문 절을 별도의 Behavior payload에 중복 복제하지 않습니다. 전체 DB/Memory/대화/Behavior dump를 보내지 않습니다.

State 원문 provenance는 reasoner에 넘기기 전에 제거합니다. 제외된 관찰을 담은 State 결론도 최소화합니다. 기존 Memory privacy 정책을 재사용해 민감한 현재 발화/행동은 Behavior context에서 제외합니다. 다른 Record domain의 근거나 Shadow context로 이 허가를 확장하지 않습니다.

Behavior가 있을 때만 user-reported 상태/unknown confidence/시점 의미 지시를 추가합니다. Behavior가 없을 때의 기존 네 purpose 지시와 선택 계약은 그대로입니다. 최종 reply는 기존 formatter를 통해 Arbitrator의 결론과 Suggest 후보만 표현하며 raw evidence/내부 opinion 객체를 노출하지 않습니다. 새 로그는 없습니다.

## Optional 실패와 기존 계약

- None/빈 배열: 기존 Lv4 context 사용.
- 소유권/role/privacy 불일치 또는 조회 실패: 빈 Behavior context.
- invalid 결과/adapter exception: 기존 pipeline context 사용, `/chat` 응답을 중단하지 않음.
- 계정/model 권한 거부: 기존 production fail-closed 검사 유지. optional fallback으로 권한을 우회하지 않음.
- 기존 채팅 저장, request_id idempotency, lease/retry/fencing, Memory 후보 25/threshold 0.55/Top-K 4와 metric 변경 없음.
- 외부 API와 `/chat` request/response schema 변경 없음. 내부 State 계약에 optional behaviors만 추가.

## 검증 방식과 한계

`run_behavior_lv4_adapter_tests.py`는 기존 Behavior Agent와 네 Specialist를 사용합니다. 합성 reasoner가 performed 운동 근거를 사용하면 '운동'에서 '개발'로 후보를 바꾸고 실제 TestClient `/chat` reply 및 기존 assistant 저장 인자가 달라지는지 확인합니다. 이 결과는 연결과 판단 영향의 결정론적 증거이지 실제 OpenAI 의미 품질 측정은 아닙니다.

`run_security_behavior_lv4_adapter_tests.py`는 합성 SQLite의 실제 ORM 소유권 조회, 계정 분리, inactive/role/privacy 거부, 세션 종료, 전체 테이블 지문 불변을 검사합니다. 실제 ORM -> State -> 네 Specialist -> mocked SDK -> `/chat` reply 연결도 검증합니다. 실제 PostgreSQL/Render/OpenAI/Auth 요청은 실행하지 않습니다.

기존 Phase 8.4 purpose 지문 검사에는 user payload와 SDK 호출 AST가 섞여 있었습니다. 이번에는 기존 네 purpose 대입문만 정확히 대상으로 삼고 변경 전 HEAD에서 지문을 다시 계산했습니다. 과거 지문 `8c33e0...`도 원본 HEAD에서 일치함을 확인했습니다. 새 purpose 지문은 `f5b046561edf9b1778dadb02dcd9e98fe04a1f1c2a67e533a2850689b1344ca9`입니다. 지시문을 변조하면 검사가 실패하는 테스트와 Behavior 유무별 전송 계약 테스트를 추가했으며 의미 기대값/평가 metric은 바꾸지 않았습니다.

남은 한계: 기존 Behavior v0.1의 제한된 문형과 보수적인 문자열 관련성 검사, 실제 모델의 상태 해석 비결정성. 이번 단계에서는 문형 확장, 저장된 과거 행동 조회, 실제 운영 canary, 자연어 추천 품질 평가를 하지 않습니다. 다음 단계는 별도 승인된 최소 canary/의미 평가이며 새 저장 시스템이나 자동 행동 실행이 아닙니다.

## 로컬 검증 결과

2026-10-07 현재 파일 기준입니다. 네트워크/실제 DB/모델 호출을 차단한 deterministic suite를 사용했습니다.

| 검사 | 결과 |
| --- | --- |
| 신규 Behavior Lv4 연결/소유권 | 46/46 PASS (연결 35, 소유권 11) |
| Backend baseline | 1191/1191 PASS, failure/error/skip 0 |
| Security | 427/427 PASS, failure/error/skip 0 |
| Mobile auth/account storage | 96/96 PASS |
| `npx --no-install tsc --noEmit` | PASS |
| Python syntax / FastAPI import / SQLAlchemy mapper | PASS |
| Alembic 파일 single head | 20261006_0020; 새 migration 없음 |
| `git diff --check` | PASS; 기존 LF/CRLF 안내는 오류 아님 |

Backend/Security 검사는 `python -B evals/run_security_adversarial_verification.py --backend-root C:\noie\backend --suite baseline`과 `--suite security`로 실행했습니다. 실제 PostgreSQL migration drift/DB-health 성공이나 LLM 의미 평가를 했다는 뜻은 아닙니다.

시작 시 파일 해시 440개와 비교해 아래 8개 기존 파일 변경 및 4개 신규 파일만 확인했습니다. 삭제는 없습니다. `mobile/src/styles/appStyles.ts`와 나머지 기존 파일은 해시가 동일합니다. 기존 사용자 staged/unstaged/untracked 작업은 유지했으며 이번 작업에서는 stage/commit/push/deploy하지 않았습니다.

수정한 기존 파일:

- `backend/agent/behavior_service.py`: 현재 요청 원문 일치 옵션.
- `backend/agent/lv4/state_context.py`: optional typed behaviors.
- `backend/agent/lv4/state_specialist.py`: status/confidence/시간과 내부 provenance 종합.
- `backend/agent/lv4/recommendation_context.py`: paired Behavior provenance 검증.
- `backend/agent/lv4/recommendation_specialist.py`: 관련 Behavior 최소 선택.
- `backend/agent/lv4/recommendation_adapter.py`: 승인된 최소 payload와 조건부 의미 지시.
- `backend/lv4_production_service.py`: 기존 추천 gate 내부의 optional read 연결.
- `backend/evals/run_lv4_reliability_triage.py`: 기존 네 purpose 지시만 정확히 검사.

신규 파일:

- `backend/agent/lv4/behavior_adapter.py`.
- `backend/evals/run_behavior_lv4_adapter_tests.py`.
- `backend/evals/run_security_behavior_lv4_adapter_tests.py`.
- 이 문서.

판정: **BEHAVIOR_LV4_ADAPTER_V01_PASS**. 로컬 연결/무결성/프라이버시/회귀 범위의 판정이며 운영 배포 승인이 아닙니다.
