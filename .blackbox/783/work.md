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

<a id="w2"></a>
## W2 — review repairs: relkind words, columns clause, unlogged

_2026-09-04T14:27Z_

Constructor-mode review of 51c0d7d5 found the relkind-to-word map covered only `r/p/v/m/f/S`, so a composite type, an index and a partitioned index (constructed against a real `postgres:17-alpine` server, all three reach the probe) rendered as a bare catalog letter (`relation (c)`, `relation (i)`, `relation (I)`) instead of a word. Fixed in two review-repair tasks.

2.1: `RELATION_WORDS` gained `c` composite type, `i` index, `I` partitioned index, `t` TOAST table (10 of PostgreSQL 17's relkind letters covered; the fallback `relation (<letter>)` is reached only by a letter a future Postgres version adds). The `(columns: …)` clause is now rendered only for a kind that carries columns worth naming (`r`, `p`, `v`, `m`, `f`, `c`) — a sequence's, an index's, a partitioned index's, or a TOAST table's own catalog columns are internal machinery, not a schema a user can act on; omitted entirely for those, never rendered empty. Unit test input table gained 4 rows (composite type, index, partitioned index, TOAST table) plus 3 message-level assertions (a table's message carries the clause, a sequence's and an index's do not).

2.2: The probe now reads `c.relpersistence` beside `c.relkind`. `ledger` requires `relkind = 'r'` **and** `relpersistence = 'p'` (logged) — an unlogged table's rows vanish on a crash, so it can never hold the record of what was applied. The `"unlogged "` word prefix is generic across every relkind (not special-cased to `relkind = 'r'` alone): a partitioned table, a sequence (PostgreSQL 15+ supports `create unlogged sequence`), and an index (which inherits its table's persistence) can all be unlogged too. Unit test input table gained 3 rows: an unlogged table with the exact four bootstrap columns, an unlogged partitioned table, and an ordinary table with every column dropped (a zero-column table, to pin the pre-existing "(no columns)" wording for a column-bearing kind that happens to have none). Fixing 2.2 in isolation first broke four other test files (`apply-reset.test.ts`, `status-command.test.ts`, `migrate-command.test.ts`, `reset-command.test.ts`) whose own "this is the real ledger" fake catalog fixtures had no `persistence` field — measured as 24 failing tests across those files before the fixtures were updated to answer `persistence: "p"`.

Commits: dcf0506b (2.1), d06fa93f (2.2).

<a id="w3"></a>
## W3 — review repair: article before the relation word

_2026-09-04T14:42Z_

Constructor-mode review of 8f44e927 found the `apply-ledger-occupied` message template hardcoded the article `a` before the relation word (`ledger-identity.ts:188`), producing ungrammatical output for every vowel-initial word 2.1 and 2.2 introduced -- measured across all four commands: "a index", "a unlogged table", "a unlogged partitioned table", "a unlogged sequence", "a unlogged index". The `Next:` line's own `that ${relation}` carries no article and was already correct.

Fixed with `article(word)`: `"an"` when the word's first letter (lowercased) is a vowel, `"a"` otherwise -- exact for the closed set of relation words this module produces. The template now reads `is held by ${article(identity.relation)} ${identity.relation}`.

Unit tests: `"is held by an index"`, `"is held by an unlogged table"`, and a consonant control `"is held by a partitioned index"`.

Commit: c0c2b124.

