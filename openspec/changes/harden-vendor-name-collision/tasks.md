# Tasks: harden-vendor-name-collision

One group, lead-direct (1004/R1; 412/R32 precedent), sequential.
Estimates are pure work minutes (D88). Every task is test-first: the
named test goes red first with inputs as wide as the scenario's
sentence (a table, not one example — D110), then the minimal green,
then refactor. Every source rule of this repository applies
(`any`/`let`/`var`/`for`/`while`/ternary banned; comments state the
constraint only). Commit condition: `TURBO_FORCE=1 pnpm check` first,
then `check-types`, `test`, `check:crap`, serially; report exit codes
and the SHA.

**Files edited**: `packages/cli/src/contract/name-collision.ts` (new),
`packages/cli/src/contract/emit.ts`, `packages/cli/test/
contract-name-collision.test.ts` (new), `packages/cli/test/
vendor.test.ts`, `skills/hejbro/references/polyrepo.md`, one
`.changeset/*.md`, `openspec/task-times.csv`. If a task appears to need
any other file, that is a stop, not a diff.

**Ordering.** 1.1 → 1.2 → 1.3.

## 1. Refuse the collision at emission

- [x] 1.1 (~10m) **[design]** The guard and both messages (codes and
      remedies settled by 1004/R1). Red:
      `packages/cli/test/contract-name-collision.test.ts`, an input
      table {managed `a.widgets` + managed `b.widgets`; existing
      `auth.users` + managed `app.users`; `users` in three schemas;
      `users` in three schemas beside `widgets` in two (one message,
      both names, identity order, every qualified table); a unique-name layout with
      an existing table beside managed tables (emits every key — the
      guard is a pure predicate that either throws or does nothing, so
      the emitted text is the current emitter's by construction)} ×
      {origin `git`, origin `database`}. The DSL refuses a mixed-case
      table name, so a pair differing only in case is unreachable from
      declarations and is not a row: the thrown `HejbroError`'s `code` is
      `vendor-table-name-collision` for `git` and
      `pull-table-name-collision` for `database`; the message contains
      each SQL name and each `"schema"."table"` in identity order, and
      the `Next:` sentence for the command (vendor: filter reserved,
      one table per SQL name in the export; pull: drop a schema from
      `--schema`). Green: `assertUniqueTableNames(tables, origin)` in
      `name-collision.ts`, called from `emitContract` after
      `computeTables` and before any rendering. Mutation: grouping by
      schema-qualified name instead of SQL name turns every colliding
      row green; listing groups in first-seen order reddens the
      identity-order rows.
      Files: `name-collision.ts`, `emit.ts`, the new test.

- [x] 1.2 (~8m) The CLI surface. Red: `packages/cli/test/vendor.test.ts`
      — a linked export whose `schema.json` carries `auth.users`
      (existing) beside `app.users` (managed, one snapshot with both
      tables): `hejbro vendor` exits 1, stderr contains
      `vendor-table-name-collision`, `auth.users` and `app.users`, and
      afterwards `.hejbro/vendor/` does not exist and `hejbro.lock` is
      absent (the write order is emit-then-write; the assertion pins
      it). `pull`'s code is covered by 1.1's `database` column and its
      write order is the same code path; no live-database case is
      added. Files: `vendor.test.ts` (fixture JSON built from the
      existing `EXPORT_SCHEMA_V1` shape with two table facts and a
      two-table snapshot).

- [x] 1.3 (~5m) Reference, changeset, ledger. `polyrepo.md`'s "Two
      different keying rules" paragraph states that two carried tables
      of one SQL name are refused at emission, the two codes, and the
      way out per command; `pnpm changeset` → `patch` (`hejbro`); one
      row per task in `openspec/task-times.csv`; README badges
      (`pnpm check:tasktime`, `pnpm check:crap`). Files: the reference,
      `.changeset/*.md`, `task-times.csv`, `README.md`.
