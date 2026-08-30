# Supabase preset

Read this when using `@hejbro/supabase` — roles, auth helpers, storage
buckets, or preset warnings.

## Wiring it in

Register the preset in `hejbro.config.ts`, not by hand in application
code:

```ts
import { supabasePreset } from "@hejbro/supabase";
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/app.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
	presets: [supabasePreset],
});
```

See `examples/supabase/hejbro.config.ts`.

## Connecting

`supabaseDriver(driver, options?)` wraps any `@hejbro/query` driver
(usually `pgDriver(...)`) and takes an optional second argument naming
the Supabase connection path the driver was built against. This is a
declaration, never a detection: the driver contract fixes a driver
value's capability set before any connection exists, so nothing here
probes the database or inspects the connection string to guess.

```ts
import { pgDriver } from "@hejbro/pg";
import { supabaseDriver } from "@hejbro/supabase";

// Direct connection or session-mode pooler -- the default, and the only
// path a one-argument `supabaseDriver(driver)` call has ever meant.
const sessionDriver = supabaseDriver(
	pgDriver(process.env.DATABASE_URL ?? "postgres://localhost:5432/app"),
);

// Supabase's transaction-mode pooler (Supavisor, port 6543): declare it
// explicitly so the driver stops relying on a per-connection session pin
// the endpoint does not reliably keep.
const poolerModeDriver = supabaseDriver(
	pgDriver(process.env.SUPABASE_POOLER_URL ?? "postgres://localhost:6543/app"),
	{ endpoint: "transaction-pooler" },
);
```

| Connection | `endpoint` | `interactive-transactions` | `session-state` |
| --- | --- | --- | --- |
| Direct connection, or Supabase's session-mode pooler | omitted, or `"session"` | `true` | `true` |
| Supabase's transaction-mode pooler (Supavisor, port 6543) | `"transaction-pooler"` | `true` | `false` |

Omitting the option means `"session"` — an existing one-argument call's
behavior and capability declaration are unchanged by this option's
existence.

### Declaring the wrong path

The two directions cost differently, and only one of them is silent:

- **`"session"` (or omitting the option) against a transaction-mode
  pooler** loses the driver's session pin intermittently, under load,
  with no error: `interval`/`bytea` values arrive shaped by the server's
  defaults instead of the pinned shapes the query layer's conversion
  expects. Nothing fails loudly, because nothing failed by the driver
  contract's own definition — session state really did read `true`, and
  it really did stop being true between two transactions.
- **`"transaction-pooler"` against a session-keeping endpoint** costs one
  extra `SET LOCAL` pair sent per execution, and nothing else. Declaring
  the pooler path is safe on any endpoint; the reverse is not.

This preset does not detect which endpoint a connection string actually
points at, and never will as a substitute for declaring `endpoint`
yourself — a capability discovered by asking the database can change
under the caller's feet between two executions, which is exactly what
declaring capabilities as data exists to prevent. It also does not change
prepared-statement behavior under the pooler: that is the underlying
client library's own configuration, not a capability this driver reads,
though it is one more thing that behaves differently once you switch
endpoints.

## Roles and auth helpers

`anonRole`, `authenticatedRole`, `serviceRole` are branded `Role` values
for `.to(...)` in `rls.policy(...)`/`grant(...)`. `authUsers` is an
existing-table reference — an FK target only, never declared/diffed.

`authUid()`/`authJwt()` and their cached forms `authUidCached()`/
`authJwtCached()` (#97) split by where they're used:

- **Inside an RLS `using`/`withCheck` clause, use `authUidCached()`/
  `authJwtCached()`.** They render `(select auth.uid())`/
  `(select auth.jwt())` — Postgres caches that as an initPlan evaluated
  once per statement, instead of re-evaluating a bare `auth.uid()` once
  per row. The `rls-uncached-auth-call` validator warns if a policy uses
  the plain form here instead.
- **Inside a column `default`/`check` expression, use the plain
  `authUid()`/`authJwt()`.** A scalar subquery is illegal there, so the
  cached forms don't work in this position.

See `examples/supabase/src/app.schema.ts` for `authUsers`/
`authUidCached()` in an RLS policy.

## Storage buckets

`storageBucket(name, { public?, fileSizeLimit?, allowedMimeTypes? })` is
hejbro's first row-data object kind: create/alter emit an idempotent
upsert into `storage.buckets`; drop emits no SQL (buckets hold user
files, so hejbro never auto-deletes one — the migration banner notes the
manual-deletion step instead).

## Preset warnings

These warnings render on stderr the same way any other
`warning[<code>]: <identity>` does (see `generate-verify-workflow.md`):

- `exposed-table-without-rls` — a table sits in a schema granted to
  `anon`/`authenticated` but declares no RLS, so every row is
  readable/writable through the API.
- `view-over-rls-without-security-invoker` — a view reads an
  RLS-protected table without `{ securityInvoker: true }`, so it runs
  with its owner's rights and bypasses row-level security.
- `rls-uncached-auth-call` (#97) — a policy's `using`/`with check`
  clause calls the plain `auth.uid()`/`auth.jwt()` instead of
  `authUidCached()`/`authJwtCached()`, so Postgres re-evaluates it once
  per row instead of once per statement. Not raised for a column
  `default`/`check` expression — the plain form is correct there.

`auth`, `storage`, and `realtime` are Supabase-managed — declaring one of
those schemas, or any object inside one, is a hard error, not a warning.

## Local round-trip

The Docker round-trip for a Supabase-preset example needs a seed file for
the Supabase-isms a generic Postgres lacks (roles, `storage.buckets`,
`auth.users`, and `auth.uid()` stubs) — see
`examples/supabase/seed/supabase.sql`, wired up as the `roundtrip` script
in `examples/supabase/package.json`.
