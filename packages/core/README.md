# @hejbro/core

Declaration model, builder DSL, snapshot/diff engine, and SQL emission for
hejbro. Pure — no filesystem, no database I/O; deterministic by design.

Covers schemas, tables/columns, enums, indexes, foreign keys, functions,
triggers, row-level security policies, views, grants, and a generic
expression AST (typed operators, the `sql` template, and everything
CHECK/index/RLS predicates accept). Provider presets (Supabase first,
`@hejbro/supabase`) build on this package's own public extension
interface — no core special-casing for any one platform.

See `/docs/specs/2026-08-19-hejbro-design.md` for the full design. No
public API docs yet — read the JSDoc on each export in `src/index.ts` in
the meantime.
