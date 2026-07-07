# Noie

## Damoye / Emotion Wave AI Backend

FastAPI backend MVP for emotion analysis chat.

The frontend should not call OpenAI directly. OpenAI is called only from the backend. If the API key is missing, the OpenAI request fails, or JSON parsing fails, the server uses the rule-based fallback analyzer.

### Windows Environment Variable

```bat
setx OPENAI_API_KEY "여기에_내_API_KEY"
```

After running `setx`, open a new terminal so Windows can load the new environment variable.

### Run Backend

```bash
cd C:\noie\backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Test Curl

```bash
curl -X POST "http://127.0.0.1:8000/analyze-emotion" ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"나 개발은 하고 싶은데 너무 부담되고 지쳐\"}"
```
