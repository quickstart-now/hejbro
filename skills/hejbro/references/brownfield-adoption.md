# Brownfield adoption

Read this when bringing hejbro into a repository whose database already
exists and already has data — deciding what to declare, running the
first `generate`, checking a declaration against the real schema, or
deciding what to leave out of hejbro's management.

## What hejbro does and doesn't know about the live database

hejbro never reads a live database. `hejbro generate` diffs your
declarations against the checked-in snapshot file only
(`packages/core/src/engine/generate.ts`); `hejbro verify` "re-derives the
whole chain from checked-out files only — no live database"
(`docs/guide/getting-started.md`), running its five checks against
`packages/cli/src/commands/verify.ts`'s own files-only inputs. Applying a
migration to a database is out of scope for hejbro itself (D12,
`docs/specs/2026-08-19-hejbro-design.md`) — an external pipeline does
that. Adopting hejbro into an existing database therefore starts from the
same declared-truth model as a greenfield project; there is no step
where hejbro inspects your database for you.

## Adoption procedure

1. Write `table()` declarations that match the live schema's tables
   column-for-column, in the tables' actual physical column order (the
   cheatsheet's column-order rule applies here too — hejbro's snapshot
   follows declaration order on a brand-new table).
2. Run `hejbro generate`. Because the checked-in snapshot starts empty,
   this first migration is a full `create table`/`create index`/… for
   every declared object — the same output `generate` would produce for
   a table that didn't exist yet.
3. That first migration is a **baseline record of what's now declared**,
   not something to run against the already-populated database — running
   `create table` against a table that already exists fails (`relation
   "..." already exists`). Whatever apply pipeline the project already
   uses needs its own way to record that this migration is already
   reflected in the live database, without executing it. hejbro doesn't
   provide or prescribe that mechanism; it isn't part of D12's scope.
4. From that point on, every further `hejbro generate` behaves exactly as
   it does in a greenfield project.

## Checking a declaration against the real schema

hejbro has no introspection, so nothing above confirms the declarations
actually match the live schema — that check is a separate step, and it's
a general technique rather than a hejbro feature: apply the generated
migration to a scratch database (empty, disposable), take a schema dump
of it, and compare that dump against a schema dump of the real database.
A mismatch in the diff is exactly the gap between what was declared and
what's actually there. This repository's own example packages use this
same technique for their own verification, wired up as each example's
`roundtrip` script — the technique, not that specific command, is what
carries over to a real project's own tooling.

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
live database has drifted from what's declared (a manual schema change
made directly against the database, for instance, is invisible to
`verify`). A dedicated brownfield adoption path — baseline registration
or introspection-assisted seeding — is tracked as #385.

## Where this is enforced

- Specs: `docs/specs/2026-08-19-hejbro-design.md` (D12, D41),
  `docs/guide/getting-started.md` (`verify`'s files-only re-derivation).
- Code: `packages/core/src/engine/generate.ts` (diff is
  snapshot-only, no live connection), `packages/cli/src/commands/verify.ts`
  (the five file-only checks), `packages/core/src/dsl/existing-table.ts`
  (`existingTable`, `existing-table-declared`).
- Gates: every path cited above is checked by
  `packages/skills/test/links.test.ts`; the `ts` block on this page is
  type-checked against this repo's real source by
  `packages/skills/test/snippet-compile.test.ts`.
