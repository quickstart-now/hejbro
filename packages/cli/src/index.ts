// hejbro — the user-facing package: re-exports the @hejbro/core DSL and hosts
// the CLI (`hejbro init`, `hejbro generate`).
// See /docs/specs/2026-08-19-hejbro-design.md before implementing anything here.

// Re-exports every public @hejbro/core symbol (schema, table, column
// builders, defineFunction, rls, index, grant, …) so declaration files and
// hejbro.config.ts can both `import { ... } from "hejbro"` — a single
// surface, never curated by hand, so it can't drift from core's real
// exports (Task 14's entry-not-found golden checks this).
export * from "@hejbro/core";
