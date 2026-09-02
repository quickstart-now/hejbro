---
name: hejbro
description: Use when declaring or changing a Postgres schema with hejbro — tables, RLS, functions/triggers, grants, views — when generating/verifying migrations, when a function body needs control flow (real JS if/for is forbidden inside bodies; use ctx.if()/ctx.forEach()), when writing typed queries against a declared schema (db(), the select/insert/update/deleteFrom chain, db.fn), when running a query under an RLS execution context (db.as, asUser/asAnon) or registering a context provider so every execution applies one automatically, when asserting at startup that the connected database actually matches its declarations (assertSchema), when adopting hejbro into an existing (brownfield) database, or when a repository needs types for a schema it does not declare — deciding monorepo alias vs. link/vendor, running link/vendor/vendor --check/outdated, or writing code against a generated contract.ts.
version: 0.2.0
license: Apache-2.0
---

# hejbro

hejbro is two things built on one declaration: **declare → migration**
(tables, RLS, functions/triggers, grants, views compile to deterministic
SQL) and **declare → typed queries** (the same declarations drive a typed
`db()` handle — no generated types, no second schema to keep in sync).

1. Declare only — never hand-edit `migrations/*.sql` or `hejbro.snapshot.json`; regenerate with `hejbro generate`.
2. Inside `defineFunction`/`defineTrigger` bodies, never use real JS `if`/`for`/`while` — use `ctx.if()`/`ctx.forEach()`. The body callback runs twice at declaration time (a determinism guard); anything that isn't pure DSL recording throws `nondeterministic-body`. Run a statement for its side effect with `ctx.execute(...)`; a builder made inside a body and never passed to a consumer (`ctx.execute`, `ctx.return`, `ctx.row`/`ctx.rowOrNull`/`ctx.forEach`, …) fails the declaration with `statement-builder-unused`.
3. Read the migration's banner comment before merging — it lists every object added/changed/dropped, in order.
4. `hejbro generate` never guesses at renames: an ambiguous drop+add exits 1 with the exact `--rename`/`--confirm-drop` command to rerun.
5. Presets (e.g. `@hejbro/supabase`) go in `hejbro.config.ts`'s `presets` array — never register kinds by hand in application code.
6. A plain foreign key is declared on the column itself — `.references(() => users.id)`. CHECK constraints, partial/ordered indexes, and the foreign keys `.references()` cannot express (self-referencing, composite, `onDelete`/`onUpdate` actions) are declared inline on `table(...)`'s extras — see the cheatsheet, not the query builder.
7. `hejbro verify` re-derives the migration chain from checked-out files only (no live DB) — run it in CI. The local Docker round-trip (`pnpm roundtrip`) is the deeper, pre-merge check. `hejbro check` reads a live database, read-only (three-way exit code 0/1/2) — see `references/brownfield-adoption.md`. `hejbro import --schema <name> --out <dir>` also reads read-only, writing starter `table()` declarations for schemas you don't declare yet (introspection-assisted seeding — see `references/brownfield-adoption.md`). `hejbro migrate`/`status`/`reset`/`raise` also connect to a live database: `migrate` applies pending migrations in chain order, `status` reports what the ledger records without applying anything, `reset` destroys only what the declarations manage, and `raise` stands an empty database up from a vendored snapshot SQL file.
8. `db(schema, driver)` builds a typed handle straight from the same declarations — `select`/`insert`/`update`/`deleteFrom` chains stay inert until awaited, and `.compile()` never touches a driver.
9. `db.as(context)` runs statements under an explicit role/session context (RLS); a role outside the declared whitelist fails immediately, before anything reaches the database.
10. `db(schema, driver, { context })` registers a resolver instead: every execution surface applies the resolved context automatically. An explicit `db.as(context)` still always wins and never calls the resolver; a throwing resolver propagates unchanged rather than running uncontexted.
11. A repository that doesn't declare the schema it queries gets types from a committed, generated `contract.ts` (`link`/`vendor`), never from declarations directly — except inside the *same* workspace, where importing the declaring package (an alias) is correct and `link`/`vendor` would be an unnecessary detour. See `references/polyrepo.md`.
12. `table()` returns `DeclaredTable`, not the general `Table` type — an existing declaration explicitly annotated `: Table` that no longer satisfies something requiring a real declaration (e.g. `generateMigration`, imported from `@hejbro/core` — the `hejbro` barrel carries the declaration and query vocabulary only, never the engine) just needs that annotation removed or narrowed to `DeclaredTable`.

## References

| File | Read it when |
|---|---|
| `references/dsl-cheatsheet.md` | Writing or editing a schema declaration — tables, columns, CHECK, indexes, FKs, RLS, grants, views |
| `references/function-builder-pitfalls.md` | Writing a `defineFunction`/`defineTrigger` body, or debugging a `nondeterministic-body` error |
| `references/generate-verify-workflow.md` | Running `generate`/`verify`, reading the banner, resolving an ambiguous rename, reading a warning |
| `references/supabase-preset.md` | Using `@hejbro/supabase` — roles, auth helpers, storage buckets, preset warnings |
| `references/neon-preset.md` | Using `@hejbro/neon` — `neonDriver`, roles, auth helpers, the two authentication modes |
| `references/nile-preset.md` | Using `@hejbro/nile` — `nileDriver`, `asTenant`, the declarations this preset refuses and their evidence grades |
| `references/query-layer.md` | Building a `db()` handle, chaining queries, calling `db.fn`, running under an RLS execution context, transactions, asserting the connected database matches its declarations (`assertSchema`), or query-layer errors |
| `references/brownfield-adoption.md` | Adopting hejbro into an existing (already-populated) database, or writing starter declarations from a live database with `hejbro import` |
| `references/polyrepo.md` | A repository needs types for a schema it doesn't declare — monorepo alias vs. `link`/`vendor`, the vendoring command surface, a generated `contract.ts`, one of the eleven coded vendoring failures, or `hejbro pull`'s database-sourced fallback contract |
