# 노이에 백엔드

FastAPI로 만든 감정 분석 API입니다.

## 필요한 파일

프로젝트에는 아래 파일이 필요합니다.

- `main.py`
- `openai_analyzer.py`
- `schemas.py`
- `emotion_analyzer.py`
- `.env`
- `.env.example`
- `.gitignore`
- `requirements.txt`

## 환경 변수 설정

`.env` 파일에 아래 값을 넣습니다.
실제 OpenAI API 키는 직접 입력해 주세요.
API 키는 코드 안에 넣지 않습니다.

```env
OPENAI_API_KEY=내_API_키
OPENAI_MODEL=gpt-4.1-mini
```

## 패키지 설치

```bash
pip install -r requirements.txt
```

## 서버 실행

`backend` 폴더에서 아래 명령어를 실행합니다.

```bash
python -m uvicorn main:app --reload
```

서버가 정상 실행되면 기본 주소는 아래와 같습니다.

```text
http://127.0.0.1:8000
```

## 테스트용 curl

Windows PowerShell 또는 명령 프롬프트에서 아래 명령어로 테스트할 수 있습니다.

```bat
curl -X POST "http://127.0.0.1:8000/analyze-emotion" ^
-H "Content-Type: application/json" ^
-d "{\"text\":\"개발은 하고 싶은데 좀 부담돼\"}"
```
