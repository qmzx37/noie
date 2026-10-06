# Security Phase 11.3: Per-account Local Data Isolation

## Scope and baseline

Baseline HEAD: `a75c9df6e114747e61b6854f5503f825be90db06`.
Phase 11.2 secure token changes were already in the working tree and are preserved.
This phase changes mobile local data routing only. Backend authorization, DB schema,
Agent, Memory, Lv4 and Shadow contracts remain unchanged.

## Storage inventory

| Classification | Logical key | Purpose |
| --- | --- | --- |
| Account-private | `noie_chat_sessions_v1` | Sessions and nested private app records |
| Account-private | `noie_current_chat_id_v1` | Current chat pointer |
| Account-private | `noie_daily_traces_v1` | Daily traces and nested records |
| Account-private | `noie_daily_long_records_v1` | Long daily records |
| Account-private | `noie_dream_torch_id_v1` | Dream selection pointer |
| Account-private | `noie_projects_v1` | Projects |
| Account-private | `noie_project_messages_v1` | Project messages |
| Authentication | `noie_auth_session_v1` | Web session; native legacy auth migration source |
| Authentication | `noie_auth_refresh_v1` | Native SecureStore refresh credential |

Dreams, emotions, schedules and routines use existing nested data structures, not
additional persistent keys. Active project, screen mode, selected dates and filters
are React memory state. No persisted device-global non-private setting was found.
All existing App private storage calls, including developer reset, use the captured
account adapter. Authentication storage stays separate under Phase 11.2 policy.

## Verified identity and namespace

After obtaining a valid session, AuthGate calls authenticated
`GET {SUPABASE_URL}/auth/v1/user` with the access token and configured public key.
Only the returned authenticated, non-anonymous User ID is accepted. Missing,
malformed or nil IDs fail closed. The request has a 15-second abort deadline.
Email, display name, client-supplied IDs and unverified JWT payloads are not used.

Namespace construction:

```text
SHA256("noie.account-local.v1:" + canonical authenticated Supabase User ID)
noie_u_<full 64-character lowercase digest>_<existing logical base key>
```

The same authenticated account produces the same namespace across login cycles;
different accounts produce separate namespaces. No raw ID, email, access token or
refresh token is stored in private key names or identity error logs.
This digest is a pseudonymous local selector, not encryption or a server ACL.
Backend authority remains verified JWT -> AuthIdentity -> AuthPrincipal.

## Mount, refresh and races

AuthGate invokes private children only after identity verification and generation
checks. NoieApp receives an explicit namespace and a React key based on it.
The storage adapter captures that namespace once at mount, without a mutable
global current-account selector. A delayed A write therefore remains in A's
namespace even after B logs in; it never changes destination to B.

Account changes reset mounted React state. Identity requests from earlier login
generations cannot publish results after logout or another login. A token refresh
within the already verified login generation retains the namespace and mounted
state without another identity fetch. Pending identity requests are fenced on
session changes. Identity errors show a safe login/retry state, with no private
mount or global-key fallback. This is not a new token-revocation mechanism.

## Legacy, logout and reset policy

Existing global private keys have no reliable ownership evidence. They are kept
unchanged but never read, copied, adopted or automatically deleted by the account
adapter. Previously global data may therefore appear absent in the new account
view; it is quarantined, not erased. Explicit recovery/import requires a future
ownership-aware design and is not implemented here.

Logout clears credentials using the existing Phase 11.2 policy, not private
account records. A can log back in to restore A's namespaced data; B cannot hydrate
it through normal app calls. Developer reset removes only the mounted account's
seven private keys, not other accounts, legacy keys or authentication credentials.
Corrupt JSON falls back within the same account, without private key/error details
in parse logs. Existing fallback persistence can replace corrupt data in that
account; it cannot read or modify another account as a fallback.

Email/password, Google, Kakao and Naver share the same AuthGate identity pipeline.
Different Supabase users have different namespaces even if a person regards them
as the same account. No implicit provider/account linking is added.

## Changes and verification

Modified: `mobile/App.tsx`, `mobile/src/features/auth/AuthGate.tsx`,
`mobile/src/noie/storage.ts`, and two App source assertions in
`mobile/tests/auth.test.cjs` (the Phase 11.2 tests are retained).

New: `mobile/src/auth/accountIdentity.ts`, `mobile/src/noie/accountStorage.ts`,
`mobile/tests/accountStorage.test.cjs`, and this document.

- `node --test tests/accountStorage.test.cjs tests/auth.test.cjs`: 87 passed;
  13 account isolation tests plus all 74 authentication regression tests.
- Tests cover all seven private keys, pointers, A/B restoration, legacy quarantine,
  delayed writes, current-account reset, corrupt storage and safe errors,
  identity failures, late identity fencing, refresh and account-change gate behavior.
- ATTACK-LOCAL-001/002/003/004 are covered with synthetic identities and mocks.
- `npx tsc --noEmit`: passed.
- `npx expo export --platform all --output-dir .expo/security11-3-final`: passed
  for Web, Android and iOS; native Hermes bytecode generation also passed.
- `git diff --check`: passed (Git reports only LF/CRLF normalization warnings).
- SHA256 comparison of 345 pre-existing files: only the four intended modified
  files changed. Protected styles, Lv4 files, backend and Phase 11.2 production
  token files remain identical to the pre-task working tree.
- No dependency changes, migrations, live provider requests or DB operations.
- No stage, commit, push or destructive Git operation.

Tests use mocked storage, authenticated identity responses and a hook harness;
exports prove compilation, not real OS persistence or live OAuth behavior.
Verdict: `SECURITY_11_3_READY` for LOCAL/MOCK verification, not native/live E2E.

## Remaining debt and next phase

Private AsyncStorage records remain unencrypted. Local attackers or Web XSS can
access underlying storage; hashing names does not prevent that. Secure token
storage and local account isolation address different threats. Real-device A/B
and cold-start validation, live identity failure behavior, multi-tab session
coordination and a safe explicit legacy recovery design remain to be assessed.
Same-account asynchronous write ordering is not redesigned in this phase.

Next phase only: **11.4 CORS / API Surface Hardening**.
