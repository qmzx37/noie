# noie 모바일 앱

Expo React Native로 만든 noie 감정 분석 채팅 UI입니다.

## 기능

- ChatGPT 스타일 다크 채팅 UI
- 채팅 세션 목록과 현재 채팅 선택
- `AsyncStorage`를 사용한 로컬 채팅 저장
- 앱을 껐다 켜도 채팅 목록과 메시지 복원
- 첫 사용자 문장을 기반으로 백엔드 `/generate-title` API를 호출해 채팅 제목 자동 생성
- 메시지 전송 시 백엔드 `/chat` API를 호출해 일반 답변, 상태 요약, 감정 분석 카드를 함께 표시
- OpenAI API 키는 모바일 앱에 넣지 않고 백엔드에서만 사용

## 백엔드 실행

```powershell
cd C:\noie\backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 모바일 앱 실행

```powershell
cd C:\noie\mobile
npm install
npm start
```

## API 주소 변경

[App.tsx](./App.tsx)의 `API_BASE_URL` 값을 수정하면 됩니다.

기본값:

```ts
const API_BASE_URL = "http://127.0.0.1:8000";
```

실제 휴대폰 Expo Go에서 테스트할 때는 PC의 내부 IPv4 주소를 사용하세요.

```ts
const API_BASE_URL = "http://192.168.x.x:8000";
```
