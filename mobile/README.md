# noie 모바일 앱

Expo React Native로 만든 noie 감정 분석 채팅 UI입니다.

## 백엔드 실행

```powershell
cd C:\noie\backend
python -m uvicorn main:app --reload
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

OpenAI API 키는 모바일 앱에 넣지 않습니다. 모바일 앱은 백엔드의 `/analyze-emotion` API만 호출합니다.
