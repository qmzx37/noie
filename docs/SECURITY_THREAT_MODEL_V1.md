# NOIE Security Threat Model v1

Audit date: 2026-10-06. Repository: qmzx37/noie, branch main, HEAD 99132deb2a802491b06a4deec2521be549ecae20.
Scope: Phase 11.0, documentation-only source audit and local deterministic regression. This is not a penetration test or production security certification.

## System Overview

NOIE stores original Message records separately from interpreted Memory and Evidence. Auth flows use Supabase identities mapped to a local User and an immutable AuthPrincipal. Chat persistence commits the original user message before model processing; background Memory and Agent flows reuse the owner's context. Routing passes through Gateway, action persistence, confirmation and Executor before domain writes. Lv4/Shadow is not an alternative authentication authority.

The claimed Google/Kakao/Naver and A/B LIVE passes are user-provided historical context, not repeated or independently certified in this audit. No live provider, Render or production database request was made.

## Trust Boundaries

```text
User -> Browser / mobile device -> NOIE client
                       |                 |
                       v                 v
              Google / Kakao / Naver -> Supabase Auth
                                          |
                              verified token returned to client
                                          |
NOIE client -- Bearer / untrusted input --> Render FastAPI
                                          |       |
                           local identity /       | bounded context
                             ownership     |       v
                                          v     OpenAI API
                                      PostgreSQL   |
                                          ^        v
                                          |   untrusted typed output
                            background Memory / Agent pipeline
                               -> Gateway -> confirmation -> Executor
```

| Boundary | Data crossing | Trusted authority | Never trust automatically |
| --- | --- | --- | --- |
| User -> device | Password input, private text and local state | User intent, not browser integrity | Stored data, extensions, device accessibility or script-origin safety |
| Device -> social provider -> Supabase | OAuth code, PKCE challenge/verifier and tokens | Configured provider and verified Supabase identity | Redirect parameters, email as identity, arbitrary provider strings |
| Supabase -> client -> FastAPI | Bearer JWT | Server verification of signature and claims, then identity mapping | Decoded JWT, client user_id, email/user_metadata, frontend login status |
| FastAPI -> PostgreSQL | Owner-filtered reads and transactions | AuthPrincipal plus server-side checks | Resource UUID possession, model-selected ownership, global dev identity in production |
| FastAPI -> OpenAI | Selected text/history, Memory/project or recommendation context as required | Application decides scope; model is not an authority | Model factuality, prompt text masquerading as policy, unrelated personal context |
| Model -> pipeline -> DB | Typed proposals, evidence references, actions | Service ownership checks, registry/mode policy, confirmation and Executor | Schema-valid output as permission or proof |
| Response -> background task | Persisted identifiers and bounded task inputs | Original ownership and short lease/fenced transactions | Stale workers, duplicate request IDs, swallowed exception as business success |
| Service -> logs/build infrastructure | Diagnostic labels, dependency inventory | Restricted operational access | Error strings as safe data, build tools as non-sensitive, secrets as public configuration |

## Assets

| Class | Assets | Rationale |
| --- | --- | --- |
| CRITICAL | Access/refresh tokens, DB credentials, OAuth client/provider secrets, destructive execution authority | Account/control-plane takeover or broad data exposure |
| HIGH | Original conversations, long-term Memory/Evidence, relationships, emotion/body/cognitive history, schedules/location, personal projects and dreams/goals | Sensitive personal history, habits and social information |
| MEDIUM | Generic preferences, non-sensitive recommendations and app metadata | Raise to HIGH when linked to identity, private context or inferred health/social information |
| PUBLIC | Service URLs, Supabase publishable key, applicable OAuth client IDs | Public configuration, not access authority; never confuse with service-role keys or client secrets |

No real tokens, provider subjects, UUIDs, connection URLs, passwords or personal records are included in these artifacts.

## Existing Controls

- Auth ON: Supabase SDK get_claims plus application issuer/audience/expiry/nbf/role/non-anonymous/UUID-sub validation; invalid authority fails closed.
- AuthIdentity provider+subject maps to an active local User. Email/user_metadata are not identity authority. General unmapped access is rejected; bootstrap creation is explicit and transactional.
- Immutable AuthPrincipal; supplied user UUIDs are consistency checks, not authentication. Owner-filtered resources return 404 for another user.
- Agent action read/confirm/reject/execute paths enforce ownership. Registry and mode policy separate planning from implemented tools and require confirmation for execution.
- PKCE S256, provider allowlist, validated callback origin, code-only exchange and no token-fragment acceptance.
- Session generation/revision fencing, coalesced refresh and one 401 refresh retry; failed local clearing does not resurrect an in-memory session.
- Original Message and interpreted Memory remain separate; evidence and owning user/conversation/role are checked.
- Request/action idempotency, short DB leases, attempt fencing and retry caps protect duplicate/stale work. They are not request-rate controls.
- Recommendation relevance/time/count/purpose limits and current utterance priority reduce context scope. They do not guarantee perfect model judgments.
- Shadow/chat_bg use privacy-safe correlation. Health performs SELECT 1 without exposing credentials.

## Threat Scenarios

| Group | Scenarios | Assessment |
| --- | --- | --- |
| Authentication | Forged/expired JWT; stolen access/refresh token; replay; logout reuse | JWT/claim defenses verified offline. Persistent unencrypted tokens and local-only logout leave SEC-002/004. Live revocation behavior not tested. |
| OAuth / identity | Redirect tampering; code interception; provider/account-link confusion | PKCE, callback validation, provider allowlist and unique identity mapping defend the reviewed paths. Provider admin settings and live misconfiguration remain unverified. |
| Authorization | IDOR; forged user_id; cross-user Conversation/Memory/AgentAction; confirm/reject/execute; UUID enumeration | Principal-bound queries and 404 isolation pass deterministic tests. Auth-disabled production configuration remains SEC-001; UUIDs alone are not authority. |
| Local device | Storage theft; A logout/B login disclosure; corrupted storage; late refresh resurrecting session | Revision/generation race protection passes tests. Global NOIE storage and raw parse errors remain SEC-003/007. |
| API | CORS abuse; unauthenticated surface; flooding; chat cost; bootstrap/execute abuse; oversized/malformed input; replay/concurrency | Types, ownership and idempotency exist, but quotas, payload budgets and core pagination are incomplete (SEC-005/006/008/009). |
| Data/privacy | Private log content; secret/subject leakage; PII response; retention/deletion; wrong-user background work | Ownership/evidence controls exist. Raw exception paths and retention/operations need follow-up. Owner-visible PII is intentional; broad output leakage was not demonstrated. |
| Supply chain | npm/Python vulnerabilities; Expo 48; dependency confusion; unsafe upgrades | Lockfile exists, but affected toolchain entries and partially pinned Python dependencies remain. No automatic upgrades were run. |
| AI | Injection leading to execution; Memory poisoning; cross-user retrieval; model output as authority; destructive action without confirmation | Service/Executor authority is separate from LLM output. Own-memory factual poisoning remains possible. Destructive registry placeholders must not be described as implemented tools. No cross-user retrieval or confirmation bypass was demonstrated. |

## Severity and Evidence Policy

P0 = authentication bypass, broad disclosure, direct authority compromise or production fail-open.
P1 = realistic account/local disclosure, material privacy weakness or cost/availability abuse.
P2 = defense-in-depth, operational assurance or bounded information/semantic risks.
P3 = hygiene and low-impact discovery.

Severity is not proof of current exploitation. SEC-001 is P0 only if the unsafe configuration occurs in production; actual Render configuration was not inspected. npm advisory Critical severity is not automatically NOIE P0 severity.

## Risk Register

| ID | Asset | Threat / attack path | Existing control | Gap | Likelihood | Impact | Severity | Recommended fix | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | Production authentication / all private data | Configuration fail-open: Unset or mistyped NOIE_AUTH_ENABLED selects the legacy unauthenticated dev-user path. | Strict JWT and ownership checks when enabled. | No production-only fail-closed configuration guard. | Conditional: production configuration not inspected. | Authentication bypass and shared dev-user access if production is accidentally OFF. | P0 | Require an explicit environment mode and refuse unsafe production startup; preserve deliberate local dev mode. | 11.1 |
| SEC-002 | Access and refresh tokens | Device/browser storage theft: Read unencrypted AsyncStorage through compromised device, same-origin malicious script, or browser profile access. | Refresh coalescing, rotation and session race fences. | Persistent tokens are not in platform secure storage. | Conditional on local/device or same-origin compromise. | Bearer-session theft; refresh token can extend compromise. | P1 | Native Keychain/Keystore storage; separately design web session/XSS protections, not a blanket localStorage replacement. | 11.2 |
| SEC-003 | Local chats, projects and daily traces | Cross-account local disclosure: User A logs out, B signs in on the same installation; global NOIE keys are reloaded. | AuthGate blocks unauthenticated app access; session clearing is fenced. | NOIE data keys are not account-scoped and logout retains them. | Plausible on shared installations. | B can see A's retained local data. | P1 | Namespace storage by verified stable account identity and define safe logout, migration and unassigned-data behavior. | 11.3 |
| SEC-004 | Supabase session authority | Old-token/session replay after local logout: A stolen token is reused after local session removal; verifier validates JWT claims but not server session liveness. | JWT signature, issuer, audience, expiry and anonymous-role checks. | Local logout does not revoke Supabase sessions; no session_id liveness policy. | Requires token theft; duration depends on provider settings. | Unexpected continued account access. | P1 | Define provider logout scope, refresh revocation, acceptable JWT residual lifetime and optional sensitive-operation liveness checks. | 11.2 |
| SEC-005 | API availability / OpenAI budget / DB capacity | Flooding and cost exhaustion: Repeated chat, analysis, bootstrap or permitted action calls consume compute, model budget or rows. | Auth and ownership when ON; per-request idempotency; bounded action plans and attempt leases. | No application-level per-principal/IP quota or rate limiter found. | Authenticated abuse plausible; unauthenticated reach depends on auth mode and endpoint. | Service degradation, spend and storage exhaustion. | P1 | Add layered edge and application quotas, bounded concurrency and cost budgets; bootstrap-specific limits. | 11.5 |
| SEC-006 | Availability and private response volume | Oversized payloads / unbounded list reads: Huge chat text/history/project input or repeated full message/memory lists. | Pydantic types, some field limits and domain list bounds. | Several text/history fields lack upper bounds; core list APIs lack pagination. | Plausible with API access; edge body cap unknown. | Memory/CPU/model-token pressure and unnecessarily large private responses. | P1 | Bound bytes, strings, arrays and model budget; paginate core lists with stable ordering. | 11.5 |
| SEC-007 | Private data and logs | Exception/log disclosure: Provider error text or storage parse exceptions can include echoed input or credentials; background error logs include raw message IDs. | Many auth errors use safe labels; Shadow/chat_bg use hashed correlation. | Some raw exception strings/objects and UUIDs are still printed. | Conditional on exception contents and log access. | Potential private-data or secret disclosure; raw IDs increase linkability. | P1 | Use safe error classifications and hashed correlation; avoid raw exception/body logging and set log retention/access controls. | 11.4 |
| SEC-008 | Browser API boundary | Overbroad cross-origin access: Any origin can make CORS-authorized browser requests if it can supply valid authority, or access dev-mode endpoints. | allow_credentials=False; Bearer verification when ON. | allow_origins, methods and headers use wildcard. | Conditional; CORS alone is not an auth bypass. | Broader browser exposure and weaker defense in depth. | P2 | Allowlist intended web origins with environment-specific policy; retain actual authorization. | 11.4 |
| SEC-009 | API schema / operational metadata | Public surface discovery: Default /docs, /redoc and /openapi.json reveal API contracts; root/db-health are public. | Health executes SELECT 1 and returns no connection secrets; probe is gated. | No production-specific docs exposure policy. | High discoverability; low direct impact. | Simplifies endpoint enumeration, not private-record access by itself. | P3 | Decide production documentation exposure and protect operational endpoints as needed without substituting for auth. | 11.4 |
| SEC-010 | Build/development supply chain | Vulnerable transitive dependencies: Unsafe archive processing or vulnerable exposed dev-server middleware; not assumed present in static production assets. | Lockfile and explicit dependency tree are available. | npm audit reports affected Expo 48-era dependency entries including Critical and High. | Depends on affected tools being invoked/exposed and attacker-controlled inputs. | Build host compromise or development-server abuse; live app exploitability unproven. | P1 | Plan compatible Expo/toolchain upgrades and remove unused build paths after testing; do not use audit fix --force. | 11.8 |
| SEC-011 | Backend dependency reproducibility | Unpinned or affected dependencies: Deploy resolution differs from local versions; installed Starlette falls in selected advisory ranges. | Major bounds on SQLAlchemy/psycopg/Alembic; Supabase exact pin. | Most direct dependencies not locked; no comprehensive Python advisory scan. | Deployment variance plausible; reviewed advisory preconditions not demonstrated in NOIE. | Non-reproducible behavior and residual framework attack surface. | P2 | Create tested compatible lock strategy and full advisory inventory; review actual route/middleware preconditions. | 11.8 |
| SEC-012 | Long-term originals / memories / backups | Over-retention or incomplete deletion: Soft delete hides rows but retains originals/evidence, backups and exported/provider data. | RESTRICT FKs deliberately protect originals; deleted users/resources checked. | No end-to-end account purge/retention/backup lifecycle. | Persistent by design. | Privacy obligations and user expectations may not be met. | P2 | Document retention and explicit verified purge workflow, backup expiry and third-party scope before implementing deletion. | 11.7 |
| SEC-013 | AI context / memory integrity / tool authority | Prompt injection or own-memory poisoning: User or retrieved text asks model to invent records, override intent or select tools. | Ownership, evidence validation, typed schemas, registry/mode checks, confirmation, executor leases/fencing; current utterance priority. | Schema validity does not prove factuality or semantic safety. | Plausible within the attacker's own context; cross-user bypass not demonstrated. | Incorrect memories or domain records and unsafe recommendations; protected destructive authority remains a separate boundary. | P2 | Separate instruction/data trust, preserve evidence, add adversarial semantic tests and privacy tiers; never grant model authority. | 11.6 |
| SEC-014 | Secrets / production infrastructure | Unknown operational controls: Weak DB role, missing transport/log controls, exposed build server or mismanaged secrets could defeat application defenses. | Environment-based credentials; .env files not tracked in current index; selected context minimization. | Live TLS, DB privileges/RLS, CSP, quotas, backup encryption/retention, secret history and provider settings not verified. | Unknown, not evidence of misconfiguration. | Potential severe impact if an operational control is absent. | P2 | Perform a scoped read-only operational checklist and dedicated secret/history scan without disclosing secret values. | 11.9 |

Code evidence and confidence for every entry are recorded in SECURITY_BASELINE_V1.md and SECURITY_BASELINE_RESULTS.json.

## Recommended Roadmap

The single next phase is **11.1 Production fail-closed auth configuration**: explicit production mode, startup validation and deterministic tests for missing/invalid flags, while preserving intentional local dev behavior. Do not change provider configuration as a substitute for this boundary.

After that:
1. 11.2: Native secure token storage plus a separately reviewed web storage/session design; define logout/revocation policy.
2. 11.3: Account-scoped local data and safe transition/migration behavior.
3. 11.4: Redacted logging, intended-origin CORS and deliberate API/docs exposure.
4. 11.5: Rate/concurrency/cost budgets, payload limits and stable pagination.
5. 11.6: Memory privacy tiers and adversarial model/context tests.
6. 11.7: Verified account deletion, retention and backup/provider lifecycle.
7. 11.8: Compatible, reproducible dependency upgrades; triage exploitable build/dev paths early rather than wait for a feature release.
8. 11.9: Scoped operational assurance and attack/abuse tests.

Do not bundle all phases into a broad refactor. No repair was performed in Phase 11.0.

## Public Reference Notes

JWT expiry and logout are not the same as immediate token invalidation; Supabase documents session/JWT lifetime considerations. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)

CORS is a browser cross-origin policy, not authentication; intended origins should still be restricted. [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)

