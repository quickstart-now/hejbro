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
inputs. Applying a migration to a database is out of scope for hejbro
itself (D12, `docs/specs/2026-08-19-hejbro-design.md`) — an external
pipeline does that. `hejbro check` (`packages/cli/src/commands/check.ts`)
is the one command that does read a live database — read-only, no
transaction, no migration ever applied — comparing your declarations
against its catalog object by object; see "Checking a declaration
against the real schema" below. Adopting hejbro into an existing
database therefore starts from the same declared-truth model as a
greenfield project; there is no step where `generate`/`verify`/
`baseline` inspect your database for you.

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

3. **Register that file as applied in your apply pipeline without running
   it.** Running it against the already-populated database fails on the
   first statement (`relation "..." already exists`), and "already
   exists" is a confusing way to learn the file was never meant to be
   run — which is why the marker and the command's own report say so
   before you get there. hejbro does not apply migrations (D12), so
   recording "applied" is your pipeline's mechanism, whatever it is.
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

`existingTable(schemaName, tableName, columns)` (D41,
`packages/core/src/dsl/existing-table.ts`) is a reference-only table: it
can be an FK target, used in `exists()`, and joined against, but it is
never passed to `generateMigration`, never diffed, and never emitted —
passing one as a declaration is the hard error `existing-table-declared`.
It exists for tables that stay permanently outside hejbro's management
(Supabase's `authUsers` is the shipped example) — it is not a staging
step toward later full management of that table. The adoption choice per
table is binary and made once: declare it with `table()` (hejbro now
owns its DDL going forward) or reference it with `existingTable()`
(hejbro never touches it, only reads its shape for typing/FK purposes).

```ts
import { existingTable, text, uuid } from "hejbro";

// Permanently unmanaged — never passed to generateMigration, never diffed.
const legacyCustomers = existingTable("public", "legacy_customers", {
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
question. `hejbro baseline` (above) covers the registration half of
#385. The other half — introspection-assisted seeding, where hejbro
reads a live schema or a dump and writes starter declarations for you —
does not exist: step 1 is still yours to write, and "Checking a
declaration against the real schema" above is still how you confirm you
got it right.

## Where this is enforced

- Specs: `docs/specs/2026-08-19-hejbro-design.md` (D12, D41),
  `docs/guide/getting-started.md` (`verify`'s files-only re-derivation).
- Code: `packages/core/src/engine/generate.ts` (diff is
  snapshot-only, no live connection), `packages/cli/src/commands/verify.ts`
  (the five file-only checks), `packages/core/src/dsl/existing-table.ts`
  (`existingTable`, `existing-table-declared`), `packages/cli/src/commands/check.ts`
  (the three-way exit code, the coverage-boundary statement, the
  inventory section), `packages/cli/src/check/catalog.ts` (the read-only
  catalog queries), `packages/cli/src/check/driver.ts` (`--url`/
  `DATABASE_URL` resolution, `@hejbro/pg` declared as no dependency
  kind at all).
- Gates: every path cited above is checked by
  `packages/skills/test/links.test.ts`; the `ts` block on this page is
  type-checked against this repo's real source by
  `packages/skills/test/snippet-compile.test.ts`.
