# Object Mention PostgreSQL Verification Preparation

This runner is for the dedicated local Docker test database only. It does not
verify a production deployment. Preparation does not authorize database writes.

## Exact Target

- Container: `noie-lifecycle-pgtest`, local Docker daemon, running and healthy.
- Host/port: `127.0.0.1:58704`.
- Database/user: `noie_lifecycle_test` / `noie_test`.
- Input: process environment `NOIE_SECURITY_TEST_DATABASE_URL` only.
- No fallback to `DATABASE_URL`; no password discovery or `.env` modification.
- Connection query parameters and other hosts, ports, databases, users are denied.
- Docker container ID is checked again after preflight and before migrations.
- TCP server startup fingerprint must match a read-only query inside the container.

## Default: Read-Only

From `C:\noie\backend`, after securely setting the dedicated test URL in that
terminal's environment (never paste it into chat or commit it):

```powershell
python -B -m evals.run_object_mention_pg
```

Default execution checks the migration graph and database identity, privileges,
PostgreSQL version, `gen_random_uuid`, read-only session mode and schema absence.
It does not create schemas, apply migrations, import business services, or seed
records. Missing credentials return `HOLD / TEST_URL_MISSING` without connecting.

## Isolation and Future Write Execution

Only after separate approval of the write scope:

```powershell
python -B -m evals.run_object_mention_pg --run-writes --ack-test-writes noie-lifecycle-pgtest
```

Each invocation creates a fresh `noie_object_pgtest_<32 random hex characters>`
schema. Activity schemas and `public` are excluded from the connection search
path. Schema reuse is denied. The runner never drops schemas or resets data.
Retained test schemas require a separate, explicit cleanup decision.

Existing migrations 0001 through `20261009_0022` run through an independent
Alembic environment using an explicitly supplied connection and
`version_table_schema=<Object schema>`. The parent of 0022 must be
`20261008_0021` and the graph must have exactly one head and 22 revisions.
No migration is added or altered by this preparation.

Only the child process receives a validated, schema-scoped `DATABASE_URL`.
Parent configuration and `.env` remain unchanged. Dotenv and external HTTP
transports are disabled in the write child. SQL timeouts bound lock waits.
Every fixture session checks the active schema and excludes all other schemas.

## Prepared Scenarios

1. Approved save, owner read, cached duplicate and original source immutability.
2. Same action with changed arguments is rejected without a new mention.
3. Same valid attempt, two real connections: one save and one reuse.
4. Before-commit rollback while a real waiter retries and saves one row.
5. Failed action has zero mentions after rollback; a new attempt safely saves one.
6. Stale attempt blocked behind a newer attempt: no stale write, current retry succeeds.
7. Message/Activity/Conversation FKs reject invalid references with the exact
   Object constraint name; `RESTRICT` also rejects source deletion.
8. Cross-account read and execution denial.
9. Damaged evidence is excluded from reads (intentional synthetic fault injection).
10. Synthetic account purge removes mentions, including self-references, while
   another account's sources remain unchanged.

`NullPool` gives independent connections. Worker events coordinate test timing,
not persistence serialization. A third PostgreSQL connection observes distinct
backend PIDs and `pg_blocking_pids`; a concurrency case fails unless actual
database lock waiting is observed. Direct executor races keep finalization
outside the two competing persistence calls, then verify normal cached replay.
Sequential scenarios use separate write and verification connections.

## Evidence Limits

Safety unit tests mock PostgreSQL/Docker. Passing them proves the execution
guards and contracts, not PostgreSQL concurrency or real migration success.
The Object scenarios and 0022 application remain UNVERIFIED until the separately
approved write command runs. Do not reuse earlier Activity 4/4 as Object evidence.
No raw URL, password, user text, UUID or driver traceback is forwarded. Output
contains fixed reason codes, scenario names and the retained test schema only.
