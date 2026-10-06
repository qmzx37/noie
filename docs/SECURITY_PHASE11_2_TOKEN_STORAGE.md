# NOIE Security Phase 11.2 - Secure Token Storage v0.1

Date: 2026-10-06. Base HEAD: a75c9df6e114747e61b6854f5503f825be90db06.
Verdict: **SECURITY_11_2_READY - LOCAL/MOCK PASS**.
Native OS build/install and live Keychain/Keystore/provider canary: **NOT RUN**.
This is not a claim that token storage is fully secured on every platform.

## Previous Risk and Existing Lifecycle

Previously authSession saved accessToken, refreshToken and expiresAt as a full
JSON session in unencrypted AsyncStorage. A native ordinary-storage dump could
therefore disclose both bearer credentials.

Existing flow, preserved:
- Password/signup/OAuth token response -> completeSignIn -> /auth/bootstrap
  ready -> saveAuthSession -> listeners -> AuthGate mounts the existing app.
- getValidAuthSession -> loadAuthSession -> refresh near expiry.
- refresh requests coalesce by revision, rotate credentials and publish only
  after successful persistence.
- Chat/helper 401 performs one refresh/retry with the same body/request_id.
- clearAuthSession immediately increments revision/generation and notifies
  null, then serializes deletion. Late old login/refresh responses cannot
  overwrite a new account.

## Native Architecture

Metro resolves authSessionStorage.native.ts on iOS/Android; Web resolves
authSessionStorage.web.ts. The default .ts re-export gives TypeScript the same
contract without importing Native SecureStore into Web.

| Material | Native location |
| --- | --- |
| accessToken | Runtime authSession memory only |
| refreshToken | SecureStore key noie_auth_refresh_v1 |
| expiresAt | Runtime memory only |
| Persisted format | Version 1 plus refreshToken only |
| Legacy auth key | Read only for migration, then removed; never newly written |

getAccessToken remains available. On a cold start, loadAuthSession reads secure
refresh material and uses the existing coalesced refresh path to obtain a new
access token. It never publishes a legacy disk access token. Restoration occurs
outside the serialized storage queue because refresh saves through that queue;
awaiting it inside the queue would deadlock.

The existing public session functions and caller contracts remain. The shared
refreshAuthCredential helper reuses the existing grant/rotation/error handling.
Its cross-module function reference is invoked only after module initialization
and storage reading; no token request occurs at module import.

This protection concerns app-owned auth persistence, not root/jailbreak access,
live process memory, OS crash dumps, browser developer tools or remote logging.
Other NOIE local data is not migrated or deleted in this phase.

## SDK 48 Compatibility and Options

Installed with npx expo install expo-secure-store. The installed Expo 48 bundled
module map selects ~12.1.1; package-lock resolves 12.1.1. No broad upgrade.

Checked the installed package's TypeScript definitions and Objective-C enum/
accessibility mapping, not guessed constants. Options:
- keychainService: noie.auth.refresh, consistently used for read/write/delete.
- keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY.
- requireAuthentication: false; no biometric prompt on every request.

The iOS policy restricts access to an unlocked device and uses device-only
keychain accessibility. Android uses the package's platform encrypted storage/
Keystore implementation; the iOS accessibility option is not a promise of an
identical Android unlock policy. Physical-device behavior remains to be tested.

The SDK has a 2048-byte value budget. This implementation conservatively limits
serialized credential JSON to 600 UTF-16 code units (at most 1800 UTF-8 bytes),
rejecting oversized credentials safely rather than splitting secrets or falling
back to ordinary storage. Compatibility with actual deployed refresh credential
sizes is part of the native canary.

General storage properties and backup caveats: [Expo SecureStore documentation](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/).
That documentation is newer than SDK 48; actual API/constant compatibility was
verified from local 12.1.1 source. The archived v48 documentation could not be
fetched during this task.

## Legacy Migration and Corruption

1. If secure material exists, it is the sole authority and the legacy auth key
   is removed. Conflicting legacy account data cannot override it.
2. If secure material is absent, legacy JSON must pass the existing session
   validator. Only its refresh credential is written to SecureStore.
3. Secure write and legacy removal must both finish before restoring/publishing
   a session. The migrated refresh credential gets a fresh token grant.
4. Invalid legacy JSON/fields or corrupt/empty/wrong-version secure data deny
   login and trigger best-effort deletion of both auth stores.
5. Secure read/migration/write failures never use the legacy session as fallback.

No token, session JSON or raw storage error is logged. No other NOIE storage
keys are removed.

## Failure, Atomicity and Rotation

A single versioned secure entry contains the refresh credential. A storage
operation and legacy removal must succeed before memory publication/notification.
Refresh rotation does not publish a new access token while retaining an old
refresh credential as usable authority. A failed rotation write invalidates
memory, increments fences and attempts secure/legacy cleanup; it does not
restore the old refresh credential.

A crash after a successful secure write but before memory publication can
restore from the secure credential at the next startup. A crash before legacy
removal may leave the old key physically present, but secure authority wins at
the next successful migration. There is no cross-storage atomic transaction or
claim of forensic erasure of old SQLite/journal/backup copies.

Read/write/delete failure returns null or safe login-required errors, not raw
OS/provider errors. An unavailable or locked secure store is not treated as
permission to use ordinary-storage auth.

## Logout and Races

Logout immediately removes runtime authority, notifies null and increments
revision/generation. It then deletes secure refresh material and the legacy key.
Both deletions are attempted even if one fails.

SDK 48 iOS deletion can fail without forwarding its OS return code, so the
adapter additionally reads back the key and requires absence. Silent no-op
deletion is treated as failure. A remaining credential or read-back failure
cannot re-authenticate the current runtime.

**Residual deletion risk:** if the OS/storage refuses deletion, credential
erasure cannot be guaranteed. A remaining credential could become readable
after a later process restart. Retry cleanup/device remediation and a future
provider revocation/logout policy are required; this phase does not pretend to
solve that with plaintext tombstones or insecure fallback.

Queued saves, delayed refresh success/failure, cold-start refresh and delayed
storage writes all retain revision/generation fences. Stale work cannot publish
after logout or overwrite B with an earlier A response.

## Web Residual Risk

Web retains its AsyncStorage session format and refresh/OAuth behavior.
SecureStore is not imported into the Web bundle or mocked as browser security.

**WEB RESIDUAL RISK:** JavaScript-accessible browser persistence does not protect
tokens from XSS or compromised same-origin scripts. A Web HttpOnly Secure Session/
BFF design is a separate future phase, not implemented here.

Local logout still does not revoke Supabase server sessions. Session expiry and
refresh rotation differ from provider logout/revocation. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)

## Tests and Verification

All tokens in tests are synthetic fixtures; all HTTP/AsyncStorage/SecureStore
operations are mocks. No actual Supabase, Render DB or OpenAI request was made.

| Check | Result |
| --- | --- |
| Existing mobile auth tests | 52 PASS, none removed |
| Additional Native security tests | 22 PASS |
| Total node --test tests/auth.test.cjs | 74 PASS |
| npx tsc --noEmit | PASS |
| Metro Web export | PASS |
| Android/iOS Metro + Hermes bytecode export | PASS |
| Platform marker verification | Web excludes Native secure key/API; iOS/Android include them |
| Native Gradle/Xcode application build | NOT RUN |
| Physical-device SecureStore/provider canary | NOT RUN |
| Auth logging scan | No console log/warn/error statements in reviewed auth/auth-feature source |
| npm audit after installation | 94 entries: Critical 2, High 55, Moderate 36, Low 1; unchanged from 11.0 |
| git diff --check | PASS, line-ending warnings only |
| Existing-file hash protection | Only the five explicitly changed mobile files differ |

Tests cover ATTACK-TOKEN-001/002 (ordinary/disk storage lacks new native access
tokens), ATTACK-TOKEN-003 (no insecure fallback), ATTACK-TOKEN-004 (late refresh),
cold-start coalescing, migration authority/corruption, secure read/write/delete
failure, silent deletion failure, refresh atomicity, queued logout/new login,
Native 401 retry, and Google/Kakao/Naver platform storage after bootstrap.

The initial default Web export attempt failed with EPERM deleting the existing
dist/metadata.json. It was not worked around by deleting existing output.
Exports instead use separate ignored .expo paths and preserve existing dist.

Final export command from C:\noie\mobile:
```powershell
node --test tests/auth.test.cjs
npx tsc --noEmit
npx expo export --platform all --output-dir .expo/security11-2-final
npm audit --json --ignore-scripts
```

npm audit exit 1 indicates existing vulnerability findings. No npm audit fix,
--force, dependency sweep or backend dependency change was made.

## Files and Working Tree Protection

Modified:
- mobile/src/auth/authSession.ts
- mobile/src/auth/supabaseAuth.ts
- mobile/tests/auth.test.cjs
- mobile/package.json
- mobile/package-lock.json

New:
- mobile/src/auth/authSessionStorage.ts
- mobile/src/auth/authSessionStorage.web.ts
- mobile/src/auth/authSessionStorage.native.ts
- docs/SECURITY_PHASE11_2_TOKEN_STORAGE.md

Backend, migrations, app.json, auth UI, appStyles, Lv4 files and earlier Security
documents are unchanged. Existing tracked/nonignored untracked files are
compared by SHA-256 before/after; no unrelated file was changed or deleted.
No stage/commit/push or destructive Git command.

## Native Canary Still Required

Use dedicated test accounts on both iOS and Android:
1. Build/install against the matching SDK/native module; test unlocked/locked
   access and keychain/Keystore availability.
2. Sign in via password and each configured OAuth provider; inspect only
   presence/absence and field names, never print credential values.
3. Confirm AsyncStorage auth key absent and runtime access available.
4. Kill/restart the app; confirm one refresh grant and rotated secure credential.
5. Test migration from a dedicated legacy fixture and invalid/malformed entries.
6. Test logout, device restart, storage unavailability and A-to-B switch.
7. Verify Android backup/restore exclusions and iOS reinstall/keychain lifecycle
   in the actual app build. Metro/Hermes export is not evidence of these controls.

No production deployment or settings were changed by this work.

## Remaining Debt and Single Next Phase

Web XSS token exposure, provider revocation policy, forensic legacy residue,
device backup/reinstall behavior, secure-store refusal and the existing Expo 48
supply-chain findings remain. Actual native canary is pending.

Recommend only **11.3 Per-account Local Data Isolation** next: separate NOIE
local chat/project/daily records by verified account identity without erasing
unrelated data. This phase deliberately preserves those records on logout.
