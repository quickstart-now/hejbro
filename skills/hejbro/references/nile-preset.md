# Nile preset

Read this when using `@hejbro/nile` — `nileDriver`, `asTenant`, or the
declarations this preset refuses at generate time.

## Wiring it in

Register the preset in `hejbro.config.ts`, and decorate a driver you
already built (Nile speaks plain Postgres on 5432 — there is no second
client library to wrap):

```ts
import { nilePreset } from "@hejbro/nile";
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/app.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
	presets: [nilePreset],
});
```

```ts
import { pgDriver } from "@hejbro/pg";
import { asTenant, nileDriver } from "@hejbro/nile";

const driver = nileDriver(
	pgDriver(process.env.DATABASE_URL ?? "postgres://localhost:5432/app"),
);

// every execution scoped to one tenant (and, optionally, one user) --
// db(schema, driver).as(context) applies it as the transaction's own
// first statement(s), see references/query-layer.md
const tenantContext = asTenant("11111111-1111-1111-1111-111111111111");
const tenantAndUserContext = asTenant(
	"11111111-1111-1111-1111-111111111111",
	"22222222-2222-2222-2222-222222222222",
);
```

A tenant-aware table needs no special syntax — an ordinary `table(...)`
with a `tenant_id uuid` column is all Nile's platform requires: *"You can
create a tenant aware table in Nile by creating a table with a
'tenant_id' column of type uuid… This is all it takes."*

## The two platform declarations

`nileDriver`'s output carries two fixed declarations, never discovered
from the platform at runtime:

- **`roleLessPlatform: true`** — Nile has no roles a context could name.
  This admits a role-less context (`asTenant(...)` never names one); it is
  not an exemption from the declared-role whitelist — a context that
  *does* name a role is still validated exactly as on any other driver.
- **`contextRequired: true`** — on this platform, an unapplied context
  widens visibility to every tenant rather than narrowing it, so an
  uncontexted execution fails closed with the query layer's own
  `context-required` error before anything reaches the database. This
  does **not** block `hejbro check`'s schema read: that read goes through
  the driver session directly (`packages/cli/src/check/catalog.ts`), never
  through a `db()` execution surface, so the mandatory-context refusal
  never applies to it.

## What this preset refuses, and why

Every refusal fails `hejbro generate` with an explicit error naming the
declaration — never a silent drop, never rewritten SQL. Each error states
its own evidence grade:

| Declaration | Refused because | Evidence |
| --- | --- | --- |
| `rls.enabled(...)` / `rls.policy(...)` | the platform's policy engine is not yet available | platform-documented |
| `defineFunction(...)` | user-defined functions are not supported | platform-documented |
| `defineTrigger(...)` | triggers need UDF support, which isn't there yet | platform-documented |
| `grant(...)` | attempted against Nile's testing container and refused | **measured only** — not in the platform's published table |
| `serial` / `smallserial` / `bigserial` in a tenant-aware table (a table with a `tenant_id uuid` column) | attempted against Nile's testing container and refused | **measured only** — adjacent to, but not the same declaration as, the platform's documented `CREATE SEQUENCE` restriction for tenant tables |

A `serial`-family column outside a tenant-aware table is untouched — the
platform's restriction is scoped to tenant-aware tables, and this preset
never widens it. What the platform accepts is unaffected: a tenant-aware
table with no refused declaration generates exactly the SQL it would with
no preset registered, and registering this preset never changes what any
other preset's output looks like.

### The platform's own published limitations table

Verbatim, from Nile's own Postgres-compatibility documentation
(<https://thenile.dev/docs/postgres/postgres-compatibility>, accessed
2026-08-31) — quoted, not paraphrased or corrected (the third row's
`tdere` is the platform's own typo):

> | Statement | Nile behavior | Workaround |
> | --- | --- | --- |
> | `CREATE POLICY` | Nile will have the ability to define policies through a more powerful permission system that is in progress | Would love to hear your use case for this in our github discussion forum |
> | `CREATE FUNCTION` | User defined functions are not supported yet | Push the logic to the application |
> | `CREATE TRIGGER` | Triggers are not supported yet since UDF support is not tdere | We hope to support real time events soon |

`GRANT` and the `serial`/`smallserial`/`bigserial` refusal in a
tenant-aware table are **not** in this table — both refusals rest on a
measurement against Nile's official testing container instead (a floor,
not a ceiling: the platform may have widened since this preset's own
measurement).

### `COMMENT`: refused by the platform, but no validator fires for it

Nile's platform refuses `COMMENT` too, but hejbro's DSL has no comment
declaration at all — there is nothing a validator could ever match
against. A validator that can never fire would be a spec sentence with no
test behind it, so this fact lives here, in documentation, instead of as
dead code in `packages/nile/src/validators.ts`.

## The base driver shape this decorator does not support

`nileDriver(driver)` sends nothing of its own before the caller's
transaction callback runs — everything the platform needs rides in its
own context rendering, applied by the query layer as the first
statement(s) inside the transaction it opens. This works as long as the
base driver applies its own session settings **at connection checkout**,
outside any transaction (the shape `@hejbro/pg` and `@hejbro/neon`'s
WebSocket driver both use).

**A base driver that applies its own session statements inside the
transaction it opens is not supported by this decorator.** Those
statements would land ahead of the tenant setting, and the platform
refuses a tenant-scoped statement that wasn't first. The transaction-mode
pooler shape (`@hejbro/supabase`'s own `supabaseDriver(driver, {
endpoint: "transaction-pooler" })`) is exactly the unsupported shape —
its pins are sent as the first statements inside every transaction it
opens, by design, to survive a pooled backend that doesn't keep session
state between transactions. Decorating a transaction-mode pooler driver
with `nileDriver` is not a configuration this preset supports.
