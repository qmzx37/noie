# NOIE Security Baseline v1

Date: 2026-10-06. Repository qmzx37/noie, main, HEAD 99132deb2a802491b06a4deec2521be549ecae20.
Verdict: **SECURITY_BASELINE_READY** means the documented audit baseline and local regression are complete. It does **not** certify production as secure, resolve findings or approve an authentication-disabled rollout.

## Scope and Method

Documentation-only review of the current working tree, not only HEAD. Read selected authentication, ownership, bootstrap, chat, Memory, Agent/domain, database/model and mobile authentication/storage code; searched related usages across the repository. Syntax inspection covered 210 backend Python files. Source review was targeted, not a line-by-line examination of every file or a live penetration test.

Only three new Security artifacts are created. No production code, dependency, schema, provider setting or existing file was changed. No stage/commit/push or destructive Git command was used.

- Read-only git status/index checks and baseline SHA-256 inventory of 336 tracked/nonignored untracked files.
- Existing deterministic tests run with dotenv disabled, DATABASE_URL/OPENAI_API_KEY empty, and Python -B.
- npm audit queried the advisory service using package inventory, not private project data. No audit fix or dependency installation.
- Public primary security documentation/advisories were reviewed. No live Render, Supabase Auth, database, OpenAI or attacker traffic.
- .env, backend/.env and mobile/.env are absent from the current tracked index; their contents were not read. This is not a complete historical secret/entropy scan.

## Reviewed File Areas

| Area | Source reviewed |
| --- | --- |
| Auth principal and JWT | backend/auth_context.py, supabase_auth_verifier.py, auth_identity_service.py, auth_ownership.py |
| Bootstrap / account link | backend/auth_bootstrap_router.py, auth_bootstrap_service.py, models/auth_identity.py; existing account-link tests |
| Chat and API | backend/main.py, schemas.py, chat_storage_router.py, chat_storage_schemas.py, chat_storage_service.py, chat_persistence_service.py, chat_agent_integration_service.py, chat_background_observability.py |
| Memory / data | backend/memory_router.py, memory_service.py, extraction/reconciliation/retrieval ownership usages, database.py, models/** |
| Agent/domain | backend/agent router/principal usages, action_service.py, executor_service.py, tool_policy.py, tool_registry.py and recommendation-context scope |
| Mobile auth | mobile/src/auth/**, src/constants/authConfig.ts, src/features/auth/** |
| Mobile local data | mobile/src/noie/storage.ts, src/constants/storageKeys.ts, mobile/App.tsx |
| Dependencies/configuration | backend/requirements.txt; mobile/package.json/package-lock.json; checked-in configuration search |

## Finding Summary

- **P0:** SEC-001, conditional production fail-open if auth flag is missing/invalid/OFF. Code behavior is proven; actual production settings are unknown.
- **P1:** SEC-002/003/004/005/006/007/010: unencrypted tokens, cross-account local data, local-only logout/replay policy, missing quotas/payload bounds, unsafe exception paths and affected development/build dependencies.
- **P2:** SEC-008/011/012/013/014: CORS breadth, Python dependency assurance, retention, AI semantic integrity and unverified operational controls.
- **P3:** SEC-009: default documentation/public operational-surface policy.

| ID | Severity | Evidence | Confidence / scope |
| --- | --- | --- | --- |
| SEC-001 | P0 | backend/auth_context.py: auth_enabled, resolve_auth_principal; backend/auth_ownership.py | Confirmed code behavior; production exposure unverified |
| SEC-002 | P1 | mobile/src/auth/authSession.ts; mobile/src/constants/storageKeys.ts | Confirmed storage design; no theft performed |
| SEC-003 | P1 | mobile/src/constants/storageKeys.ts; mobile/App.tsx startup reads; mobile/src/features/auth/AuthGate.tsx | Confirmed design gap; no live personal-data experiment |
| SEC-004 | P1 | mobile/src/auth/authSession.ts; AuthGate.tsx; backend/supabase_auth_verifier.py | Confirmed missing application policy; live token lifetime unknown |
| SEC-005 | P1 | backend/main.py; backend/auth_bootstrap_router.py; backend/agent/executor_service.py | Code gap confirmed; Render edge limits unknown |
| SEC-006 | P1 | backend/schemas.py: ChatRequest and analysis requests; chat_storage_service.py; memory_service.py | Confirmed application gap |
| SEC-007 | P1 | backend/openai_analyzer.py: print_openai_error; backend/main.py project-combined catch; chat_agent_integration_service.py catch; mobile/src/noie/storage.ts; mobile/App.tsx | Logging paths confirmed; actual secret/PII leak not observed |
| SEC-008 | P2 | backend/main.py: CORSMiddleware | Confirmed configuration |
| SEC-009 | P3 | backend/main.py: FastAPI constructor, root, db-health, internal probe | Confirmed local app configuration; live routes not queried |
| SEC-010 | P1 | mobile/package.json; mobile/package-lock.json; npm audit and npm explain | Advisory/package presence confirmed; exploitability not tested |
| SEC-011 | P2 | backend/requirements.txt; local installed distribution metadata; primary Starlette advisories | Partial advisory review only; Render versions unknown |
| SEC-012 | P2 | backend/models; memory_service.py; database.py | Schema policy confirmed; operations unverified |
| SEC-013 | P2 | backend/agent/tool_policy.py; tool_registry.py; action_service.py; executor_service.py; memory services; recommendation context | Residual model risk; no unauthorized execution observed |
| SEC-014 | P2 | database.py; backend/mobile configuration; current git index checks | Assurance gap, not a confirmed production vulnerability |

The complete asset/threat/path/control/gap/likelihood/impact/remediation register is in SECURITY_THREAT_MODEL_V1.md and the machine-readable JSON. These are findings, not implemented fixes.

## Authentication and Ownership

auth_enabled() accepts only 1/true/yes/on, ignoring case/whitespace. Missing or malformed NOIE_AUTH_ENABLED becomes False. That is compatible with deliberate development but unsafe as a production default. resolve_auth_principal then returns None, allowing legacy dev ownership paths. Do not describe strict JWT verification as protecting that OFF branch.

When ON, the verified Supabase identity maps to an active local User, AuthPrincipal is immutable, and supplied UUIDs are checked for consistency. Core resources, Agent actions and confirm/reject/execute queries are owner-filtered; cross-user resources return 404. Chat duplicate ownership is checked. General unmapped identities are rejected; only /auth/bootstrap intentionally creates a local User/mapping, atomically and with uniqueness/race handling.

Verifier uses SDK get_claims and validates issuer, audience, expiry/nbf, authenticated role, non-anonymous claim and canonical UUID subject. It does not trust email/user_metadata. Live JWKS/provider settings and session revocation were not tested.

## Token and Local Device Assessment

authSession.ts persists accessToken, refreshToken and expiresAt in AsyncStorage under a global auth-session key. This is not encrypted platform storage. On web, same-origin script compromise may read persisted tokens; on native, a compromised/shared device or storage extraction is the relevant precondition. No token was extracted in this audit.

Logout clears local credentials but does not invoke provider logout/revocation. JWT checks do not include server session liveness. A previously stolen token may remain usable according to provider/JWT lifetime. [Supabase session guidance](https://supabase.com/docs/guides/auth/sessions)

NOIE chat/project/daily storage keys also remain global. AuthGate logout deliberately keeps that local data, and App startup reloads it after another login. Therefore the local cross-account boundary is not complete, even though backend owner isolation is strong.

PKCE/provider allowlist/callback checks, refresh coalescing, one 401 retry, revision/generation protection and safe auth-error suppression are supported by passing tests. No unsupported claim of OAuth state exploitation is made.

## API, Logs and Privacy

main.py sets allow_origins=["*"], allow_credentials=False and wildcard methods/headers. This does not itself bypass Bearer authentication and cookie-based CSRF was not demonstrated. It is an overbroad browser boundary, especially when combined with dev mode. [FastAPI CORS documentation](https://fastapi.tiangolo.com/tutorial/cors/)

No application-level rate limiter was found for /chat, bootstrap, execution or analysis. Render/edge quotas are unknown. Idempotency only deduplicates the same request ID, not repeated requests with new IDs.

Chat text/history/project arrays and several analysis/storage text fields lack upper budgets. User name/title and some domain list limits exist. Core conversation/message/Memory listings lack pagination. No body-size exhaustion experiment was conducted.

FastAPI defaults expose /docs, /redoc and /openapi.json in the local app configuration. This reveals contracts, not private records by itself. Root and db-health are public; health uses a minimal DB query and safe error labels. The internal diagnostic probe remains environment-gated, hidden from schema and principal-protected when auth is ON.

openai_analyzer.print_openai_error prints str(error), main.py's project-combined catch prints the raw exception, and local storage parse failures log the raw error object. Depending on provider/parser exception contents, these can echo private input or credentials. chat_agent_integration_service also prints raw message_id on an error path. These are unsafe logging paths, not evidence that real secrets were observed.

Originals and evidence use protective RESTRICT relationships, with soft deletion on selected parents. Hiding a row does not delete backups, original evidence or third-party data. No complete account-purge/retention lifecycle was found; none was added.

## Dependency Audit

### npm

Command: npm audit --json --ignore-scripts, run in mobile. Exit 1 represents advisory findings, not a command/network failure in the completed run.

Affected package entries: 94 total; Critical 2, High 55, Moderate 36, Low 1, Info 0. These are not 94 unique CVEs and not 94 proven runtime exploits. The JSON artifact includes every reported High/Critical entry and its advisory references.

Exact representative dependency paths confirmed with npm explain:
- @expo/webpack-config@18.1.4 -> webpack-dev-server@4.15.2 -> express@4.22.2 -> proxy-addr@2.0.7.
- expo@48.0.21 -> @expo/cli@0.7.3 -> tar@6.2.1.
- expo@48.0.21 -> @expo/cli@0.7.3 -> node-forge@1.4.0.
- @expo/webpack-config@18.1.4 -> webpack-dev-server@4.15.2 -> selfsigned@2.4.1 -> node-forge@1.4.0.
- expo@48.0.21 -> @expo/cli@0.7.3 -> send@0.18.0.
- @expo/webpack-config@18.1.4 -> webpack-dev-server@4.15.2 -> express@4.22.2 -> send@0.19.2.

Critical proxy-addr concerns IP interpretation under affected trust-proxy/subnet configurations. That development-server middleware path does not prove Render FastAPI or a static Expo export is exploitable. [Primary advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)

Critical tar advisories concern malicious archive processing in affected tool versions. Evaluate the build/CLI inputs and permissions separately from browser runtime. [Primary tar advisory](https://github.com/advisories/GHSA-34x7-hfp2-rc4v)

Recommendation: compatible Expo/build upgrades with regression, verify whether legacy webpack tooling is actually required, and harden build inputs/permissions. No npm audit fix, --force, lockfile rewrite or install was performed.

### Python

requirements.txt pins supabase==2.32.0; SQLAlchemy/psycopg/Alembic have major-version bounds; FastAPI, uvicorn, OpenAI, dotenv and Pydantic are not exact-pinned. No tested Python lockfile was found.

Local installed versions: FastAPI 0.128.4, Starlette 0.52.1, uvicorn 0.40.0, OpenAI 2.44.0, Pydantic 2.12.5, SQLAlchemy 2.1.1, psycopg 3.3.6, Supabase 2.32.0. They are not proof of Render's installed versions.

pip-audit is not installed. No comprehensive Python CVE scan was run. A limited primary-advisory check found Starlette 0.52.1 in these affected ranges:
- GHSA-86qp-5c8j-p5mr: Host poisoning of request.url.path, patched in 1.0.1. [Primary advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-86qp-5c8j-p5mr)
- GHSA-jp82-jpqv-5vv3: malformed-path poisoning of request.url.hostname, patched in 1.3.0. [Primary advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-jp82-jpqv-5vv3)
- GHSA-x746-7m8f-x49c: HTTPEndpoint dynamic HTTP-method dispatch, patched in 1.1.0. [Primary advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-x746-7m8f-x49c)

The reviewed NOIE code did not contain production HTTPEndpoint subclasses or request.url-based authorization. Exploit prerequisites and upstream compatibility must be examined before upgrading; do not independently bump Starlette across FastAPI compatibility constraints.

## AI and Agent Assessment

LLM output is untrusted even if structurally valid. Gateway policies, implemented-tool registry, persisted confirmations, Executor ownership/leases and evidence validation remain the authority boundary. Record actions can still be semantically wrong within a user's own context; evidence existence is not factual truth.

Retrieved Memory is owner-scoped and current explicit intent takes priority. Recommendation context has purpose/relevance/time/count limits. These controls mitigate over-sharing and cross-user retrieval but are not guarantees against all semantic injection. No attack traffic or new semantic tuning was performed. Unimplemented destructive registry entries were not treated as runnable tools.

Selected text/history, Memory, project or recommendation context may reach OpenAI; this audit does not imply whole-DB/history dumps occur. Context minimization, consent, retention and privacy tiers should be assessed in later phases.

## Regression Results

| Check | Result | Scope |
| --- | --- | --- |
| Targeted backend auth/verifier/principal/ownership/access/bootstrap/account-link tests | 114 PASS | Included within full suite, not additional unique tests |
| python -B -m unittest discover -s evals -p 'run_*tests.py' | 651 PASS | Local deterministic suite; mocks/in-memory test DB, no production writes |
| node --test tests/auth.test.cjs | 52 PASS | Mobile auth contracts/races; not live provider proof |
| npx tsc --noEmit | PASS | Existing mobile tree, no source edits |
| Python AST syntax | 210 files PASS | Excludes virtualenv/cache directories |
| FastAPI import and configure_mappers() | PASS | Local app imports; 49 routes; no real DB query |
| npm audit | 94 affected entries | Findings, no automatic remediation |
| git diff --check | PASS | Existing and new documents reviewed; untracked document whitespace checked separately |
| Existing-file SHA-256 comparison | PASS | All 336 baseline files unchanged; only 3 new Security documents |
| Index preservation | PASS | No staged changes introduced |

Tests verify existing behavior, not the absence of the listed design gaps. Baseline completeness does not turn local mocks into live security evidence.

## Known Limitations / Follow-up Evidence

- No live auth flag/provider/Render start command/environment inspection.
- No production DB role/TLS/RLS/backups/log/CSP/edge-rate-limit review.
- No account takeover, payload flood, token extraction, semantic injection or cross-account personal-data experiment.
- No full dependency exploitability assessment or comprehensive Python advisory/secret-history scan.
- Deterministic tests do not establish OAuth provider configuration correctness, session revocation or runtime adversarial LLM behavior.
- No account deletion or backup/provider erasure test.
- Existing unrelated Lv4/appStyles changes were preserved rather than audited as newly authored production fixes.

## Next Phase

Recommend exactly **Phase 11.1 Production fail-closed auth configuration**. The source-default auth-off path is the highest-priority conditional production risk. Preserve explicit local development behavior, reject missing/invalid production configuration, and add deterministic startup/access tests before any live change. All other remedies remain a roadmap, not part of this audit.

