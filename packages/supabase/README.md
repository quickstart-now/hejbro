# @hejbro/supabase

The Supabase provider preset for hejbro, built entirely on `@hejbro/core`'s
public extension interface (spec §4.1): role constants (`anonRole`,
`authenticatedRole`, `serviceRole`), the `authUid()`/`authJwt()` expression
helpers and their initPlan-cached forms `authUidCached()`/`authJwtCached()`
(#97), the prebuilt `authUsers` existing-table reference, the storage
bucket object kind, and four validators (reserved-schema protection,
exposed-table-without-RLS, view-over-RLS-without-`security_invoker`, and
uncached-`auth.*()`-call-in-a-policy).
See `/docs/specs/2026-08-19-hejbro-design.md` and
`/docs/plans/2026-08-19-roadmap.md` (Phase 6/7) for the full design.

## Using the preset (`hejbro.config.ts`, D55)

List `supabasePreset` in `hejbro.config.ts`'s `presets` — `hejbro generate`
and `hejbro verify` both register the storage bucket kind; `hejbro
generate` additionally runs every Supabase validator and renders warnings
to stderr:

```ts
import { defineConfig } from "hejbro";
import { supabasePreset } from "@hejbro/supabase";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [supabasePreset],
});
```

A validator that reports a warning (e.g. a table reachable by API roles
with no row-level security) still lets `hejbro generate` write the
migration and exit 0 — the warning renders to stderr as
`warning[<code>]: <identity>` after the migration is written, so it never
blocks generation, only flags something worth reviewing.

## Programmatic use

Calling `generateMigration`/`buildSnapshot` directly (outside the CLI)?
`registerSupabaseKinds(registry)` and `supabaseValidators` are the
lower-level building blocks `supabasePreset` is made of — register the
kind and pass the validators yourself:

```ts
import { createDefaultRegistry, generateMigration } from "@hejbro/core";
import { registerSupabaseKinds, supabaseValidators } from "@hejbro/supabase";

const registry = createDefaultRegistry();
registerSupabaseKinds(registry);

const result = generateMigration({
	declarations,
	previousSnapshot,
	registry,
	validators: supabaseValidators,
});
```

**RLS performance note (D45/#97):** two forms, two places.

- **In an RLS `using`/`with check` clause, use `authUidCached()`/
  `authJwtCached()`.** Postgres does **not** cache a bare `auth.uid()`/
  `auth.jwt()` call across rows there — it's re-evaluated once per row.
  The cached forms render `(select auth.uid())`/`(select auth.jwt())`,
  which Postgres caches as an initPlan evaluated once per statement
  instead — the standard Supabase RLS performance guidance.
- **In a column `default`/`check` expression, use the plain `authUid()`/
  `authJwt()`.** A scalar subquery is illegal there (`check-subquery`
  hard-errors on this for `.check(...)`), so the cached forms don't work
  in this position — the plain call is the correct, idiomatic one.

The `rls-uncached-auth-call` validator (part of `supabaseValidators`)
warns if a policy calls the plain form where the cached one belongs; it
does not look at column `default`/`check` expressions at all, since the
plain form is correct there.
