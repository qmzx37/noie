# NOIE Security Phase 11.1 - Production Fail-Closed Authentication v0.1

Date: 2026-10-06. Baseline HEAD: 0870b74e525c6d855af3f3a673a2dd5a59a7b465.
Verdict: SECURITY_11_1_READY (local deterministic validation, not a live deployment approval).

## Previous Risk

auth_context.auth_enabled previously recognized only explicit ON values.
Missing, empty and malformed NOIE_AUTH_ENABLED therefore returned False,
allowing protected requests to enter legacy development ownership paths.
This is the conditional production fail-open risk recorded by Security 11.0.
The original Security 11.0 artifacts remain unchanged as historical evidence.

## New Behavior Matrix

| Configuration | Auth | Unauthenticated protected request |
| --- | --- | --- |
| true / 1 / yes / on | ON | 401 |
| Missing | ON | 401 |
| Empty or whitespace-only | ON | 401 |
| fasle / true! / enabled / disable / banana / false! / tru | ON | 401 |
| false / 0 / no / off | Explicit development OFF | Existing dev behavior |

Comparison trims surrounding whitespace and ignores case. Only the four exact
normalized OFF values disable authentication. No hosting-specific environment
flag, request input or client-supplied identity influences this decision.
No configuration values are logged.

All existing consumers of auth_enabled use this shared decision. No route,
JWT verifier, identity mapping, ownership service, Memory, Agent, Lv4 or
mobile behavior was separately rewritten.

## Protected and Public Boundaries

The new tests traverse the actual FastAPI dependency graph and exercise all
41 current protected routes without tokens under missing/empty/invalid/ON
settings, including chat, orchestrate, tool-plan, title, emotion, daily trace,
Core storage/Memory and Agent/domain APIs. They require 401 and check that
mocked business functions, token verification/mapping and DB queries are not
invoked.

Authenticated success under default/invalid/ON settings is checked using
mocked verified identity and Principal mapping. Existing Principal, cross-user
404, confirm/reject/execute and chat ownership tests remain in the regression
suite. This does not make client-supplied UUIDs authentication.

GET / and GET /db-health remain public. Health tests use a mock session and
assert SELECT 1 is executed; they do not prove an actual PostgreSQL connection.
POST /auth/bootstrap still requires a verified JWT regardless of the flag.
The internal background probe stays 404 when disabled; when enabled it uses
the new shared auth policy. No production probe requests were made.

## Attack Scenarios

- ATTACK-CONFIG-001: setting NOIE_AUTH_ENABLED=fasle does not disable auth;
  all 41 protected routes return 401 without a token. PASS.
- ATTACK-CONFIG-002: deleting NOIE_AUTH_ENABLED does not disable auth;
  all 41 protected routes return 401 without a token. PASS.

## Changed Files

- backend/auth_context.py: change only auth_enabled semantics and Korean comments.
- backend/evals/run_auth_principal_tests.py: limit the dev-OFF expectations to
  explicit OFF values, including case/whitespace variants.
- backend/evals/run_security_auth_fail_closed_tests.py: new deterministic
  config attack, protected-surface, public/bootstrap and probe tests.
- docs/SECURITY_PHASE11_1_FAIL_CLOSED.md: this report.

No migration, dependency, model, mobile, provider or production environment
changes. No staging, commit or push.

## Validation

All Python commands run with PYTHON_DOTENV_DISABLED=1, DATABASE_URL and
OPENAI_API_KEY empty, and Python -B. No actual Render database write, external
Auth request or OpenAI call was performed.

| Check | Result |
| --- | --- |
| New fail-closed unittest module, without forcing an auth flag | 8 tests PASS |
| New module plus requested Principal/surface/Agent/access/bootstrap/verifier/account-link regression | 107 tests PASS |
| Full deterministic backend discovery | 659 tests PASS |
| Python AST syntax | 211 files PASS |
| FastAPI import | PASS |
| SQLAlchemy configure_mappers | PASS |
| git diff --check | PASS; line-ending warnings only |
| Existing-file SHA-256 comparison | PASS except the two explicitly edited backend files |

Commands from C:\noie\backend:

```powershell
$env:PYTHON_DOTENV_DISABLED = "1"
$env:DATABASE_URL = ""
$env:OPENAI_API_KEY = ""
python -B -m unittest evals.run_security_auth_fail_closed_tests

# Older non-auth fixtures explicitly request legacy development mode.
# The new tests remove/override this value and test the actual secure default.
$env:NOIE_AUTH_ENABLED = "false"
python -B -m unittest evals.run_security_auth_fail_closed_tests evals.run_auth_principal_tests evals.run_auth_surface_tests evals.run_auth_agent_surface_tests evals.run_auth_access_tests evals.run_auth_bootstrap_tests evals.run_supabase_auth_tests evals.run_account_link_tests
python -B -m unittest discover -s evals -p 'run_*tests.py'
```

The full suite's explicit OFF setting is a test-process compatibility choice,
not a new application default or a recommendation for production. Tests that
require auth already set ON; new tests isolate and restore environment values.
Do not copy these temporary no-service test variables into a deployment shell.

## Working Tree Safety

Before/after SHA-256 comparison covers every tracked and nonignored untracked
file present at the start. Only the two named existing backend files are
changed; two new Phase 11.1 files are added. appStyles.ts, LV4_SPEC, all
existing Lv4 files and Security 11.0 documents retain their original hashes.
Existing staged state remains unchanged. No destructive Git commands.

## Explicit OFF and Remaining Security Debt

Production configured explicitly with false, 0, no or off can still disable
authentication. This compatibility exception is deliberate, not eliminated by
Phase 11.1. Deployment configuration validation and a future production-mode
policy must prevent explicit OFF from being accidentally deployed.

Secure default ON can reveal missing Supabase settings or unmapped identities
that were previously masked by dev mode. Keep the existing safe 401/403 behavior;
do not fall back to dev-user to resolve such deployment problems.

This change does not resolve plaintext token storage, per-account local data
isolation, rate limits, exception logging or dependencies from the baseline.
Live configuration and provider behavior are not re-certified here.

## Single Recommended Next Phase

Security Phase 11.2 - Secure token storage. Review native platform secure
storage and web session/XSS threat models separately while preserving refresh,
logout and session race defenses. Production explicit-OFF validation remains
a recorded operational prerequisite, not an unrequested implementation here.
