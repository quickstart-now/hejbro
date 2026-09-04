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

`asTenant(...)` does not validate its arguments at construction — it
stores them as given. Validation happens once, at first execution, when
the rendering runs (a single source of truth: a `DbContext` can also be
built by hand, bypassing `asTenant` entirely, and that path must be
checked too — duplicating the check in the builder would just be a
second, driftable copy of it).

The same rendering also refuses a context it cannot apply at all, before
producing any statement: one that names a role, or one carrying a
setting outside the platform's own `nile.tenant_id`/`nile.user_id` keys.
Both fail with `nile-context-unsupported` — the platform has no role to
apply a role statement to, and silently dropping it would leave the
tenant setting behind it blocked too, so the rendering refuses instead
of ignoring.

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
  does **not** block the schema assertion a handle exposes:
  `assertSchema(handle)` reads through the handle's own `driver` member,
  which is not an execution surface and which the corpus already exempts,
  so the mandatory-context refusal never applies to it.

## Table-bound column references render two-part

A tenant-aware table lives internally under a `<database-id>_<schema>`
name subject to the platform's 12-byte schema-name limit, so a
schema-qualified column reference in a check constraint, a partial index
predicate, an index expression, a generated column's expression, or a
policy's `using`/`with check` fails at apply time with `42622`; hejbro
renders every such table-bound column reference two-part
(`"table"."column"`) instead.

## `hejbro check` compares check constraints by text, not `EXPLAIN`

Nile has no `EXPLAIN`, so `hejbro check` never issues one against it:
`nilePreset` declares `explainUnavailable: true`, and `check` reads that
declaration from `config.presets` alone (never a driver, a connection, or
anything a server probe could produce) to switch every check-constraint
comparison in the run from the server's own rendering to a fixed,
six-step text normalization instead — collapsing whitespace outside
string literals, stripping one enclosing parenthesis pair, stripping the
declaring table's own qualifier from a column reference, unquoting a
plain lower-case identifier, stripping a `::type` cast the server
appended to a string literal, and folding letter case outside quoted
identifiers and string literals. Two spellings that normalize to the same
text agree, silently, exactly as on a platform that can plan.

Two spellings that still differ after normalization are reported
`check-not-compared`, carrying both texts and a `Next:` that names
restating the declaration in the catalog's own spelling — never
`check-constraint-differs`: a textual difference is not evidence of a
different meaning, only evidence that this run couldn't settle the
question. The declaration commonly outlives an equivalent rewrite the
server performs at parse or storage time, e.g.:

- `role in ('owner', 'admin')` is stored as
  `role = ANY (ARRAY['owner'::text, 'admin'::text])` — a set membership
  test rewritten to an array comparison.
- `priority between 1 and 5` is stored as
  `((priority >= 1) AND (priority <= 5))` — a range test rewritten to two
  comparisons.

Both are `check-not-compared` under this mode (the normalization pipeline
never rewrites operators, on purpose — doing so risks equating two
expressions that actually differ). The `Next:` line never asks the reader
to run or be granted `EXPLAIN` on such a platform — the whole reason this
mode exists is that no role could satisfy that request here. See
`packages/cli/src/check/expression.ts` for the exact normalization order
and `openspec/changes/fix-nile-findings/design.md`'s "`check` without
EXPLAIN" section for the full rationale.

Whether a view body or a query-builder statement referencing a
tenant-aware table's three-part column references is itself accepted by
Nile is unmeasured — tracked in #772, not by this preset.

## What this preset refuses, and why

Every refusal fails `hejbro generate` with an explicit error naming the
declaration — never a silent drop, never rewritten SQL. Each error states
its own evidence grade:

| Declaration | Refused because | Evidence | Code |
| --- | --- | --- | --- |
| `rls.enabled(...)` / `rls.policy(...)` | the platform's policy engine is not yet available | platform-documented | `nile-rls-unsupported` |
| `defineFunction(...)` | user-defined functions are not supported | platform-documented | `nile-function-unsupported` |
| `defineTrigger(...)` | triggers need UDF support, which isn't there yet | platform-documented | `nile-trigger-unsupported` |
| `grant(...)` | attempted against Nile's testing container and refused | **measured only** — not in the platform's published table | `nile-grant-unsupported` |
| `serial` / `smallserial` / `bigserial` in a tenant-aware table (a table with a `tenant_id uuid` column) | attempted against Nile's testing container and refused | **measured only** — adjacent to, but not the same declaration as, the platform's documented `CREATE SEQUENCE` restriction for tenant tables | `nile-serial-in-tenant-table` |
| A primary key on a tenant-aware table that excludes `tenant_id` | attempted against Nile's testing container (`create table` with a lone `id` primary key on a table also carrying `tenant_id uuid`) and refused: `primary key of tenant-aware table must have the "tenant_id" column` | **measured only** — not in the platform's published table | `nile-tenant-primary-key-missing` |
| An identity column (`.generatedAlwaysAsIdentity()` / `.generatedByDefaultAsIdentity()`) in a tenant-aware table | attempted against Nile's testing container and refused, for both kinds (`IDENTITY columns are not supported for tenant-aware table`, measured 2026-08-31) | **measured only** — not in the platform's published table | `nile-identity-in-tenant-table` |

A `serial`-family column outside a tenant-aware table is untouched — the
platform's restriction is scoped to tenant-aware tables, and this preset
never widens it. **A tenant-aware table that declares no primary key at
all is accepted** — measured 2026-08-31 on the platform's own test
container: `create table (tenant_id uuid not null, name text)` succeeds
and takes rows under a tenant context, so this preset leaves it alone. Column *order* within a primary key
that does include `tenant_id` is likewise never asserted — only that
`tenant_id` is one of its columns, the only fact the measurement actually
supports. **An identity column** in a tenant-aware table is refused (the row
above) — it is sequence-backed like the `serial` family, and the
platform refuses it with its own error rather than the serial one, so it
carries its own code (`nile-identity-in-tenant-table`), measured on the
same container on 2026-08-31 (#573). What the platform accepts is unaffected: a tenant-aware table
with no refused declaration generates exactly the SQL it would with no
preset registered, and registering this preset never changes what any
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

`GRANT`, the `serial`/`smallserial`/`bigserial` refusal in a tenant-aware
table, the tenant-aware primary key refusal, and the tenant-aware identity
column refusal are **not** in this table — all four refusals rest on a
measurement against Nile's official testing container instead (a floor,
not a ceiling: the platform may have widened since this preset's own
measurement). The package's Docker-gated integration suite re-measures
each of the four, and the no-primary-key acceptance, against the pinned
container image.

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

## Running the live witness locally

`pnpm --filter @hejbro/nile test:integration` runs a Docker-gated suite
against Nile's own official testing container
(`ghcr.io/niledatabase/testingcontainer`, pinned by digest in
`packages/nile/vitest.integration.config.ts`'s sibling test file), and
overridable via `HEJBRO_NILE_IMAGE`. Overriding the image means the run
no longer measures the digest this file names; the measured-on-digest
claims do not transfer to that run. Three facts about the container,
measured 2026-08-31, that anyone running it locally will hit:

- **Fixed credentials, not configurable through an env var the image
  documents**: user `00000000-0000-0000-0000-000000000000`, password
  `password`, database `test`.
- **The `test` database is provisioned asynchronously after the container
  starts.** Its own internal first attempt fails ("connection refused")
  before the platform's own control-plane server is up; the image
  self-heals via a supervised retry a few seconds later. A readiness
  check that only confirms Postgres itself is accepting TCP connections
  (`pg_isready`) can report ready during exactly the window where the
  `test` database still isn't reachable — poll a real query against the
  target database instead.
- **A single statement may name only one distinct tenant.** Both an
  ordinary tenant-aware table (`insert ... values (...), (...)` naming
  two different `tenant_id` values) and the platform's own `tenants`
  registry table reject a multi-tenant statement with "cannot set
  tenant_id more than once" — register or write for one tenant per
  statement.
