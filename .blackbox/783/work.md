# Work — quickstart-now/hejbro#783

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — ledger judged by identity across migrate/status/reset/raise

_2026-09-04T13:31Z_

Added a shared ledger identity probe, `packages/cli/src/apply/ledger-identity.ts`: one `pg_class`/`pg_namespace`/`pg_attribute` catalog read (never `to_regclass`, never `information_schema`), no transaction. The relation at `"hejbro"."migration_ledger"` is judged the ledger only when `relkind = 'r'` and its columns include the four bootstrap columns (`id bigint`, `filename text`, `origin text`, `applied_at timestamp with time zone`), a superset tolerated; anything else is `occupied`, naming the relation kind and its columns.

Measured on `postgres:17-alpine`: `to_regclass('"hejbro"."migration_ledger"')` answers non-null identically for 9 relation shapes at that name (ordinary table, table with an extra column, partial-column table, unrelated table, view, materialized view, sequence, foreign table via file_fdw, partitioned table with the exact four columns) — existence alone cannot tell them apart. `create table if not exists hejbro.migration_ledger (...)` against an occupied name returns a NOTICE and skips, regardless of relkind.

`assertLedgerNotOccupied(identity, commandName)` throws the coded `apply-ledger-occupied` error, shared by all four ledger-touching commands, each probing at its own point before touching the ledger: `reset` right after the empty-declaration refusal and before the `--confirm-drop` check; `status` before `readLedger`; `migrate` after the interactive-transactions check and before `bootstrapLedger`, reporting exit 2; `raise` as its first statement, before `readLedger` or bootstrap.

Live witness (`apply-reset.integration.test.ts`): against a real `postgres:17-alpine` container, an unrelated 3-row table and a view at the ledger's name were each tested against all four commands (`reset`, `status`, `migrate`, `raise --file`) — all four refuse coded, the occupying object's rows and shape are untouched, and no bootstrap ever runs.

Commits: 833fa54e (shared probe), 04f6e878 (reset), 01540f03 (migrate), 4047f900 (raise), 008d0467 (live witness). Unit test count: 937 -> 964 (+27 across 1.1-1.5). Integration test count for this file: 5 -> 7 (+2).

