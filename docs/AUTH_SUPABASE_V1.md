# Supabase Auth Boundary v0.1

## Scope

Only `/chat` consumes a verified Principal. Auth OFF retains the existing dev-user path.
No account creation, automatic user linking, login UI, identity write API, or data transfer is implemented.
External subject and local `users.id` remain separate. Email and user metadata are not mapping keys.

## Configuration

- `NOIE_AUTH_ENABLED`: only `1`, `true`, `yes`, `on` enable verification; default OFF.
- `SUPABASE_URL`: the project's HTTPS base URL, without `/auth/v1` or query parameters.
- `SUPABASE_PUBLISHABLE_KEY`: the project's `sb_publishable_...` key.

Do not supply a service-role key, secret API key, JWT signing secret, or DB password for verification.
No secret values belong in logs. Leave Auth OFF until migrations and explicit account links are ready.

## Verification Contract

The pinned official Python SDK `supabase==2.32.0` runs `auth.get_claims(access_token)`.
Its implementation checks expiry and verifies asymmetric JWT signatures with the configured project's JWKS.
For HS256 or a missing `kid`, it validates the token using the configured Auth server's `get_user`.
NOIE does not decode JWT payloads itself or trust unverified claims.

The SDK's signature/expiry verification does not replace application claim checks.
NOIE additionally requires:

- `iss` exactly equals `SUPABASE_URL + /auth/v1`.
- `aud` is `authenticated` or an array containing `authenticated`.
- `role` equals `authenticated`, not `anon` or `service_role`.
- `is_anonymous` is explicitly boolean `false`; missing claims fail closed.
- `sub` is a canonical, non-nil UUID, normalized to lowercase for the mapping key.
- `exp` is a finite numeric timestamp in the future; optional `nbf` cannot be in the future.

Only `{provider: supabase, subject: verified sub}` leaves the verifier.
No email, full claims, raw token, or metadata is stored or logged.
The SDK client disables session persistence and automatic refresh, uses a bounded 10-second HTTP timeout,
and closes its supplied HTTP transport before the mapping DB session opens.
Per-request clients do not preserve JWKS caches across requests; optimization is deferred.

Official references:
- https://supabase.com/docs/reference/python/auth-getclaims
- https://supabase.com/docs/guides/auth/jwt-fields

## Identity Mapping

`auth_identities` has UUID `id`, UUID `user_id` FK to `users.id` with RESTRICT,
`provider` (50 characters), `subject` (255 characters), and timezone-aware `created_at`.
`UNIQUE(provider, subject)` prevents cross-user aliasing; `UNIQUE(user_id, provider)` permits
one external account per provider per local user. Their indexes also cover the user FK lookup.

The service only reads an existing identity and active local user. It never creates or links users.
`UNMAPPED_AUTH_IDENTITY`, inactive/missing local users, and DB failures all fail closed.
Token failures return generic 401 with `WWW-Authenticate: Bearer`; mapping failures return generic 403.
Internal codes are not returned to clients. No dev-user fallback is used for verified requests.

## Migration

Revision `20261005_0018`, parent `20261003_0017`, adds only `auth_identities`.
No existing user ID, conversation FK, original message, or memory changes.
Offline upgrade/downgrade SQL is validated; this task does not apply a real DB migration.
After separate approval and backup, the operator can run `cd C:\noie\backend` then `alembic upgrade head`.
Downgrade drops identity links, making linked accounts unmapped; it does not delete users/messages/memories.
Do not downgrade an active auth deployment without planning a link backup and rollback.

## Dependencies and Validation

Resolver compatibility checked against current FastAPI, Pydantic, OpenAI and httpx versions.
Supabase requires `websockets<16` (current global environment has 16); Uvicorn supports the resolved 15.x.
SDK installation and regression tests use an isolated temporary target, not global package replacement.
Offline tests include SDK verification of locally signed RSA JWTs with synthetic JWKS, wrong signatures,
expiry/claims failures, mapping isolation, and `/chat` mocks. No live Supabase or DB write is tested.

## Remaining Security Debt

These development APIs are not protected by this `/chat` boundary:
`/users/{user_id}/conversations`, `/conversations/{conversation_id}/messages`,
`/users/{user_id}/memories`, memory extraction user IDs and retrieval preview user IDs.
Other development Agent/domain APIs also need an ownership review before exposing real account data.
JWT claim verification is not a live revocation/session-validity check for asymmetrically signed tokens.
No project/account is created and no identity mapping is provisioned here.
Account-link proof, safe explicit provisioning, real PostgreSQL verification and live project validation
belong to the next step, before enabling production Auth.

## Phase 10.3 Explicit Administrative Account Link

`auth_account_link_service.link_auth_identity` is not a public API and performs no Supabase calls.
The CLI accepts only a local user UUID and a canonical lowercase Supabase subject UUID.
These strings alone are **not account ownership proof**: a trusted operator must independently verify
the intended account in the correct Supabase project and its authorization to receive the local user's data.
Do not link based on an untrusted client's subject, matching email, or an unverified decoded JWT.
`--confirm-link` is explicit operator approval, not a substitute for authentication proof.

Use a fresh, dedicated DB session. The service validates the active user, checks both unique mappings,
and flushes inside a savepoint. It does not commit. Actual writes lock the active local user only for
the short link transaction. Database UNIQUE constraints arbitrate competing external subject claims.
Same links are idempotent; either direction of conflicting links is rejected without reassignment.
The CLI commits successful explicit links and rolls back failures; dry-run rolls back its read transaction.
Dry-run is a point-in-time check, not a reservation. Existing users/messages/memories are not changed.

After separate approval, backup and target-DB confirmation (not executed in this task):

```powershell
cd C:\noie\backend
alembic current
alembic upgrade 20261005_0018
alembic check
python -m scripts.link_supabase_identity --user-id <LOCAL_NOIE_USER_UUID> --subject <VERIFIED_SUPABASE_SUB> --dry-run
python -m scripts.link_supabase_identity --user-id <LOCAL_NOIE_USER_UUID> --subject <VERIFIED_SUPABASE_SUB> --confirm-link
```

Replace the placeholders with the independently verified UUIDs; do not pass access tokens or email.
CLI output includes no UUIDs, tokens or connection strings. Keep `NOIE_AUTH_ENABLED=false`:
account linking alone does not protect the remaining development APIs or establish live end-to-end auth validation.
No migration, account link write or production environment change is performed during local tests.
