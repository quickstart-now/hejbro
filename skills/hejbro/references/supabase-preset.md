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

| Connection | `endpoint` | `interactive-transactions` | `session-state` | `prepared-statements` | `batched-transactions` |
| --- | --- | --- | --- | --- | --- |
| Direct connection, or Supabase's session-mode pooler | omitted, or `"session"` | `true` | `true` | the wrapped driver's own | `false` |
| Supabase's transaction-mode pooler (Supavisor, port 6543) | `"transaction-pooler"` | `true` | `false` | `false` | `false` |

On the session path the capability set is whatever the wrapped driver
declares — these values are `pgDriver`'s. The pooler path is the only
one where this preset replaces them. `batched-transactions` reads
`false` on both paths: `pgDriver` itself never declares it `true`, and
the pooler path fixes its own capability record independently of the
wrapped driver either way (task 1.2a, #486/R7) — an inherited `batch`
member under a declared-`false` capability would fail closed
regardless.

### The pooler refuses a base driver that names its own statements

A prepared statement holds no meaning across the backends the
transaction-pooler endpoint hands out between transactions: a name
parsed and bound on one backend does not exist on the next one the
pooler assigns, so `supabaseDriver(driver, { endpoint:
"transaction-pooler" })` refuses `driver` at construction — before any
connection is opened — when `driver.capabilities["prepared-statements"]`
reads `true`:

```ts
import { pgDriver } from "@hejbro/pg";
import { supabaseDriver } from "@hejbro/supabase";

const preparingDriver = pgDriver(process.env.SUPABASE_POOLER_URL ?? "", {
	preparedStatements: true,
});

// throws at construction, coded "prepared-statements-without-session":
// build the base driver without preparedStatements, or use the
// "session" endpoint.
supabaseDriver(preparingDriver, { endpoint: "transaction-pooler" });
```

Build the base driver without `preparedStatements` (fine on any
endpoint — see `query-layer.md`'s own note on the option's default) or
switch to the `"session"` endpoint, whichever fits. The session
endpoint (or no endpoint) always passes the base driver's own
`prepared-statements` declaration through unchanged.

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
- **`"transaction-pooler"` against a session-keeping endpoint** wraps
  every single-statement execution in its own `BEGIN`/`COMMIT` and sends
  the two `SET LOCAL` pins inside it — four extra statements per
  execution, and a statement that used to run in autocommit now running
  in an explicit transaction. Nothing else changes: the values still
  arrive in the same shapes. Declaring the pooler path is safe on any
  endpoint; the reverse is not.

This preset does not detect which endpoint a connection string actually
points at, and never will as a substitute for declaring `endpoint`
yourself — a capability discovered by asking the database can change
under the caller's feet between two executions, which is exactly what
declaring capabilities as data exists to prevent. Need other client-level
options — a pool size, connection timeouts — construct the pool yourself
and pass it to `pgDriver(pool)`; the same `endpoint` option applies.

### The CLI's own connection

`hejbro.config.ts` can name a `driver` factory so the seven CLI commands
that connect — `check`, `status`, `migrate`, `raise`, `reset`, `import`
and `pull` — go through this preset's own decorated driver instead of
the vanilla `@hejbro/pg` import each falls back to when the field is
absent:

```ts
import { pgDriver } from "@hejbro/pg";
import { supabaseDriver, supabasePreset } from "@hejbro/supabase";
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/app.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
	presets: [supabasePreset],
	driver: (connectionString) =>
		supabaseDriver(pgDriver(connectionString), {
			endpoint: "transaction-pooler",
		}),
});
```

The factory receives only the connection string each command already
resolved from `--url`/`DATABASE_URL` — `hejbro.config.ts` itself never
carries one. The driver it returns must still be closable
(`client.end`, the same member `pgDriver`'s own connection-string form
carries): every decorator here spreads its base driver through, so this
shape already satisfies it — a custom driver that drops `client.end`
before returning it from `driver` is refused, naming the field, before
any statement is sent.

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
