# noie 모바일 앱

Expo React Native로 만든 noie 감정 분석 채팅 앱입니다.

## 기능

- ChatGPT 스타일의 다크 채팅 UI
- `AsyncStorage`를 사용한 로컬 채팅 저장
- 채팅 제목 자동 생성
- 백엔드 `/chat` API를 통한 일반 답변, 상태 요약, 감정 분석 카드 표시
- 개발자 정보 접기/펼치기
- 별도 `감정 창고` 화면
- 최근 10개 분석 결과 기준 감정 꺾은선 그래프
- 최근 7일 감정 평균 막대그래프
- `하루의 흔적` 달력
- 날짜별 일정, 오늘의 기록, 할 일, 남긴 말 저장
- 장기 목표 저장
- ChatGPT 스타일의 로컬 프로젝트 작업 공간

## 백엔드 실행

```powershell
cd C:\noie\backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 모바일 실행

```powershell
cd C:\noie\mobile
npm install
npm start
```

감정 그래프는 `react-native-svg`를 사용합니다.

```powershell
cd C:\noie\mobile
npx expo install react-native-svg
```

## API 주소 변경

[App.tsx](./App.tsx)의 `API_BASE_URL` 값을 수정하면 됩니다.

기본값:

```ts
const API_BASE_URL = "http://127.0.0.1:8000";
```

실제 휴대폰의 Expo Go에서 테스트할 때는 `127.0.0.1` 대신 PC의 내부 IPv4 주소를 사용하세요.

```ts
const API_BASE_URL = "http://192.168.x.x:8000";
```

## 감정 창고 화면

왼쪽 사이드바 또는 모바일 드로어에서 `감정 창고` 버튼을 누르면 이동합니다.

- 최근 10개 감정 분석 기록으로 꺾은선 그래프를 표시합니다.
- 기본 표시 축은 `D 우울`, `T 긴장`, `R 안정`입니다.
- 사용자가 보고 싶은 감정축을 최대 4개까지 선택할 수 있습니다.
- 최근 7일 감정 평균은 높은 순서대로 보여줍니다.
- 그래프 계산은 저장된 로컬 데이터만 사용하며 OpenAI API를 새로 호출하지 않습니다.

## 하루의 흔적

`감정 창고` 화면 안에 달력 형태로 표시됩니다.

- 저장 key: `noie_daily_traces_v1`
- 일정: 약속, 병원, 제출일처럼 날짜가 있는 항목
- 오늘의 기록: 오늘 한 일이나 남기고 싶은 기록
- 할 일: 해야 할 일, 만들 일, 정리할 일
- 남긴 말: 사용자가 저장해달라고 한 문장
- 장기 목표: 개발자가 되기, 취업하기, 앱 완성하기처럼 미래에 이루고 싶은 목표

채팅에서 후보가 발견되어도 자동 저장하지 않습니다. 사용자가 확인 카드의 추가 버튼을 눌렀을 때만 저장됩니다.

## 프로젝트

사이드바의 채팅 목록 아래 `프로젝트` 영역에서 만들 수 있습니다.

- 저장 key: `noie_projects_v1`
- 메시지 저장 key: `noie_project_messages_v1`
- 프로젝트 이름, 목표, 마감일을 저장합니다.
- 마감일이 있으면 `D-3`, `D-Day`, `D+1`처럼 표시합니다.
- 프로젝트 안에서도 noie와 대화할 수 있습니다.
- 프로젝트 대화에서는 일반 답변만 보여주고 감정 카드는 숨깁니다.
- 감정 분석 숫자, 상태 요약, source는 내부 데이터로만 저장합니다.

## 검증

```powershell
cd C:\noie\mobile
npx tsc --noEmit
```
