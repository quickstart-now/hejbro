# Evaluation — harden-ledger-identity

Context-free adversarial spec review (D106). Inputs: `openspec show
harden-ledger-identity --diff`, the built CLI (`packages/cli/dist/cli.js`
after `pnpm build --force`), `src/apply/ledger-identity.ts`,
`src/apply/reset.ts`, `src/apply/ledger.ts`, and
`skills/hejbro/references/generate-verify-workflow.md`. No proposal,
design, tasks, PR body, issue or `.blackbox/` was read.

## Round 1

### Verdict

**BLOCKING 0 / NON-BLOCKING 3 / OK 6** (all six delta scenarios verified
against a real `postgres:17-alpine`, plus two pre-existing scenarios
re-run as regressions).

Gates, in the review worktree with `TURBO_FORCE=1`:

```
pnpm build --force   → Tasks: 7 successful, 7 total  (0 cached)
pnpm check           → Checked 738 files in 710ms. No fixes applied.
pnpm check-types     → Tasks: 18 successful, 18 total (0 cached)
pnpm test            → Tasks: 18 successful, 18 total (2m41.9s) + test:types 2/2
                       @hejbro/core 1629 passed | 1 todo, hejbro 986 passed,
                       @hejbro/query 910, @hejbro/supabase 141, @hejbro/nile 60,
                       @hejbro/neon 39, @hejbro/pg 28, @hejbro/skills 24,
                       example-supabase 11, cli-smoke 5+1, example-postgres 4,
                       preset-smoke 2, hejbro:test:types 3 — 0 failed
pnpm check:bans      → ok — no `let`/`var`/loop statements … in 236 package source files
openspec validate harden-ledger-identity --strict
                     → Change 'harden-ledger-identity' is valid
```

### Blocking

None. Every delta scenario's stated behavior was reproduced exactly.

### Non-blocking

#### NB1 — "an ordinary, logged table" admits a leaf partition and an inheritance child, and the harm the change closes survives for those shapes

`packages/cli/src/apply/ledger-identity.ts:100-108` (`isLedgerShape`)
accepts any `relkind = 'r'`, `relpersistence = 'p'` relation carrying the
four bootstrap column names at their bootstrap types. It never reads
`relispartition`, and inheritance is invisible to it. So a table hejbro
did not create — a leaf **partition** of someone else's partitioned
table, or an **inheritance child** of someone else's base table — is
judged `{ kind: "ledger" }` and then read, written and cleared as one.

The delta's own input table (`specs/migration-apply/spec.md`, MODIFIED
"Migrations are applied in chain order…", scenario "The ledger is told
from another relation at its name") lists "a partitioned table" among the
relations to refuse but never names a *partition* or an inheritance
child, and the requirement prose at that requirement's identity paragraph
says "an ordinary, logged table" without saying what "ordinary" excludes.
Read literally, shipped behavior *matches* the scenario (both shapes are
ordinary logged tables carrying the four columns), which is why this is
non-blocking rather than blocking — but a reader of "ordinary" will
assume these are excluded, and the whole point of the requirement is that
hejbro "reads, writes and clears only the ledger it created".

Reproduction (inheritance child; end to end, `postgres:17-alpine`):

```sql
create schema other;
create sequence other.base_id_seq;
create table other.base (
  id bigint not null default nextval('other.base_id_seq'),
  filename text, origin text, applied_at timestamptz default now());
create schema hejbro;
create table hejbro.migration_ledger () inherits (other.base);
insert into other.base (filename, origin) values ('a-row-of-the-owners','x');
```

```
$ hejbro migrate --url postgres://postgres@127.0.0.1:32866/d106_inh3
migrate: applied 1 migration(s):
 - 0001_add_app.sql

$ psql -c "select id, filename, origin from hejbro.migration_ledger"
 id |     filename     | origin
----+------------------+---------
  2 | 0001_add_app.sql | applied      <- hejbro wrote into a table it never created

$ psql -c "insert into hejbro.migration_ledger (filename, origin)
           values ('someone-elses-bookkeeping','x')"
$ hejbro reset --url … --confirm-drop d106_inh3:2
reset: dropped every object your declarations manage, and cleared the ledger.

$ psql -c "select count(*) from hejbro.migration_ledger"   -- 0
$ psql -c "select id, filename from other.base"            -- only the parent's own row survives
```

The stranger's row is gone under a success line — the same shape of harm
the identity rule exists to prevent. The partition variant is judged the
ledger too:

```sql
create schema other;
create table other.ledger_parent (id bigint, filename text, origin text,
  applied_at timestamptz) partition by range (id);
create schema hejbro;
create table hejbro.migration_ledger partition of other.ledger_parent
  for values from (1) to (100000);
insert into hejbro.migration_ledger values (1,'not-hejbro','applied',now());
```

```
$ hejbro status --url …
error[apply-ledger-orphan-row]: not-hejbro
  the ledger records "not-hejbro" as applied, but no migration of that name exists on disk. …
```

— i.e. the partition was read *as the ledger* (`apply-ledger-orphan-row`
is a ledger-content diagnostic), not refused as an occupied name.

Either the scenario's input table should name a partition and an
inheritance child among the relations judged not-the-ledger and
`isLedgerShape` should test `relispartition = false` / `relhassubclass`
inheritance, or the requirement should say plainly that "ordinary" means
"relkind `r`, logged" and nothing more.

#### NB2 — the relation-word fallback prints the one-letter code the requirement forbids absolutely

`packages/cli/src/apply/ledger-identity.ts:54` renders
`` `relation (${relkind})` `` when `RELATION_WORDS` has no entry. The
requirement says the refusal names the kind "in words — every relation
kind the catalog can hold at that name has its own — **never the
catalog's own one-letter code**". The map covers all ten relkinds
PostgreSQL 15–17 define (`r p v m f c i I t S`), so the fallback is
unreachable on every Postgres hejbro supports (D109's PG15 floor) — which
is why this is non-blocking — but the requirement's "never" is absolute
while the code keeps an escape hatch that would violate it verbatim on a
future relkind. Either the sentence should be conditioned ("for every
relation kind Postgres defines today"), or the fallback should read a
kind-free word.

All ten mapped words were exercised (see Verified scenarios); the
fallback branch could not be reached from SQL and is a code-read finding.

#### NB3 — `status`'s "no raw database error" promise reads wider than it is

The MODIFIED "What the ledger holds can be read without applying
anything" requirement ends: "No error the database raised on that object
SHALL reach the user raw: the finding is what sits at the name, not the
failure of a read hejbro should never have attempted." Scoped to the
occupied case it holds exactly (verified below). But the *real* ledger
under a role that cannot read it still dumps a raw node-postgres error
object and a stack trace, which a reader of that sentence would not
expect:

```
$ psql -U postgres -c "create role lowly login"
$ hejbro status --url postgres://lowly@127.0.0.1:32866/d106_priv_ledger
error: permission denied for schema hejbro
    at …/pg/lib/client.js:694:17
    at async readLedger (…/packages/cli/dist/cli.js:6389:14)
    … { severity: 'ERROR', code: '42501', … }
[exit=1]
```

`packages/cli/src/commands/status.ts:210` — `readLedger` runs
unguarded once the probe says `ledger`. Not a contradiction of the
delta (the sentence is about "that object", the non-ledger relation), but
the scope is worth pinning in the requirement so a later reader does not
take it as a general "status never crashes raw" guarantee.

#### Observed outside this change's delta (for triage, not an archive gate)

`raise --file` joins an absolute path onto the project cwd:
`--file /private/tmp/d106-li-snap.sql` opened
`/private/tmp/d106-li-proj/private/tmp/d106-li-snap.sql` and threw a raw
`ENOENT` with a Node stack (`…/dist/cli.js:9211`, `runRaise`), not a coded
diagnostic. Nothing in this change's delta covers `--file` path handling;
recorded only so it is not lost.

### Verified scenarios

Every row below was run against a live `postgres:17-alpine` container
(`d106-li-pg`), one fresh database per case, with a real hejbro project
(`schema("app")` + `table(app,"widget",…)`, one generated migration
`0001_add_app.sql`) driven by the built `dist/cli.js` and `--url`.

1. **"The ledger is told from another relation at its name"** (MODIFIED
   "Migrations are applied in chain order, and what was applied is
   recorded") — **OK**, with NB1/NB2 above. Input table, one database
   each, judged through `status`:

   | relation at `"hejbro"."migration_ledger"` | verdict | refusal text (kind + columns clause) |
   |---|---|---|
   | bootstrapped ledger | ledger | — (reports applied/pending normally) |
   | ledger + extra `note text` column | ledger | — |
   | four columns declared in reverse order (`applied_at, origin, filename, id`) | ledger | — |
   | table `(id bigint, filename text, origin text)` | occupied | `a table … (columns: id, filename, origin)` |
   | table with `id integer` | occupied | `a table … (columns: id, filename, origin, applied_at)` |
   | table with `origin varchar(20)` | occupied | `a table … (columns: id, filename, origin, applied_at)` |
   | zero-column table | occupied | `a table … (no columns)` |
   | view with the four column names | occupied | `a view … (columns: id, filename, origin, applied_at)` |
   | materialized view | occupied | `a materialized view … (columns: …)` |
   | foreign table (`file_fdw`) | occupied | `a foreign table … (columns: …)` |
   | sequence | occupied | `a sequence …` — **no column clause** |
   | partitioned table with the four columns | occupied | `a partitioned table … (columns: …)` |
   | unlogged table with the four columns | occupied | `an unlogged table … (columns: …)` |
   | composite type | occupied | `a composite type … (columns: id, filename)` |
   | index (`create index migration_ledger on hejbro.holder(a)`) | occupied | `an index …` — **no column clause** |
   | partitioned index | occupied | `a partitioned index …` — **no column clause** |
   | no relation at all | absent | `no ledger table exists yet …`, exit 0 |
   | leaf partition of `other.ledger_parent`, four columns | **ledger** | NB1 |
   | inheritance child of `other.base`, four columns | **ledger** | NB1 |

   That is every relkind PostgreSQL 17 can hold at a schema-qualified
   name (`r p v m f c i I S`; `t`, TOAST, only ever lives in `pg_toast`),
   each named in words, never a one-letter code.

   **Neighbours** (real ledger bootstrapped, plus a decoy) — all four
   reported normally, exit 0, decoy untouched: `public.migration_ledger`
   (table); `"HEJBRO"."migration_ledger"`; `hejbro."Migration_Ledger"`
   and `hejbro."MIGRATION_LEDGER"` (quoted mixed case).

   **One judgement, shared** — with `log_statement='all'` on the server,
   a run of each of `migrate`, `reset`, `status`, `raise` against a
   database whose ledger name held a view logged exactly this and nothing
   else, per command:

   ```
   > set intervalstyle to 'postgres'; set bytea_output to 'hex'
   > select 1
   > select c.relkind as "relkind", c.relpersistence as "persistence",
     a.attname as "name", format_type(a.atttypid, a.atttypmod) as "type"
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     left join pg_attribute a on … where n.nspname='hejbro' and c.relname='migration_ledger' …
   ```

   No `BEGIN`, no DDL, no `select current_database()`, no ledger read —
   the judgement is one catalog read outside any transaction, identical
   across the four commands, and none of the four touched the relation.

   **No privilege beyond the catalog** — the same refusal came back for a
   bare `create role lowly login` with no grant on schema `hejbro`:
   `"hejbro"."migration_ledger" is held by a view … (columns: id)`,
   exit 1.

   **Enumeration is complete** — `grep` over `packages/cli/src` finds
   `readLedger`/`bootstrapLedger`/`clearLedgerRows`/`recordAppliedMigration`
   reached only from `commands/migrate.ts`, `commands/status.ts`,
   `apply/reset.ts`, `apply/raise.ts` (and `apply/execute.ts`, reached
   only from migrate/raise after their probe). No fifth ledger toucher.

2. **"migrate refuses a relation that is not the ledger before
   bootstrapping"** — **OK**. Table carrying the ledger's four column
   names with `applied_at text`, one row; and separately a view:

   ```
   $ hejbro migrate --url …
   error[apply-ledger-occupied]: hejbro migrate
     "hejbro"."migration_ledger" is held by a table that is not hejbro's ledger
     (columns: id, filename, origin, applied_at). … Next: move or drop that table
     yourself (hejbro will not touch it), or point --url at the database hejbro
     manages, then rerun `hejbro migrate`.
   [exit=2]
   $ psql -c "select nspname from pg_namespace where nspname in ('app','hejbro')"
    hejbro        <- `app` was never created: no migration statement was sent
   $ psql -c "select * from hejbro.migration_ledger"
    1 | x | applied | y      <- row intact
   ```

   Exit code is exactly two, per the requirement.

3. **"status refuses a relation that is not the ledger at the ledger's
   name"** — **OK**. Every occupied row of the input table above exits 1
   with `apply-ledger-occupied`, the kind in words, the columns where the
   kind carries them, a `Next:` line, and no raw database error and no
   stack trace.

4. **"A reset refuses when the ledger's name is held by something else"**
   — **OK**. Database holding both declared objects (`app.widget`,
   `app`), the real ledger dropped and replaced:

   | setup | invocation | result |
   |---|---|---|
   | table `(x int, note text)`, 2 rows | `reset` (no confirmation) | `apply-ledger-occupied`, `a table … (columns: x, note)`, exit 1 |
   | table `(x int, note text)`, 1 row | `reset --confirm-drop <db>:2` | same refusal, exit 1 |
   | view | `reset --confirm-drop <db>:2` | `a view … (columns: x)`, exit 1 |

   After each: `to_regclass('app.widget')` still `app.widget`, the object
   at the ledger's name still there, every row still there. No
   `reset-not-confirmed` was ever raised, and the server log shows no
   `select current_database()` — the confirmation token is never asked
   for. Control: the same database with the *real* ledger and no
   confirmation gives `reset-not-confirmed` ("rerun with --confirm-drop
   d106_rst_control:2"), so the ordering change is what suppresses it.
   Ordering against the empty-declaration precondition also matches the
   requirement's "Next, …": a config resolving to 0 declared objects plus
   a view at the ledger's name refuses with `reset-declarations-empty`,
   not `apply-ledger-occupied`.

5. **"The cycle advice covers a cycle of any length"** — **OK**. Genuine
   FK cycles built through the public DSL (an unexported
   `existingTable(...)` handle closes the ring), migrated into Postgres,
   then `reset --confirm-drop <db>:<n>`:

   | declared set | server error | `Next:` advice |
   |---|---|---|
   | 2-cycle `t_a→t_b→t_a` | `2BP01 … constraint t_b_a_id_fk on table app.t_b depends on table app.t_a` | cycle clause **and** outside-declarations clause |
   | 3-cycle `t_a→t_b→t_c→t_a` | `2BP01 … constraint t_c_next_id_fk …` | same |
   | 4-cycle `t_a→t_b→t_c→t_d→t_a` | `2BP01 … constraint t_d_next_id_fk …` | same |
   | two independent cycles (2-ring `t_a,t_b` + 3-ring `t_x,t_y,t_z`) | `2BP01 …` | same |
   | self-reference only (`t_a.parent_id → t_a.id`) + `t_z` | — | **reset succeeds**, exit 0 — a self-reference is not a cycle |
   | acyclic chain `t_a→t_b→t_c` | — | **reset succeeds**, exit 0 |
   | no cycle, an outside `public.outsider` view on `app.widget` | `2BP01 … view outsider depends on table app.widget` | outside-declarations clause **only** — no cycle sentence |
   | 3-cycle **and** an outside view on `app.t_b` | `2BP01 …` | both clauses, cycle stated beside — never instead of — the outside possibility |

   Exact text for the three-table case:

   ```
   error[reset-drop-failed]: hejbro reset
     hejbro reset failed to drop your declared objects (2BP01): cannot drop table
     app.t_a because other objects depend on it (constraint t_c_next_id_fk on table
     app.t_c depends on table app.t_a). The transaction was rolled back — nothing was
     dropped and the ledger is unchanged. Next: run `hejbro status` to confirm,
     resolve what the error above describes (the detail above names the actual
     dependent; a set of your declared tables that reference each other in a cycle,
     which no order satisfies, so they were left in identity order rather than refused
     outright, and an object outside your declarations may also still depend on one
     you're dropping), then rerun `hejbro reset`.
   ```

   Byte-identical to the two-table case's advice, as the scenario
   requires ("exactly as it does for two tables"). The code
   (`reset-drop-failed`) and the detail-first ordering are unchanged.

6. **"raise refuses a relation that is not the ledger before anything
   runs"** — **OK**. Snapshot file creating `raised_app.thing`:

   | setup | result |
   |---|---|
   | view at the ledger's name | `apply-ledger-occupied`, `a view … (columns: id, filename)`, exit 1; `to_regclass('raised_app.thing')` null; relations in schema `hejbro` = 1 (only the view — no bootstrap) |
   | table `(id bigint, filename text, origin text, applied_at date)`, 1 row | same code, `a table … (columns: …)`, exit 1; `raised_app.thing` null; the row unchanged |
   | sequence at the ledger's name | same code, `a sequence …` with no column clause, exit 1 |
   | empty database (control) | `raise: applied "snap.sql" to an empty database, and recorded it in the ledger.`, exit 0 |

**Pre-existing scenarios re-run as regressions** (both still hold under
the new probe): "the ledger table does not exist" vs "exists with no
rows" are reported as different states (`no ledger table exists yet --
this database has never been touched by hejbro.` vs `the ledger table
exists and records no migrations yet.`); and a reset over a database
whose objects were applied outside hejbro reports `reset: dropped every
object your declarations manage. There was no hejbro ledger to clear.`,
exit 0, matching `skills/hejbro/references/generate-verify-workflow.md`
lines 190-194 verbatim.

**Skill reference** — the reset section of
`skills/hejbro/references/generate-verify-workflow.md` (lines 149-194)
states the identity rule, its four commands, the before-confirmation
ordering, "None of the four commands reads, writes or clears that
object", and the any-length cycle sentence. Every claim in it was
reproduced above. Its "ordinary, logged table" phrasing inherits NB1.

### Method

- **Container**: `docker run -d --name d106-li-pg -e
  POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1::5432 postgres:17-alpine`
  → `PostgreSQL 17.11 on x86_64-pc-linux-musl`, mapped to
  `127.0.0.1:32866`. Removed at the end of the review.
- **Projects** (scratch, under `/private/tmp/d106-li-*`, all removed):
  `d106-li-proj` (baseline: `schema("app")` + `table(app,"widget",{id
  uuid pk, label text not null})`, `hejbro init` + `hejbro generate` →
  `0001_add_app.sql`, plus `snap.sql` for `raise`); `d106-li-cyc2/3/4`
  (FK rings of 2/3/4 closed through an unexported `existingTable`
  handle); `d106-li-two` (two independent rings); `d106-li-self`
  (self-reference); `d106-li-chain` (acyclic control); `d106-li-empty`
  (0 declared objects). Each linked `hejbro`, `@hejbro/core`,
  `@hejbro/query`, `@hejbro/pg` and `pg` from the review worktree's
  `node_modules`, and was driven by
  `node <worktree>/packages/cli/dist/cli.js <cmd> --url …` after
  `pnpm build --force`.
- **Per case**: one fresh database (`create database d106_<case>`),
  optional `hejbro migrate` to bootstrap a genuine ledger, then the setup
  SQL through `psql -v ON_ERROR_STOP=1`, then the command, capturing
  stdout+stderr and the exit code, then a `psql` read-back of the
  declared objects and of the relation at the ledger's name.
- **Statement-level observation**: `alter system set log_statement='all'`
  + `pg_reload_conf()`, marker statements around each command, then
  `docker logs d106-li-pg | grep 'statement:'` sliced between markers —
  this is the evidence for "no statement is sent", "no bootstrap runs",
  "never asks for a confirmation token", and "one catalog read, no
  transaction".
- **Privilege**: `create role lowly login` with no grants; the probe's
  refusal came back unchanged, proving it needs nothing beyond catalog
  read.
- **Not read**: `proposal.md`, `design.md`, `tasks.md`, the PR body,
  issue bodies, `.blackbox/`. Shipped tests were read only as public
  surface (`packages/cli/test/apply-reset.test.ts`, to learn that a
  mutual FK cycle cannot be built through `table()`'s eager `extras`
  callback — which is why the cycle inputs above go through
  `existingTable`).

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; ruling in `.blackbox/783/`).

- **NB1** — fixed here (tasks.md group 3): a leaf partition and an inheritance child at the ledger's name are refused as `apply-ledger-occupied`, named "leaf partition" / "inheritance child" (with the unlogged prefix where it applies). The identity rule now says what "ordinary" meant: a logged table hejbro could have created — neither a partition nor an inheritance child. The harm the reviewer demonstrated (a row written into, and later deleted from, a stranger's table) is closed for those shapes.
- **NB2** — fixed here: the fallback for a relation kind this version does not map reads "relation of a kind this version does not name" — no catalog letter anywhere, as the requirement's "never" demands.
- **NB3** — tracked as #836 (a permission error on a real ledger reaches `status` raw; outside this delta's sentence).
- **Out-of-delta note** (`raise --file` with an absolute path) — tracked as #837.

Archived at this disposition.

