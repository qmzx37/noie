# Security Phase 11.5: Rate Limit / Request Abuse Protection

## Scope and threat

Baseline HEAD: `77d1198 Harden CORS and API surface`.
Repeated authenticated requests could trigger OpenAI, chat persistence,
background Memory/Agent work or direct Tool processing without an application
budget. Invalid tokens could repeatedly trigger verifier/mapping work.
This phase adds **per-process application abuse protection**, not comprehensive
DDoS protection, a concurrency semaphore or a monetary OpenAI quota.
Large network DDoS remains a Render/CDN/WAF/infrastructure responsibility.

Auth, ownership, CORS, docs, idempotency, response content and domain behavior
remain unchanged except that over-budget requests return 429 before business work.
No DB schema, migration, dependencies, OAuth, mobile or Agent/Memory changes.

## Cost surface inventory

All 45 registered GET/POST operations were audited. The complete per-route
auth/ownership inventory remains in [Phase 11.4](SECURITY_PHASE11_4_API_SURFACE.md).

| Group | Operations | Cost and policy |
| --- | --- | --- |
| EXPENSIVE_AI | POST `/chat`, `/orchestrate`, `/agent/tool-plan`, `/generate-title`, `/analyze-emotion`, `/extract-daily-trace`, `/messages/{message_id}/extract-memory`, `/agent/actions/{action_id}/execute` (8) | OpenAI or potentially multi-step Memory/Agent processing; shared user budget prevents endpoint hopping. Tool-plan is dry-run but deliberately shares the conservative Agent budget. |
| AUTH_BOOTSTRAP | POST `/auth/bootstrap` (1) | Verified JWT required, then identity budget before bootstrap DB writes. Separate coarse peer budget protects verification. |
| PROTECTED_STANDARD | Remaining chat-storage, Memory, action plan/read/confirm/reject/list, retrieval preview and all domain read operations (33) | More generous user budget; existing ownership checks remain. `/users` remains dev-only and production-closed, not public. |
| PUBLIC_HEALTH | GET `/`, `/db-health` (2) | Generous separate peer budget; DB health still performs SELECT 1 only when admitted. |
| INTERNAL | POST `/internal/background-probe` (1) | OFF 404 takes priority. When enabled, existing auth applies before its smaller user budget. |

Docs/schema paths are not rate-limited here; Phase 11.4 default OFF remains their
surface control. Unknown paths use the coarse PRE_AUTH group but create no new
path-specific buckets. CORS preflight OPTIONS bypasses the limiter; it invokes
no business work or authentication. Malformed bodies can be rejected by FastAPI
before reaching the user-level dependency, but remain covered by the coarse guard.

## Algorithm, concurrency and memory

The standard-library limiter uses a 60-second fixed window anchored at each
bucket's creation, monotonic time and a short threading lock. Counter checks,
increments, expiration cleanup and bucket creation are atomic. No network/DB work
occurs while this lock is held. Each bucket is `(logical group, identity digest)`,
never raw token, subject, IP or UUID. Nothing is printed for individual denials.

All buckets use the same window length, so an OrderedDict's creation order also
tracks expiry order. Expired entries are removed lazily on the next consume call,
without scanning the entire map on every request. Idle entries are bounded even
when no requests arrive. The default maximum is 10,000 buckets per process.

When capacity is full, expired entries are cleaned first. A new identity is
rejected temporarily rather than evicting an active bucket and resetting its
budget. Existing identities retain their counts. Capacity pressure can cause
new legitimate identities to receive 429; this deliberate fail-closed tradeoff
is not perfect fairness under an attack.

Fixed windows can admit two windows' budgets near a boundary. They bound request
starts, not simultaneous in-flight work or the duration/cost of a single request.
Failures, malformed post-auth input and cached duplicate attempts can consume
budget. No refund is attempted; idempotency is not replaced or reset.

## Identity and auth order

For protected authenticated requests:

```text
CORS -> coarse peer guard -> JWT verification -> local identity mapping
     -> AuthPrincipal.user_id budget -> existing ownership/business/DB/background
```

The user-level identity is a purpose-separated SHA-256 digest of the verified
local UUID bytes. Client body/query/header user IDs, email, Authorization text
and Supabase subject cannot select this bucket. Token refresh maps to the same
Principal and retains the same budget. A's user budget cannot consume B's user
budget. The coarse peer budget is deliberately shared and can affect users
behind the same NAT/proxy; these are separate policies, not account identity.

JWT/mapping failures retain existing 401/403 below the coarse threshold; they
never become success or fall back to a dev user. Once the coarse budget is
exceeded, even unauthenticated requests receive 429 without verifier/business
execution. Valid-but-over-budget requests still verify JWT and mapping first;
this phase does not add a token cache or bypass current ownership authority.
An exhausted user budget can precede a later resource-ownership rejection, but
cannot grant access or perform that business action.

Bootstrap may have no local mapping yet. Its second-stage budget therefore uses
a digest of **verified** provider/subject, never raw identity data or the token.
Its existing JWT requirement is unconditional, including development auth-OFF.
The bootstrap write dependency/business function runs only after this check.

Auth OFF remains an explicit development-only choice. HTTP requests in this mode
use a peer-based business-group budget unless rate limiting is explicitly OFF.
Direct internal Python auth helper calls without a Request preserve their earlier
contract; they are not public HTTP entrypoints. FastAPI injects Request internally,
without adding a client identity field to request schemas.

## Pre-auth and proxy trust

The lightweight pure ASGI middleware uses only `scope.client[0]`, hashed with a
peer-purpose prefix. It does not inspect body, token, cookies, Forwarded or
X-Forwarded-For and does not trust client-provided IP header variations.
No additional proxy trust configuration or guessed Render behavior is introduced.

ASGI client may already be rewritten by the server's proxy-header handling.
Uvicorn/Render must have a correctly configured trusted-proxy boundary; blindly
trusting all forwarded sources in server configuration can still undermine a
peer-based guard. Conversely, a single unrewritten proxy peer shares a budget
among users. Repository README commands do not specify forwarded-allow-ips or
an authoritative live proxy topology. This remains a deployment validation task,
not a claimed live client-IP verification. Missing peer shares an unknown-peer
bucket instead of becoming unlimited.

The middleware is inside existing CORSMiddleware, so CORS policy also applies to
coarse 429 responses. It directly awaits the downstream ASGI application on
admitted requests, without BaseHTTPMiddleware, thread creation, queues or task
dispatch changes. Disabled internal probe and docs policy remain prior exceptions.

## Defaults and environment settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `NOIE_RATE_LIMIT_ENABLED` | ON | Only trimmed, case-insensitive `false`, `0`, `no`, `off` disable for development. Missing/empty/invalid remains ON. |
| `NOIE_RATE_LIMIT_EXPENSIVE_PER_MINUTE` | 30 | Shared costly-user budget |
| `NOIE_RATE_LIMIT_STANDARD_PER_MINUTE` | 120 | Standard user CRUD budget |
| `NOIE_RATE_LIMIT_BOOTSTRAP_PER_MINUTE` | 10 | Verified bootstrap identity budget |
| `NOIE_RATE_LIMIT_PRE_AUTH_PER_MINUTE` | 300 | Shared protected/unknown request budget per ASGI peer |
| `NOIE_RATE_LIMIT_PRE_AUTH_BOOTSTRAP_PER_MINUTE` | 30 | Bootstrap verification peer budget |
| `NOIE_RATE_LIMIT_HEALTH_PER_MINUTE` | 600 | Shared root/DB-health peer budget |
| `NOIE_RATE_LIMIT_INTERNAL_PER_MINUTE` | 10 | Enabled internal probe user budget |
| `NOIE_RATE_LIMIT_MAX_BUCKETS` | 10000 | Startup memory bound; maximum 50000 |

Counts accept integers 1 through 10000. Capacity accepts 1 through 50000.
Zero, negative, malformed, fractional, overly long or excessive values revert
to the documented default, never unlimited. Flag/limit values are read during
requests; capacity is fixed at module startup. Production changes still require
an intentional deployment configuration workflow; no production variables were
changed here. Keep existing Auth ON and docs/probe OFF production policies.

## 429 contract

```json
{"detail":"요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."}
```

`Retry-After` is an integer number of seconds, rounded up to the window's remaining
time, minimum 1. On capacity saturation it is time until the earliest bucket
expires. No raw bucket key, user ID, IP, token or internal counter is returned.
Clients should wait; mobile retry/UI behavior is not changed in this phase.

## Verification (LOCAL PASS only)

- New rate-limit tests: 24 PASS, including missing/invalid flags through real
  TestClient HTTP, explicit development OFF and safe numeric defaults.
- ATTACK-RATE-001: third chat request at limit 2 returned 429; all business,
  persistence, OpenAI, retrieval, background Memory and Agent mocks remained uncalled.
- ATTACK-RATE-002: A exhausted; B remained admitted below the separate coarse limit.
- ATTACK-RATE-003: changing A's access token did not reset its user bucket.
- ATTACK-RATE-004: changing body/query/header user ID did not select a new bucket.
- ATTACK-RATE-005: 24 concurrent chat requests at limit 5 admitted exactly 5;
  19 returned 429, with exactly 5 persistence/OpenAI calls. An independent 100-attempt
  thread-pool test at limit 10 admitted exactly 10.
- Endpoint hopping, expiration, capacity saturation, stale cleanup, log/key privacy,
  auth error precedence, pre-auth verifier suppression, forwarded-header spoofing,
  health, bootstrap and probe policies covered.
- CORS on 429, preflight after saturation and default docs OFF covered.
- Existing auth signature assertion initially failed because Request injection
  added a server-owned parameter. It now explicitly checks Request annotation,
  default None and absence of client identity fields; no tests removed or skipped.
- Full deterministic suite: 698 PASS (674 baseline + 24 new).
- Targeted new/security/auth suite: 146 PASS.
- Python syntax/FastAPI import/startup/SQLAlchemy mapper: PASS.
- `git diff --check` and new-file whitespace: PASS.

Tests use synthetic identities, deterministic clocks, mocks and TestClient;
no actual OpenAI, Supabase, Render load test or production DB writes. Older
deterministic fixtures explicitly turn the limiter OFF to avoid sharing historical
request budgets across unrelated tests; new limiter tests independently turn it
ON or remove/mistype the flag to validate secure defaults. This test-process
setting is not a deployment recommendation. No real rate/cost telemetry calibration
or native mobile runtime assertion is claimed.

Commands from `C:\noie\backend`:

```powershell
$env:PYTHON_DOTENV_DISABLED = "1"
$env:DATABASE_URL = ""
$env:OPENAI_API_KEY = ""
$env:NOIE_RATE_LIMIT_ENABLED = "false" # Compatibility for unrelated old fixtures only.
python -B -m unittest evals.run_security_rate_limit_tests evals.run_security_auth_fail_closed_tests evals.run_security_api_surface_tests evals.run_auth_principal_tests evals.run_auth_surface_tests evals.run_auth_agent_surface_tests evals.run_auth_access_tests evals.run_auth_bootstrap_tests evals.run_supabase_auth_tests evals.run_account_link_tests
$env:NOIE_AUTH_ENABLED = "false" # Compatibility for unrelated old fixtures only.
python -B -m unittest discover -s evals -p 'run_*tests.py'
```

## Files and working-tree protection

Modified: `backend/main.py`, `backend/auth_context.py`,
`backend/auth_bootstrap_router.py`, `backend/security_config.py`,
and the single signature contract test in `backend/evals/run_auth_principal_tests.py`.
New: `backend/security_rate_limit.py`,
`backend/evals/run_security_rate_limit_tests.py`, and this document.
No mobile, migrations, domain logic, dependency or verifier algorithm changes.
Pre/post SHA256 comparison of 352 existing files found changes only in the five
listed modified files. Protected styles/Lv4 and pre-existing unrelated changes
are identical to their pre-task working-tree contents. The staging area remains
empty. No stage, commit, push or destructive Git operation.

## Limitations and next phase

Each worker/instance has its own map. Restarts reset budgets; multiple workers or
Render instances multiply admission limits. This is **not** a distributed global
limit. The small consume interface can later move to Redis/gateway/edge admission
without changing JWT/ownership authority, but no new infrastructure is introduced.
Coarse peer fairness/proxy trust, real usage calibration, fixed-window boundary
bursts, max-bucket pressure, in-flight concurrency and overall provider spending
caps remain operational/security debt.

Audit found unbounded text/content/history or evidence-list inputs in some schemas
(e.g. ChatRequest history and chat-storage message content). Rate admission does
not cap bytes, parsing cost or tokens per admitted request. Request-body size,
field/list limits and infrastructure caps need a separate focused policy; they are
not silently changed here. Direct provider login brute force occurs at Supabase,
not this backend; this limiter protects bootstrap and NOIE APIs, not Supabase's
own login endpoints. No comprehensive DDoS/security certification is claimed.

Next phase only: **11.6 Memory Privacy / Sensitive Data Policy**.
Verdict: **SECURITY_11_5_READY (LOCAL PASS, not a live load-test result)**.
