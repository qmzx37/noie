# Object Mention Persistence v0.1

## Scope

Explicit, user-confirmed mention storage and owner-only internal reads. A
mention verifies an expression in a user-reported Activity's original Message;
it is not proof of a real-world event or resolved identity. The existing
Orchestrator, /chat, Lv4, Place, Relationship, Goal and Dream remain unchanged.
No SDK, automatic extraction, identity, alias, merge or split is implemented.

## Entry points

The existing authenticated Tool Gateway / Action plan / confirmation / Executor
flow supports `type=object`, `intent=save_object_mention`, `mode=execute`.
Arguments reuse `ActivityObjectReferenceRequest`: `activity_id`, `kind`, `label`,
`source_span`. The Action's source must match that Activity's original Message
and Conversation. Existing authentication binds the Action owner; no new
user-ID authority is introduced.

The existing execute confidence policy is unchanged. This Action policy score
is not an Object identity confidence and is not copied into the mention.
The server hashes the exact arguments plus owner/source IDs into an approval
binding. Replanning with changed arguments, changing approved arguments, or
using another account cannot reuse the original approval. This binding detects
changes; it is not a signature protecting against a compromised database.

After an explicitly approved migration/deployment, enable writes and internal
reads with `NOIE_OBJECT_MENTION_ENABLED=true`. Unset/invalid values are OFF.
This work does not change environment settings or apply migrations.
No public Object endpoint or mobile interaction is added in this phase.

`read_object_mentions(db, principal, mention_id=None, limit=50)` requires an
AuthPrincipal, checks the current active account, and returns up to 50 validated
mentions. A detail request returns 404 if unavailable; invalid entries are
excluded from a list. The limit bounds candidates, so a damaged candidate can
make a page shorter. There is no history dump or identity inference.

## Storage and retries

`object_mentions` uses UUIDs, RESTRICT FKs, exact label/code-point span,
`kind_basis=user_selected`, `identity_status=unresolved`, and nullable observed
time copied from Preview. Python code points, not UTF-8 bytes or JavaScript
UTF-16 positions, define offsets. No normalization of the source or label occurs.

UNIQUE(agent_action_id) permits one mention per approved Action. An existing
row must exactly match its approval and current source before reuse. A new
Action may store the same name again; names are never deduplication keys.
The executor locks User, Action, Activity, Conversation, then Message, validates
the attempt and current evidence, and commits a short transaction. It rolls
back on failure. Finalize-loss retry reuses the committed row; stale attempts
cannot insert. Completed replay rechecks the approval/source/mention.

Read responses include the mention ID, Activity ID, kind, label, source span,
fixed basis/identity status, observed_at, and active status. Full Message text,
evidence metadata, owner/source/action IDs and credentials are not included.
Executor results contain only a mention ID and reuse flag. No new logging exists.

## Migration and account deletion

`20261009_0022` follows `20261008_0021`; it adds only the mention table,
constraints and indexes, without existing-data changes or backfill. Apply it
before deploying model/purge registration code: the schema inventory is strict,
and an OFF feature flag is not a substitute for migrating the registered table.
Downgrade drops mention records and is destructive for this feature's data.

The nullable unique self-reference and superseded status reserve a future
correction contract. Phase 1 cannot create corrections, delete mentions or
resolve identities. Unsupported/corrupt state is not returned or recreated.
Account purge deletes mentions before Activities and clears only the deleted
account's self-references inside the existing atomic purge. Cross-account
references abort purge rather than deleting another account's records.

## Verification boundary

Synthetic SQLite/Mock tests exercise approval, ownership, exact spans,
read privacy, rollback, retry/fencing, uniqueness and account purge. SQLite
thread tests explicitly simulate serialization; they are not proof of real
PostgreSQL locking. SQLite lease tests restore known server-generated UTC only,
never infer unknown Activity times. Actual PostgreSQL contention, migration
application and production canary require separate authorization.
