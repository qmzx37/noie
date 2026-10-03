# Cognitive State v0.1

현재 사용자의 발화에서 직접 지지되는 인지 상태만 구조화합니다.
Message 원문이 source of truth이며 이 테이블은 해석 결과입니다.
원문은 복사하지 않고 user/conversation/message/action UUID로 추적합니다.

## 다섯 독립 축

| 코드 | 필드 | 높은 값의 의미 |
| --- | --- | --- |
| FOC | focus | 지금 집중하고 있음 |
| LOD | mental_load | 생각이 복잡하거나 정신적 부담이 큼 |
| MOT | motivation | 행동하고 싶은 의욕이 큼 |
| UNC | uncertainty | 자신의 판단/선택에 확신이 부족함 |
| CLR | clarity | 생각이나 해야 할 일이 명료함 |

각 축은 nullable 0..1입니다. NULL은 unknown이며 0은 근거 있는 매우 낮음입니다.
최소 한 축은 알려져 있어야 합니다. confidence도 유한한 0..1입니다.
축 간 역관계나 인과관계 제약은 없습니다.
MOT 높음/FOC 낮음, CLR 높음/UNC 높음, LOD 높음/FOC 높음도 가능합니다.
Body energy와 Cognitive motivation은 서로 대체할 수 없습니다.
순수 불안은 Emotion이며 판단 불확실성을 자동 생성하지 않습니다.
타인/과거/미래 상태나 Memory만으로 현재 Cognitive를 채우지 않습니다.

## 저장과 실행

- record_cognitive_state: record, confirmation=false, implemented=true.
- routing/arguments confidence 중 낮은 값이 기존 Record 기준 .40 이상이어야 합니다.
- 기존 공통 Executor의 lease/retry/attempt fencing을 그대로 사용합니다.
- agent_action_id UNIQUE와 conflict 시 기존 row 재사용으로 중복을 막습니다.
- DB 쓰기 동안만 짧은 action lock을 사용하며 OpenAI를 transaction 안에서 호출하지 않습니다.
- FK 네 개는 RESTRICT입니다. metadata는 JSONB이며 Python default=dict입니다.
- updated_at은 기존 ORM onupdate 정책이며 trigger는 추가하지 않습니다.
- /chat의 자동 Record allowlist에 추가하되 실패는 다른 도메인/채팅과 분리합니다.

## 읽기 API

- GET /cognitive-state-events/{id}?user_id=UUID
- GET /users/{user_id}/cognitive-state-events?limit=50

활성 소유자만 조회하며 다른 사용자/없는 기록은 404입니다.
목록은 created_at DESC, id DESC; 기본 50, 최대 100입니다.
user_id는 현재 개발용 소유권 필터이며 로그인 인증을 대체하지 않습니다.

## Migration과 검증

backend에서 실행:

```powershell
python -B -m alembic upgrade head
python -B -m alembic current
python -B -m alembic check
python -u -B evals/run_cognitive_state_tests.py
python -u -B evals/run_cognitive_state_tests.py --routing-only
python -u -B evals/run_cognitive_state_tests.py --live-chat-only
```

0015는 0014 다음에 새 테이블 하나만 추가합니다.
downgrade는 Cognitive 데이터를 삭제하므로 실제 DB에서는 실행하지 않습니다.
DB 테스트는 별도 __cognitive_state_v1__ 사용자로 데이터를 생성하고 삭제하지 않습니다.
검증 스크립트는 순차 실행해야 기존 도메인 지문 비교에 다른 테스트가 섞이지 않습니다.
실제 OpenAI 테스트도 비용이 발생합니다. Chat E2E는 별도 Memory 추출만 제외합니다.

## 한계

발화 기반 추정이지 실제 뇌/인지 측정, 정신건강 진단, IQ/능력 평가가 아닙니다.
LLM 오분류 가능성이 있으며 다섯 축은 NOIE v0.1 engineering hypothesis입니다.
실제 데이터에 따라 축 병합/삭제/추가가 가능하며 장기 프로필/자동 학습은 구현하지 않습니다.
Recommendation/Human Simulator 연결도 이번 범위 밖입니다.
기존 Chat background 처리의 durable queue와 일반 action의 재실행 보장은 별도 과제입니다.
한 발화의 인지 축은 하나의 action에 모으도록 프롬프트와 출력 검증을 적용합니다.
호환되는 반복/분할 Cognitive 출력은 알려진 축만 모으고 가장 낮은 신뢰도를 유지합니다.
다른 도메인 필드는 보존하고 실행 순서만 연속 정리합니다.
동일 축에 서로 다른 점수가 있으면 평균/선택하지 않고 출력 validation 오류로 거부합니다.
이 경우 기존 채팅 응답은 유지되지만 해당 routing 배치의 자동 저장은 보류될 수 있습니다.
OpenAI가 모든 축이 NULL이거나 arguments가 명시적 null인 Body/Cognitive placeholder를 만들면 출력 어댑터에서 제외합니다.
이 후보는 근거가 없으므로 기록하지 않으며 정상 도메인의 출력은 보존합니다.
알려진 0은 제외하지 않습니다. 직접 Gateway/Pydantic/DB의 all-null 거부는 그대로 유지합니다.
DB UNIQUE는 action 단위이며 독립 요청의 message 단위 재해석 정책까지 강제하지 않습니다.
