# Brownfield adoption

Read this when bringing hejbro into a repository whose database already
exists and already has data — deciding what to declare, running the
first `generate`, checking a declaration against the real schema, or
deciding what to leave out of hejbro's management.

## What hejbro does and doesn't know about the live database

`hejbro generate` diffs your declarations against the checked-in
snapshot file only (`packages/core/src/engine/generate.ts`); `hejbro
verify` "re-derives the whole chain from checked-out files only — no
live database" (`docs/guide/getting-started.md`), running its five
checks against `packages/cli/src/commands/verify.ts`'s own files-only
inputs. Applying migrations to a database is hejbro's own command
surface (D12, amended — `docs/specs/2026-08-19-hejbro-design.md`):
`hejbro migrate` applies pending migrations, `hejbro status` reports
what the ledger records, `hejbro reset` destroys only what the
declarations manage, and `hejbro raise` stands an empty database up
from a snapshot SQL file — see `generate-verify-workflow.md` for
`migrate`'s own transactional guarantee. `hejbro check`
(`packages/cli/src/commands/check.ts`) is the one command among these
that only reads — no transaction, no migration ever applied — comparing
your declarations against its catalog object by object; see "Checking a
declaration against the real schema" below. Adopting hejbro into an
existing database therefore starts from the same declared-truth model as
a greenfield project; there is no step where `generate`/`verify` inspect
your database for you, and `baseline` doesn't either — it only writes a
file, the same way `generate` does.

## Adoption procedure

1. Write `table()` declarations that match the live schema's tables
   column-for-column, in the tables' actual physical column order (the
   cheatsheet's column-order rule applies here too — hejbro's snapshot
   follows declaration order on a brand-new table).
2. Run **`hejbro baseline`** (not `generate`). Because the checked-in
   snapshot starts empty, this first migration is a full `create
   table`/`create index`/… for every declared object — the same SQL
   `generate` would produce for objects that didn't exist yet — and
   `baseline` marks it in its own banner:

   ```
   -- baseline: these objects already exist — register this migration as applied, do not run it
   ```

3. **Run `hejbro migrate` against the live database.** It reads the same
   `-- baseline:` marker step 2 wrote and registers that file in the
   ledger *without sending its statements* — the objects it would create
   already exist, so nothing is run, and the report says so explicitly
   ("registered 1 baseline migration(s) (statements not executed)"),
   never "applied". Any apply tool you used *before* this existed
   (`supabase db push`, a raw `psql -f migration.sql`, a hand-written
   `insert` into your own tracking table, …) worked the same way in
   spirit — running the file against the already-populated database
   fails on the first statement (`relation "..." already exists`), which
   is exactly the confusing way not to learn a file was never meant to
   be run. `hejbro migrate` is now the one way to register it correctly
   without meeting that failure at all.
4. From that point on, every further `hejbro generate` behaves exactly as
   it does in a greenfield project, emitting only what changed.
   `hejbro baseline` refuses to run a second time
   (`error[baseline-not-first]`) — a baseline is by definition the first
   migration of an adopted database.

## Checking a declaration against the real schema

Nothing in the adoption procedure above confirms the declarations
actually match the live schema — `hejbro check` is that step, comparing
your declarations against the real database's catalog, object by
object, without ever writing to it:

```
hejbro check --url postgres://...
# or: DATABASE_URL=postgres://... hejbro check
```

It needs the `@hejbro/pg` package installed (`pnpm add -D @hejbro/pg`).
`hejbro` itself declares it as no dependency kind at all — not a
runtime dependency, not a peer, optional or otherwise — so installing
`hejbro` never pulls in a Postgres client for the commands that never
connect, and the package manager is never asked to reason about a
package only `check` uses.

The exit code answers three separate questions, not one:

| Exit | Meaning |
|------|---------|
| `0`  | every declared object was compared and agreed |
| `1`  | at least one declared object is missing or differs from the database |
| `2`  | the run could not answer — something could not be compared (e.g. a role without EXPLAIN privilege on a table it owns no policy on), or the declaration set was empty |

`2` is never a pass and is never folded into `0` or `1`: a CI pipeline
running `check` under a limited role should treat `1` (real drift) and
`2` ("ask for more privilege, then rerun") as different answers, not one
red build indistinguishable from the other.

`check` does not compare everything. View bodies are never compared
(only that a declared view exists). Primary keys, unique constraints,
foreign keys, and indexes are checked for existence only, not their
exact shape; check constraints get both — existence, and their
expression, matched by running the declared and the catalog's own
rendering through the server in the same statement (Postgres often
rewrites an expression on write, so comparing rendered text directly
would false-positive). The report states this coverage boundary on
every run, pass or fail. It also prints an **inventory** section —
tables inside your declared schemas that no declaration covers, and the
database's installed extensions — informational only, never a `check`
finding and never affecting the exit code.

hejbro does not manage a table for one of two reasons — no declaration
covers it at all (`check`'s own inventory, above), or a declaration
covers it with `existingTable()` (never in the inventory) — and the two
are never the same table twice: the section below is the second one.

Before `check` existed, the general technique was to apply the generated
migration to a scratch database (empty, disposable), take a schema dump
of it, and compare that dump against a schema dump of the real database
by hand. This repository's own example packages still use that technique
internally, wired up as each example's `roundtrip` script — but that
answers a different question ("does `generate` always reproduce the same
schema", a generator-fidelity check this repository runs on itself), not
"does this declaration match that database", which is what `check`
exists to answer for your own project.

## Deciding what to manage

`existingTable(schemaName, tableName, columns)` (D41, amended by
add-unmanaged-objects #605, `packages/core/src/dsl/existing-table.ts`)
declares a table for its shape, never for its DDL: it can be an FK
target, used in `exists()`, and joined against — and, since #605, it is
also a real top-level declaration in its own right. Exported from a
schema file the same way a `table()` is, it reaches the snapshot (marked
`existing: true`), the export description, and a vendored contract's
`Tables` entry, exactly like a managed table's shape does — but
`generateMigration` diffs nothing for it and emits no statement, ever,
ready to adopt or not. It exists for tables that stay permanently
outside hejbro's management (Supabase's `authUsers` is the shipped
example) — it is not a staging step toward later full management of
that table. The adoption choice per table is binary and made once:
declare it with `table()` (hejbro now owns its DDL going forward) or
declare it with `existingTable()` (hejbro never touches its DDL, only
reads its shape for typing/FK/export purposes) — the difference from
before #605 is that the second choice no longer has to stay a bare,
unexported reference to be usable this way.

```ts
import { existingTable, text, uuid } from "hejbro";

// Permanently unmanaged — declared for its shape, never diffed or emitted.
export const legacyCustomers = existingTable("public", "legacy_customers", {
	id: uuid().primaryKey(),
	email: text().notNull(),
});
```

## Limits after adoption

Once adopted, `hejbro verify`'s five checks still run entirely against
checked-out files — they confirm the migration history and snapshot stay
internally consistent with each other, and say nothing about whether the
live database has drifted from what's declared. A manual schema change
made directly against the database is invisible to `verify`, but not to
`hejbro check` — rerun it (a scheduled CI job, or before a release) to
catch that drift; it is the one command built to answer exactly that
question. `hejbro baseline` (above) writes the marker, and `hejbro
migrate` (step 3) does the actual registration — together they cover the
registration half of #385. The other half — introspection-assisted
seeding, where hejbro
reads a live schema or a dump and writes starter declarations for you —
does not exist: step 1 is still yours to write, and "Checking a
declaration against the real schema" above is still how you confirm you
got it right.

## Where this is enforced

- Specs: `docs/specs/2026-08-19-hejbro-design.md` (D12, D41),
  `docs/guide/getting-started.md` (`verify`'s files-only re-derivation).
- Code: `packages/core/src/engine/generate.ts` (diff is
  snapshot-only, no live connection), `packages/cli/src/commands/verify.ts`
  (the five file-only checks, and `readBaselineFileNames`, which reads
  the `-- baseline:` marker for `migrate`), `packages/core/src/dsl/existing-table.ts`
  (`existingTable`), `packages/cli/src/commands/check.ts`
  (the three-way exit code, the coverage-boundary statement, the
  inventory section), `packages/cli/src/check/catalog.ts` (the read-only
  catalog queries), `packages/cli/src/check/driver.ts` (`--url`/
  `DATABASE_URL` resolution, `@hejbro/pg` declared as no dependency
  kind at all), `packages/cli/src/apply/plan.ts` (`baselineFileNames`,
  the subset of pending migrations `migrate` registers rather than
  applies), `packages/cli/src/apply/execute.ts` (`applyMigration` skips
  sending a baseline file's SQL), `packages/cli/src/commands/migrate.ts`
  (the "registered ... (statements not executed)" report line).
- Where an `existingTable()` declaration itself is handled: the
  snapshot marker (`packages/core/src/kinds/table-snapshot.ts`'s
  `existing?: true`, read via `tableExisting`) and the DDL-blocking
  guard it feeds (`packages/core/src/kinds/table-kind.ts`'s
  `isExistingSide`, opening `tableKind.diff`) — the two together are
  why declaring one is never a hard error and never produces a
  migration, add-unmanaged-objects (#605).
- Gates: every path cited above is checked by
  `packages/skills/test/links.test.ts`; the `ts` block on this page is
  type-checked against this repo's real source by
  `packages/skills/test/snippet-compile.test.ts`.
