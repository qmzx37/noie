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

감정 흐름 그래프는 `react-native-svg`를 사용합니다. Expo 프로젝트에서는 아래 명령으로 설치할 수 있습니다.

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

## 검증

```powershell
cd C:\noie\mobile
npx tsc --noEmit
```
