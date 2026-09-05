# Neon preset

Read this when using `@hejbro/neon` — `neonDriver`, roles, auth helpers,
or the two authentication modes.

## Wiring it in

`@hejbro/neon` registers no object kinds and no validators, so there is
no `Preset` bundle to add to `hejbro.config.ts` — only the driver and the
context builders matter at runtime:

```ts
import { neonDriver, neonAuth } from "@hejbro/neon";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const driver = neonDriver(pool);
const auth = neonAuth("claims"); // or "jwt" -- see "Authentication modes" below
```

## The CLI's own connection

`hejbro.config.ts` can name a `driver` factory so the seven CLI commands
that connect — `check`, `status`, `migrate`, `raise`, `reset`, `import`
and `pull` — go through this preset's own driver instead of the vanilla
`@hejbro/pg` import each falls back to when the field is absent:

```ts
import { neonDriver } from "@hejbro/neon";
import { Pool } from "@neondatabase/serverless";
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/app.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
	presets: [],
	driver: (connectionString) => neonDriver(new Pool({ connectionString })),
});
```

The factory receives only the connection string each command already
resolved from `--url`/`DATABASE_URL` — `hejbro.config.ts` itself never
carries one. The WebSocket `Pool` path is the one to configure here:
`migrate`/`raise`/`reset` need `interactive-transactions`, which only it
declares (see the table below). The driver it returns is closable
(`client.end`) the same way `@hejbro/pg`'s own connection-string form
is — `neonDriver(pool)`'s own `client` member *is* the `Pool` itself, so
there is nothing to add here.

The HTTP path (`driver: (connectionString) => neonDriver(neon(connectionString))`)
works here too, for `check`/`status`/`import`/`pull` — the four commands
that never need `interactive-transactions`. `migrate`/`raise`/`reset`
still refuse it with the driver contract's own missing-capability error,
exactly as they refuse it when built by hand: configuring it as `driver`
changes nothing about that. `neonDriver(sql)`'s own `client.end` is a
no-op — the HTTP path holds no connection open between requests, so
there is nothing for the CLI's close step to do.

## The two connection paths

`neonDriver` is overloaded on the client it is handed, and the two
clients declare genuinely different capabilities — never assume, always
pass the client whose capabilities you need:

- **`neonDriver(pool, options?)`**, given a `Pool` from
  `@neondatabase/serverless`: a real WebSocket connection.
  `interactive-transactions` and `session-state` both `true` —
  `db.transaction(...)` and `db.as(...)` work exactly like `@hejbro/pg`.
  `batched-transactions` is `false` (task 1.2a, #486): a single held
  connection already has `transaction()`, so `batch` refuses before
  sending anything, the same as `@hejbro/pg`'s own connection-string
  path. `options?.preparedStatements` names every built statement on
  this connection, identically to `pgDriver`'s own option (see
  `query-layer.md`'s "Prepared statements" section) — absent, it is
  `false`, matching this path's behavior before the option existed.
- **`neonDriver(sql)`**, given a `neon()` query function: HTTP one-shot.
  `interactive-transactions`, `session-state`, and `prepared-statements`
  all `false`, `batched-transactions` `true` (task 1.2b, #486) —
  `db.as(context)` runs the context and the caller's statement as one
  batch (role/settings are transaction-local to that one batch, not a
  held session), but `db.transaction(callback)` still fails immediately
  with the driver contract's own missing-capability error, before
  anything is sent: a callback is interactive by definition, and this
  path never holds a connection open between statements. This overload's
  type accepts no options argument at all: a one-shot HTTP request has no
  session to prepare a statement in.
  Every execution still carries the same session pins (`IntervalStyle`,
  `bytea_output`) `@hejbro/pg` applies once per connection, batched with
  each statement instead — arrival shape for `interval`/`bytea`/etc. is
  identical to the WebSocket path. Opens nothing between requests, so
  its own `client.end` (used when this is configured as the CLI's
  `driver`, above) is a documented no-op, not a missing member.

**A failed HTTP batch carries no member index.** The pins and the
caller's own statement travel as one batch; if a pin statement ever
failed, the error surfacing at the call site would be indistinguishable
from the caller's own statement failing. The pins are two constant `SET`
statements sent unconditionally, so this is close to unreachable in
practice — but if a query ever fails with an unexplained syntax or
permission error over the HTTP path, that is the first thing to rule
out, not the caller's own SQL.

## Roles and auth helpers

`authenticatedRole`, `anonymousRole` are branded `Role` values for
`.to(...)` in `rls.policy(...)`/`grant(...)` — Neon's Data API names, not
Supabase's (`anonymous`, not `anon`).

`authUid()`/`authJwt()` render `auth.uid()`/`auth.jwt()` over
`pg_session_jwt` — the same function names and shapes the Supabase
preset's helpers render, because both platforms expose the same
extension surface. No `*Cached` variant: that encodes Supabase's own
documented RLS performance guidance, unconfirmed for Neon.

## Authentication modes

`pg_session_jwt` resolves identity from one of two settings, and the two
are mutually exclusive on a given database:

- **`"claims"` mode** — no JWK configured. Reads `request.jwt.claims`.
  Use `neonAuth("claims")`, which exposes `asUser(claims)` (requires a
  `sub` claim) and `asAnonymous()`.
- **`"jwt"` mode** — a JWK is configured, and the database verifies the
  token itself. Reads `pg_session_jwt.jwt`. Use `neonAuth("jwt")`, which
  exposes `asJwtUser(token)` (an opaque string, never decoded or
  validated by this preset) and `asAnonymous()`.

`neonAuth(mode)` fixes the mode **once**, at construction, from a value
you supply — **never by querying the database**. Asking the wrong
surface for the other mode's builder is a compile error
(`neonAuth("claims")` has no `asJwtUser`, and vice versa), so one
codebase cannot accidentally mix the two. What the type layer cannot
catch is supplying the *wrong* mode for your actual database: nothing in
this preset checks that.

### From symptom to cause: every row disappears under a context

If `db.as(auth.asUser(claims))` (or `asJwtUser`) runs without error but
every row a policy should return comes back empty, the first thing to
compare is **the mode you declared against whether the database
actually has a JWK configured for `pg_session_jwt`.** A context built
for the wrong mode sets a GUC nothing reads; `auth.uid()`/`auth.jwt()`
then resolve to `NULL`, and a policy keyed on either denies — silently,
with no error at any layer.

**A policy keyed only on the role does not catch this.** `to
authenticated using (true)` and its relatives — the ordinary way to
write "any signed-in user" — still **admit** under a mismatched mode,
because the role half of the context applies normally even when the
identity half resolves to nothing. The request then runs as a generic
authenticated user with no identity ever resolved. If access control
depends on *who* the user is, key the policy on `auth.uid()` (or
`auth.jwt()`) explicitly — never assume a role-only policy is safe just
because the mode might be wrong.

The same timing rule covers a bad token: a token's validity is checked
by the database when identity is first read (`auth.uid()`/`auth.jwt()`),
not when the context is applied. Applying a context carrying a malformed
or unverifiable token succeeds; the failure surfaces at the first policy
or expression that resolves identity.

### Transaction-local scope, not `jwt_session_init`

`pg_session_jwt` ships its own `auth.jwt_session_init(jwt)` helper, which
runs a **session-scoped** `SET` — it outlives the transaction it was
called in, and on a pooled connection that means it can leak into the
next request. This preset never calls it. Every context this preset
builds applies its identity setting with `set_config(..., true)` —
**transaction-local**, gone the moment the transaction ends, on the same
physical connection or a fresh one. This is the same guarantee `@hejbro/
query`'s generic `db.as(context)` mechanism gives every preset (D96), not
something Neon-specific.

## Two facts this preset cannot confirm locally

Whether a real Neon database runs `pg_session_jwt` in `"claims"` mode or
`"jwt"` mode, and whether `neondb_owner` (or your own role) may `SET
LOCAL ROLE authenticated`, can only be confirmed against a live Neon
instance — the local witness proves the mechanism works, not what a
particular Neon project is configured for.
