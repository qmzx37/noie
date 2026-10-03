# Schedule v0.1

일정은 미래 행동과 구체적인 날짜/시각을 함께 지정한 후보입니다.
원문은 messages에 남고 schedules에는 제목과 시각, evidence FK만 저장됩니다.

## 시간대 설정

기존 사용자 모델에 timezone이 없어 v0.1은 운영자가 명시적으로 설정한
`NOIE_SCHEDULE_TIMEZONE` IANA 시간대만 상대 날짜 해석에 사용합니다.
예를 들어 한국 시간대를 사용하는 개발 환경이라면 backend/.env에
`NOIE_SCHEDULE_TIMEZONE=Asia/Seoul`을 직접 설정하고 서버를 다시 시작합니다.
기본 시간대는 없습니다. 미설정/잘못된 값은 일정 생성을 보류합니다.
이 설정은 서버 전체에 적용되며 다중 사용자 시간대 지원은 다음 단계입니다.
Windows에 IANA 데이터가 없다면 `pip install tzdata`로 제공할 수 있습니다.

채팅은 저장된 Message.created_at을 기준으로 상대 날짜를 해석합니다.
시간이 없거나 질문/부정인 문장은 create_schedule 대상이 아닙니다.
Aware datetime 입력을 요구하고 시작 이후의 종료 시각만 허용합니다.
실행 시 이미 지나간 신규 일정은 실패 처리됩니다.

## 승인 및 실행

1. `/chat` background integration은 create_schedule 계획을 pending_confirmation으로 저장합니다.
2. `GET /users/{user_id}/agent-actions`에서 action_id와 confirmation_id를 확인합니다.
3. `POST /agent/actions/{action_id}/confirm`에 user_id, confirmation_id를 보냅니다.
4. `POST /agent/actions/{action_id}/execute`에 user_id를 보내면 일정이 생성됩니다.
5. `GET /schedules/{id}?user_id=...` 또는 `GET /users/{user_id}/schedules`로 조회합니다.

채팅의 "응" 같은 문장만으로 자동 승인하지 않습니다. v0.1은 기존 confirm API를 사용합니다.
모바일 확인 UI와 로그인/인증은 이번 단계에 포함되지 않습니다.
user_id 입력은 개발용 소유권 검사이며 로그인 인증을 대체하지 않습니다.

## 저장과 재시도

모든 FK는 RESTRICT, agent_action_id는 UNIQUE입니다.
Common Executor의 lease/attempt/fencing을 유지하고 retry는 기존 row를 재사용합니다.
이는 중복 실행의 DB 영향을 억제하며 durable exactly-once 보장은 아닙니다.
BackgroundTasks는 프로세스 종료 시 유실될 수 있습니다.
update/delete/반복 일정/알림/외부 캘린더 연동은 구현하지 않습니다.

## Migration

backend에서 `python -m alembic upgrade head`를 실행합니다.
0012는 schedules 테이블만 추가하며 기존 원문/도메인 데이터는 변경하지 않습니다.
`python -m alembic downgrade 20261002_0011`은 schedules 데이터를 삭제하므로
운영 DB에서는 실행하지 않습니다.
