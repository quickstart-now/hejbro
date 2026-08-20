---
name: hejbro
description: Use when declaring or changing a Postgres schema with hejbro — tables, RLS, functions/triggers, grants, views — or when generating/verifying migrations, or when a function body needs control flow (real JS if/for is forbidden inside bodies; use ctx.if()/ctx.forEach()).
version: 0.1.0
license: MIT
---

# hejbro

1. Declare only — never hand-edit `migrations/*.sql` or `hejbro.snapshot.json`; regenerate with `hejbro generate`.
2. Inside `defineFunction`/`defineTrigger` bodies, never use real JS `if`/`for`/`while` — use `ctx.if()`/`ctx.forEach()`. The body callback runs twice at declaration time (a determinism guard); anything that isn't pure DSL recording throws `nondeterministic-body`.
3. Read the migration's banner comment before merging — it lists every object added/changed/dropped, in order.
4. `hejbro generate` never guesses at renames: an ambiguous drop+add exits 1 with the exact `--rename`/`--confirm-drop` command to rerun.
5. Presets (e.g. `@hejbro/supabase`) go in `hejbro.config.ts`'s `presets` array — never register kinds by hand in application code.
6. CHECK constraints, partial/ordered indexes, and self-referencing foreign keys are all declared inline on `table(...)`'s extras — see the cheatsheet, not the query builder.
7. `hejbro verify` re-derives the migration chain from checked-out files only (no live DB) — run it in CI. The local Docker round-trip (`pnpm roundtrip`) is the deeper, pre-merge check.

## References

| File | Read it when |
|---|---|
| `references/dsl-cheatsheet.md` | Writing or editing a schema declaration — tables, columns, CHECK, indexes, FKs, RLS, grants, views |
| `references/function-builder-pitfalls.md` | Writing a `defineFunction`/`defineTrigger` body, or debugging a `nondeterministic-body` error |
| `references/generate-verify-workflow.md` | Running `generate`/`verify`, reading the banner, resolving an ambiguous rename, reading a warning |
| `references/supabase-preset.md` | Using `@hejbro/supabase` — roles, auth helpers, storage buckets, preset warnings |
