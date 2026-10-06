# Security Phase 11.4: CORS / API Surface Hardening

## Scope and baseline

Baseline HEAD: `07961b9 Secure local authentication and account data`.
Existing Security 11.0-11.3 and unrelated working-tree changes are preserved.
This phase changes only CORS startup configuration and automatic documentation
registration. It does not change authentication, ownership, business routes,
BackgroundTasks, OAuth, mobile storage, DB schema or migrations.

Previously CORS allowed every origin, method and header, with credentials disabled.
FastAPI's default docs, ReDoc and OpenAPI URLs were registered. Wildcard CORS alone
does not demonstrate authentication bypass: JWT/Principal/ownership checks still
protected business operations.

## Exact API inventory

The imported application has 45 APIRoute operations, all GET or POST. This inventory
was gathered before modification; business route paths/dependencies are unchanged.

Legend:

- **C**: `require_core_principal` -> `resolve_auth_principal`. Authentication is
  fail-closed unless the existing explicit development auth-OFF flag is used.
- **R**: `resolve_auth_principal`, plus the existing `/chat` ON/None guard.
- **B**: `require_bootstrap_identity`: verified JWT required even in auth-OFF mode.
- **D**: `require_dev_user_creation` -> C: authenticated production access returns
  404; user creation is an explicit auth-OFF development function, not public.
- **I**: probe checks its enable flag first, then explicitly calls
  `resolve_auth_principal` and `require_core_principal` inside the endpoint.
- "Owned" denotes existing ownership enforcement, not merely an input UUID.
  Body/query IDs do not establish identity.

| Method | Path | Class | Auth | In schema when docs ON | User-owned resource |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | Public | None | Yes | No |
| GET | `/db-health` | Public | None; DB dependency | Yes | No |
| POST | `/auth/bootstrap` | Protected | B | Yes | Verified identity mapping/bootstrap |
| POST | `/chat` | Protected | R | Yes | Principal-bound chat persistence |
| POST | `/generate-title` | Protected | C | Yes | Supplied text; no stored-resource lookup |
| POST | `/analyze-emotion` | Protected | C | Yes | Supplied text; no stored-resource lookup |
| POST | `/extract-daily-trace` | Protected | C | Yes | Supplied text; no stored-resource lookup |
| POST | `/orchestrate` | Protected | C | Yes | Supplied context; read-only routing |
| POST | `/agent/tool-plan` | Protected | C | Yes | Supplied plan; dry-run policy |
| POST | `/internal/background-probe` | Internal | I | **No** | No business data |
| POST | `/users` | Dev-only | D | Yes | Development-only user creation |
| POST | `/conversations` | Protected | C | Yes | Owned user |
| GET | `/users/{user_id}/conversations` | Protected | C | Yes | Owned user |
| POST | `/conversations/{conversation_id}/messages` | Protected | C | Yes | Owned conversation |
| GET | `/conversations/{conversation_id}/messages` | Protected | C | Yes | Owned conversation |
| POST | `/memories` | Protected | C | Yes | Owned user/evidence |
| GET | `/users/{user_id}/memories` | Protected | C | Yes | Owned user |
| GET | `/memories/{memory_id}` | Protected | C | Yes | Owned memory |
| POST | `/messages/{message_id}/extract-memory` | Protected | C | Yes | Owned message/conversation |
| GET | `/messages/{message_id}/memory-extraction` | Protected | C | Yes | Owned message/conversation |
| POST | `/memory-retrieval/preview` | Protected | C | Yes | Owned user |
| POST | `/agent/actions/plan` | Protected | C | Yes | Owned user/conversation/message |
| GET | `/agent/actions/{action_id}` | Protected | C | Yes | Owned action |
| POST | `/agent/actions/{action_id}/confirm` | Protected | C | Yes | Owned action/confirmation |
| POST | `/agent/actions/{action_id}/reject` | Protected | C | Yes | Owned action/confirmation |
| GET | `/users/{user_id}/agent-actions` | Protected | C | Yes | Owned user |
| POST | `/agent/actions/{action_id}/execute` | Protected | C | Yes | Owned action; execution policy retained |
| GET | `/emotion-events/{emotion_event_id}` | Protected | C | Yes | Owned event |
| GET | `/users/{user_id}/emotion-events` | Protected | C | Yes | Owned user |
| GET | `/daily-life-events/{daily_life_event_id}` | Protected | C | Yes | Owned event |
| GET | `/users/{user_id}/daily-life-events` | Protected | C | Yes | Owned user |
| GET | `/dream-goals/{dream_goal_id}` | Protected | C | Yes | Owned goal |
| GET | `/users/{user_id}/dream-goals` | Protected | C | Yes | Owned user |
| GET | `/schedules/{schedule_id}` | Protected | C | Yes | Owned schedule |
| GET | `/users/{user_id}/schedules` | Protected | C | Yes | Owned user |
| GET | `/place-events/{place_event_id}` | Protected | C | Yes | Owned event |
| GET | `/users/{user_id}/place-events` | Protected | C | Yes | Owned user |
| GET | `/body-state-events/{event_id}` | Protected | C | Yes | Owned event |
| GET | `/users/{user_id}/body-state-events` | Protected | C | Yes | Owned user |
| GET | `/cognitive-state-events/{event_id}` | Protected | C | Yes | Owned event |
| GET | `/users/{user_id}/cognitive-state-events` | Protected | C | Yes | Owned user |
| GET | `/recommendations/{event_id}` | Protected | C | Yes | Owned recommendation |
| GET | `/users/{user_id}/recommendations` | Protected | C | Yes | Owned user |
| GET | `/relationship-events/{event_id}` | Protected | C | Yes | Owned event |
| GET | `/users/{user_id}/relationship-events` | Protected | C | Yes | Owned user |

FastAPI's non-business routes `/docs` GET, `/docs/oauth2-redirect` GET, `/redoc`
GET and `/openapi.json` GET were previously available without authentication.
They are now absent by default. If explicitly enabled, they remain public
development documentation routes (GET/HEAD), not protected admin endpoints.
No other internal route was found in the application's registered routes.

## CORS configuration

`NOIE_CORS_ALLOWED_ORIGINS` is a comma-separated exact allowlist. Whitespace around
items is trimmed, empty items ignored and duplicates removed. Only HTTP/HTTPS
origins with a valid ASCII DNS/IPv4/IPv6 authority and optional valid port are
accepted. Scheme/host and default ports are canonicalized to browser origin form.
No regex, automatic localhost allowance or environment-based wildcard fallback.

Rejected: `*`, wildcard hosts, missing schemes, non-HTTP schemes, credentials,
paths (including trailing `/`), query/fragment (even empty markers), whitespace or
control characters, invalid hosts/ports/brackets and IPv6 zone identifiers.
One invalid nonempty item closes the **entire** list. The server remains importable
with `allow_origins=[]`; it does not log the raw setting or silently enable valid
fragments of a malformed configuration. Missing/empty settings also produce `[]`.

```powershell
# Example only: register the actual frontend page origin, not the backend URL.
$env:NOIE_CORS_ALLOWED_ORIGINS = "https://app.example.com,https://www.example.com"

# Local development example: use only the origins actually in use.
$env:NOIE_CORS_ALLOWED_ORIGINS = "http://localhost:19006,http://127.0.0.1:19006"
$env:NOIE_API_DOCS_ENABLED = "true"
```

Allowed business methods: `GET`, `POST`. CORS preflight `OPTIONS` is intercepted by
middleware, not a new business route. Other requested methods fail preflight.
Configured headers: `Authorization`, `Content-Type`, as used by the mobile Web
client. Starlette additionally supplies the standard CORS safelisted headers
`Accept`, `Accept-Language`, `Content-Language`, `Content-Type`; these are not a
wildcard. Arbitrary requested headers such as `X-Admin` fail preflight.
`allow_credentials=False` remains unchanged; no cookie authentication is added.

Allowed preflight returns 200 and the exact allowed origin; unknown origins return
400 without Access-Control-Allow-Origin. An actual unknown-origin HTTP request
can still reach the server but lacks that response header. JWT remains required.
Native apps are not subject to browser CORS enforcement; an empty allowlist does
not itself disable native API requests. Web needs its actual origin configured.

## Documentation and internal surface

`NOIE_API_DOCS_ENABLED` defaults OFF. Only `1`, `true`, `yes`, `on` (case-insensitive,
trimmed) enable docs. Missing/invalid settings produce 404 for `/docs`, `/redoc`,
`/openapi.json` and the Swagger OAuth redirect path. Configuration is read when
the application starts; changing it requires restart/redeployment.

Enable documentation only deliberately in development. Keep the flag unset or
false in production; setting true exposes documentation without admin auth.
OpenAPI generation as a Python function is not removed, but no HTTP schema route
is registered while disabled. Hiding docs is surface reduction, not authorization.
See [FastAPI docs URL configuration](https://fastapi.tiangolo.com/tutorial/metadata/).

`/internal/background-probe` remains default OFF -> 404. When enabled with Auth ON,
a valid mapped Principal is required. It remains `include_in_schema=False` even
with docs ON. No probe, Memory/Agent/Shadow task order or dispatch behavior changed.

## Public health, errors and headers

Public `/` retains `{status: ok, service: noie}`. Public `/db-health` retains
`SELECT 1` and the minimal success/failure contract. It is not moved behind auth
so existing operational health checks remain compatible. Failure returns only
503 with `Database connection failed.`; DB URL, SQL, host, credential and exception
message are not returned. Tests use a mock DB, not a real connectivity assertion.

Auth/identity/bootstrap errors continue to use safe 401/403/503 messages without
tokens, Authorization headers, subjects, internal IDs or provider error bodies.
Core/domain DB error handlers use fixed messages; currently surfaced typed
Memory evidence and action validation/conflict errors originate from fixed service
messages, not SQL/provider exception strings. No new response leak was found in
the examined paths. Authorized resource responses intentionally contain their
contractual IDs; this is not an error leak. Standard input validation may echo
submitted invalid inputs; this phase does not globally rewrite validation errors.
This audit and mocked regressions are not exhaustive penetration testing.

Application debug is False. Local root responses currently contain Content-Type
and Content-Length, without application-added `nosniff`, CSP or HSTS. No additional
header middleware is introduced: this minimal phase is CORS/docs only, avoiding
changes to response/background execution and reverse-proxy policy.

## CORS is not authentication

Allowed origin does not mean authenticated user. A blocked browser origin does
not imply the HTTP request disappears from the network, and non-browser clients
can supply any Origin header. The authority remains:

```text
verified JWT -> AuthIdentity -> AuthPrincipal -> ownership checks
```

Origin is never used as account identity. Browser CORS controls reading responses
and preflight permissions, not all server-side effects. Existing auth regression
checks cover the protected routes independently of CORS.
See [FastAPI CORS guidance](https://fastapi.tiangolo.com/tutorial/cors/).

## Verification (local only)

| Check | Result |
| --- | --- |
| New API surface tests | 15 PASS |
| New tests + eight specified existing security/auth suites | 122 PASS |
| Full deterministic backend discovery | 674 PASS (659 baseline + 15 new; no tests removed) |
| ATTACK-CORS-001 unknown origin | No allow-origin header; tokenless actual request remains 401 |
| ATTACK-CORS-002 wildcard configuration | Entire allowlist disabled |
| ATTACK-SURFACE-001 default docs | All three docs/schema paths 404 |
| ATTACK-SURFACE-002 disabled internal probe | 404; no DB execution |
| Python syntax / FastAPI import / SQLAlchemy mappers | PASS |
| TypeScript `npx tsc --noEmit` | PASS |
| Web export to `.expo/security11-4-web` | PASS |
| git diff --check and new-file whitespace | PASS |

Tests set dotenv disabled, DATABASE_URL and OPENAI_API_KEY empty in the test process.
Older full-suite fixtures use explicit development Auth OFF, while auth/CORS tests
isolate ON/missing/invalid settings. This is not a production configuration change.
No Render requests, live DB writes or real provider/OpenAI calls were performed.
Startup tests create independent applications without reloading/mutating the
shared test application's business route graph.

Commands from `C:\noie\backend`:

```powershell
$env:PYTHON_DOTENV_DISABLED = "1"
$env:DATABASE_URL = ""
$env:OPENAI_API_KEY = ""
python -B -m unittest evals.run_security_api_surface_tests evals.run_security_auth_fail_closed_tests evals.run_auth_principal_tests evals.run_auth_surface_tests evals.run_auth_agent_surface_tests evals.run_auth_access_tests evals.run_auth_bootstrap_tests evals.run_supabase_auth_tests evals.run_account_link_tests
$env:NOIE_AUTH_ENABLED = "false" # Only for older isolated development test fixtures.
python -B -m unittest discover -s evals -p 'run_*tests.py'
```

Do not reuse the temporary no-service test environment in a production shell.

## Files, protection and deployment

Modified only `backend/main.py` (imports and startup settings).
New: `backend/security_config.py`,
`backend/evals/run_security_api_surface_tests.py`, and this document.
No package changes, migrations, mobile edits or security/auth behavior changes.
SHA256 comparison of 349 pre-existing files against the pre-task working tree
found only the intended `backend/main.py` change. Protected styles, Lv4 and
11.2/11.3 mobile changes remain identical. Existing staged/unstaged/untracked
changes were not restored, staged or removed; the staging area is empty.
No stage, commit, push or destructive Git command.

For later Render deployment, set `NOIE_CORS_ALLOWED_ORIGINS` to the exact actual
Web frontend origin(s); no production URL is guessed or hardcoded. Keep
`NOIE_API_DOCS_ENABLED=false` and internal probe OFF outside deliberate diagnostics.
Preserve the existing production fail-closed authentication policy. No production
environment changes are performed in this phase. Recheck allowed Web preflight,
unknown origin, tokenless 401, docs 404 and health after deliberate deployment.

Remaining debt: live origin configuration/validation, request-rate and cost abuse,
broader validation/log privacy assessment and deployment-specific response header
policy. This is not a claim that all security threats are resolved.

Next phase only: **11.5 Rate Limit / Request Abuse Protection**.
Verdict: **SECURITY_11_4_READY (LOCAL PASS; not a Render LIVE validation)**.
