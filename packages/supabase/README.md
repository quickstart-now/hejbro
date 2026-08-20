# @hejbro/supabase

The Supabase provider preset for hejbro, built entirely on `@hejbro/core`'s
public extension interface (spec §4.1): role constants (`anonRole`,
`authenticatedRole`, `serviceRole`), the `authUid()`/`authJwt()` expression
helpers, the prebuilt `authUsers` existing-table reference, the storage
bucket object kind, and three validators (reserved-schema protection,
exposed-table-without-RLS, and view-over-RLS-without-`security_invoker`).
See `/docs/specs/2026-08-19-hejbro-design.md` and
`/docs/plans/2026-08-19-roadmap.md` (Phase 6/7) for the full design.

## Using the preset (`hejbro.config.ts`, D55)

List `supabasePreset` in `hejbro.config.ts`'s `presets` — `hejbro generate`
and `hejbro verify` both register the storage bucket kind and run every
Supabase validator automatically:

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
