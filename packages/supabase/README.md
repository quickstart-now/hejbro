# @hejbro/supabase

The Supabase provider preset for hejbro, built entirely on `@hejbro/core`'s
public extension interface (spec §4.1): role constants (`anonRole`,
`authenticatedRole`, `serviceRole`), the `authUid()`/`authJwt()` expression
helpers, the prebuilt `authUsers` existing-table reference, the storage
bucket object kind, and three validators (reserved-schema protection,
exposed-table-without-RLS, and view-over-RLS-without-`security_invoker`)
run through `generateMigration({ validators: supabaseValidators })`. See
`/docs/specs/2026-08-19-hejbro-design.md` and
`/docs/plans/2026-08-19-roadmap.md` (Phase 6) for the full design.

**RLS performance note (D45):** `authUid()` renders the plain
`auth.uid()` call — safe everywhere, including column `default`/`check`
expressions, where a wrapped subquery is illegal. In a `using`/`with check`
clause evaluated per row, Postgres does **not** cache a bare
`auth.uid()` call across rows; wrapping it as `(select auth.uid())`
turns it into an initPlan Postgres evaluates once per statement instead —
the standard Supabase RLS performance guidance. hejbro does not do this
wrapping automatically (see the D45 rationale in the spec's decision log);
a cached variant is tracked as a Phase 7 follow-up (issue #97). Until then,
wrap the call yourself with `sql` where the performance matters:
`` sql`(select auth.uid())` ``.
