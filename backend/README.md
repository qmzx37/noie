# noie 백엔드

FastAPI로 만든 noie 감정 분석 API입니다.

## 주요 API

- `POST /analyze-emotion`: 사용자의 문장을 감정 분석합니다.
- `POST /generate-title`: 첫 사용자 문장으로 짧은 채팅 제목을 생성합니다.
- `POST /chat`: 일반 대화 답변, 상태 요약, 감정 분석 결과를 함께 반환합니다.

## 환경 변수

`.env` 파일에 아래 값을 넣습니다. 실제 OpenAI API 키는 직접 입력하세요.

```env
OPENAI_API_KEY=내_API_키
OPENAI_MODEL=gpt-4.1-mini
```

API 키는 코드나 모바일 앱에 넣지 않습니다.

## 패키지 설치

```powershell
cd C:\noie\backend
pip install -r requirements.txt
```

## 서버 실행

휴대폰에서 같은 네트워크로 접속하려면 `--host 0.0.0.0`으로 실행합니다.

```powershell
cd C:\noie\backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

로컬 PC에서만 테스트할 때는 아래 명령도 사용할 수 있습니다.

```powershell
python -m uvicorn main:app --reload
```

## 테스트

감정 분석:

```powershell
curl -X POST "http://127.0.0.1:8000/analyze-emotion" ^
-H "Content-Type: application/json" ^
-d "{\"text\":\"개발은 하고 싶은데 좀 부담돼\"}"
```

채팅 제목 생성:

```powershell
curl -X POST "http://127.0.0.1:8000/generate-title" ^
-H "Content-Type: application/json" ^
-d "{\"text\":\"나 오늘 친구랑 싸웠는데 기분이 이상해\"}"
```

일반 대화 답변 + 감정 분석:

```powershell
curl -X POST "http://127.0.0.1:8000/chat" ^
-H "Content-Type: application/json" ^
-d "{\"text\":\"나 오늘 친구랑 싸워서 힘들어\",\"messages\":[]}"
```
