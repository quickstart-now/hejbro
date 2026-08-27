// hejbro — the user-facing package: re-exports the @hejbro/core DSL and hosts
// the CLI (`hejbro init`, `hejbro generate`).
// See /docs/specs/2026-08-19-hejbro-design.md before implementing anything here.

// Re-exports every public @hejbro/core symbol (schema, table, column
// builders, defineFunction, rls, index, grant, …) so declaration files and
// hejbro.config.ts can both `import { ... } from "hejbro"` — a single
// surface, never curated by hand, so it can't drift from core's real
// exports (Task 14's entry-not-found golden checks this).
export * from "@hejbro/core";
// Re-exports every public @hejbro/query symbol (`db`, the chain entry
// points, `compile`, driver-contract types, `DbContext`/`ScopedDb`/`Tx`,
// result types, …) the same way, for the same reason (task 7.9, group 7
// decision ①). `sql` is exported explicitly right after: an ES module
// named export always wins over a colliding `export *` without an
// ambiguity error, so this one line is what makes query's dual-use `sql`
// the barrel's *only* `sql` — core's own `sql` (which the `export *`
// above already carries) is shadowed here, never removed from core's own
// surface. Existing fragment uses (`index().on(sql\`...\`)`,
// `check(name, sql\`...\`)`) keep type-checking unchanged: query's `sql`
// is a structural superset of core's (task 7.0 scout, confirmed by
// `test/exports.test.ts`'s own fragment-use assertion).
export * from "@hejbro/query";
export { sql } from "@hejbro/query";
export type { HejbroConfig } from "./config";
export { defineConfig } from "./config";
