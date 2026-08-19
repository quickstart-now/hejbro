# @hejbro/core

Declaration model, builder DSL, snapshot/diff engine, and SQL emission for
hejbro. Pure — no filesystem, no database I/O; deterministic by design.
Phase 1 (structural kinds: schemas, tables/columns, enums, indexes, foreign
keys) has landed; functions/triggers/RLS/views/grants and the generic
expression AST are planned for later phases. See
`/docs/specs/2026-08-19-hejbro-design.md` for the full design and
`/docs/plans/2026-08-19-roadmap.md` for phase status. No public API docs
yet — read the JSDoc on each export in `src/index.ts` in the meantime.
