# Behavior Agent v0.1

## Responsibility

Behavior interprets explicit user self-reports of an action and its status. A
`performed` interpretation is not independent proof that the real-world action
occurred. Message remains the source of truth. This version is read-only and
does not create Memory, agent_actions, or domain DB rows.

Activity Recorder is not implemented: no start/end, duration, timeline, GPS,
location, people, purpose, emotion, or inferred occurrence timestamp is added.
`3시부터 5시까지 NOIE 개발했어` can produce `NOIE 개발 / performed`,
but the explicit time stays in evidence only.

## Contract

- `BehaviorContext`: current_utterance, source_message_id (optional), observed_at
  (optional), and the inherited SpecialistInput evidence field.
- `BehaviorObservation`: action, status, existing OpinionEvidence, confidence.
- `BehaviorAnalysis`: source_message_id, behaviors (maximum 16), reason.
- Status: performed, ongoing, intended, desired, not_performed, candidate.
- Reasons: recognized, no_explicit_behavior, privacy_restricted.
- Unknown confidence remains null. No invented score is used.
- Evidence uses `source_type=utterance`, an exact matched clause, the Message ID
  as evidence_ref when available, and `interpretation=true`.
- observed_at is an existing timezone-aware Message.created_at supplied by the
  owned-message service, not the time the action happened. It stays null if no
  trustworthy aware timestamp is available. The Agent never calls a clock.

Examples:

| Utterance | Action | Status |
| --- | --- | --- |
| 오늘 운동했어 | 운동 | performed |
| 지금 NOIE 개발하고 있어 | NOIE 개발 | ongoing |
| 오늘 저녁에 운동할 거야 | 운동 | intended |
| 운동하고 싶어 | 운동 | desired |
| 오늘 운동 안 했어 | 운동 | not_performed |
| 운동할까 개발할까? | 운동, 개발 | candidate, candidate |

## Existing Architecture

`BehaviorSpecialist` implements the existing `SpecialistAgent._run` contract.
The inherited `run` method validates and returns an ordinary AgentOpinion.
It can be registered as `behavior` in the existing SpecialistRegistry without
overriding common run validation or introducing another framework.

`analyze(BehaviorContext)` is the typed domain-result interface. `_run` projects
those results into existing opinion evidence; suggested_actions stays empty.
No Gateway/Executor is invoked. No behavior record Tool is advertised as
implemented. Production Orchestrator/chat and Lv4 State/Recommendation/Critic/
Arbitrator remain unchanged and do not automatically consume this result.
An explicit future read-only adapter is needed before Lv4 State can consume it.

## Owned Read API

`GET /messages/{message_id}/behavior` returns BehaviorAnalysis for one active
account's own user Message. It is included through the existing Agent router.

- Verified AuthPrincipal is required, even when legacy Auth is OFF. There is no
  anonymous dev-user fallback on this new endpoint.
- No request body/user_id selector, automatic user bootstrap, DB write, OpenAI
  call, background task, or history/Memory lookup is added.
- The Message author must equal the Conversation owner and principal.
- Active User/Conversation required. Cross-user, absent, deleted, and
  assistant/system sources return the same 404; anonymous access returns 401.
- Invalid UUID/input shape returns 422. DB errors return fixed 503, roll back,
  and never echo exception text.
- The existing standard protected rate/resource policy applies; it is not an
  expensive/model endpoint. No classifier or dependency changes are needed.
- Existing API request/response contracts remain unchanged. This GET is additive.

## Privacy and Limits

The existing `automatic_memory_allowed` privacy classifier is reused as a
conservative gate. Sensitive/secret/third-party-sensitive text produces no
behavior/evidence and reason=privacy_restricted. This does not create Memory or
change its policy. No raw source, UUID, or analysis is written to new logs.
Evidence text is returned only to the verified owner, never sent to OpenAI.

This is a deterministic explicit-grammar v0.1, not a general Korean language
understanding model. It supports 운동, 개발, 공부, 독서, 산책, 요리, 연습, 게임,
뜨개질, 그림 그리기, 사진 촬영; optional single ASCII project/object labels or
파이썬/기타/피아노; explicit first-person and a small set of temporal prefixes.
Supported endings are listed in `_FORMS`, including polite variants, intentions,
negative past reports, and `할까` candidates. Unsupported wording abstains.

Every clause in a sentence must match the grammar; substring keyword hits do
not establish behavior. Third-party reports, quotes, conditions, negated desires,
completion questions, vague goal/self statements, and ordinary knowledge
questions are not promoted. Mixed/unrecognized sentence clauses may therefore
lose recall intentionally. Future semantic extraction can be evaluated separately
without changing the evidence/status contract.
Quoted utterances are conservatively skipped as a whole, including multiline
quotes; they are not silently converted into the speaker's own behavior report.

Input uses the existing MAX_TEXT_CHARS=8192 budget. Evidence respects the existing
500-character OpinionEvidence limit: an overlong matched clause is skipped,
never silently truncated. At most 16 observations are returned. These bounded
results are not a complete activity history. Unsupported/long persisted messages
are rejected with a fixed 422 rather than echoed or rewritten.

## Verification

Run through the repository's isolated deterministic harness (it disables dotenv,
external HTTP/OpenAI/PostgreSQL), not live E2E scripts:

```powershell
cd C:\noie\backend
python -B evals/run_security_adversarial_verification.py --backend-root C:\noie\backend --suite baseline
python -B evals/run_security_adversarial_verification.py --backend-root C:\noie\backend --suite security
cd C:\noie\mobile
node --test tests/auth.test.cjs tests/accountStorage.test.cjs
npx --no-install tsc --noEmit
cd C:\noie
git diff --check
```

New tests: `run_behavior_tests.py` (semantic/schema/evidence/registry/limits),
`run_security_behavior_tests.py` (real ORM queries in synthetic SQLite, account
isolation, deactivation, role policy, DB fingerprints/no flush or commit, safe
errors, privacy). SQLite fixtures are not evidence of a live PostgreSQL test.
No migration or real PostgreSQL/OpenAI/Render request is required or performed.
