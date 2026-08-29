# Proposal: add-neon-preset

## Why

`@hejbro/supabase` proved a preset could be written. It did not prove the
preset *interface* works, because a single preset cannot: every shape it
needs is a shape that was built for it. The second provider is the first
real measurement, and D5 named that measurement in advance — "the preset
interface is a first-class extension point, not a special case".

Neon is that second provider, and it stresses the interface in the one
place a Supabase clone never could. `@hejbro/supabase` declares **no
runtime dependency on any `@supabase/*` package**: `supabaseDriver` takes
an existing driver and adds `contributedRoles` to it, declaring no
capabilities of its own. The wire is always somebody else's — usually
`@hejbro/pg`. `@hejbro/neon` is therefore the **first package that is
both a preset and a real driver**, and its shape is a composition of
`packages/pg` (driver) with `packages/supabase` (preset), not a copy of
either. Surface symmetry with `@hejbro/supabase` is a question to answer,
never a reason to add.

The driver half is where the contract earns its keep. Neon's client
library exposes two connection paths whose capabilities genuinely differ:
WebSocket sessions (`Pool`/`Client`, node-postgres compatible, real
interactive transactions) and HTTP one-shot (`neon()`, documented as
"sessions and transactions are not supported"). Issue #300 states the
requirement exactly:

> declaring its real capabilities (HTTP one-shot vs WebSocket session
> paths differ — the capability set must tell the truth so
> missing-capability errors fire correctly).

A preset that shipped only the WebSocket path would declare every
capability `true`, fire no missing-capability error ever, and leave the
`driver-contract` requirements untested by a second implementation. The
HTTP path is the point, not an extra.

**Approval basis.** `@hejbro/neon` is listed under D98's deferred set and
was parked as this issue. Three things carry it into scope: the owner
placed #300 inside the 0.2.0 gate ("every sub-issue of #282 closes"), the
standing delegation covers openspec owner decisions in the owner's
absence, and D95 already writes the package map as
`@hejbro/supabase|neon|nile` with `@neondatabase/serverless` named as the
client to wrap. Nothing here revisits a decision; this change applies
three of them.

## What Changes

- **`@hejbro/neon`**, a new published package at version `0.0.0`,
  containing a provider preset and its driver.
- **`neonDriver`**, overloaded on the client it is handed — a Neon `Pool`
  (WebSocket) or a `neon()` query function (HTTP) — mirroring
  `pgDriver`'s existing overload pattern. The overload, not a runtime
  probe, is what fixes the capability set: the declaration is a property
  of the value before any connection exists.
- **Capabilities, declared honestly per path.** WebSocket:
  `{"interactive-transactions": true, "session-state": true}`. HTTP:
  `{"interactive-transactions": false, "session-state": false}`. The
  `false` values are load-bearing — `db.as(...)` and `db.transaction(...)`
  fail on the HTTP driver with the contract's own missing-capability
  error, naming the capability and the operation, before anything reaches
  the database.
- **The HTTP driver pins its own session settings per request.** Because
  an HTTP one-shot carries no session, the pins `@hejbro/pg` applies once
  at checkout (`IntervalStyle`, `bytea_output`) would otherwise never
  apply, and values would arrive shaped by whatever the server's defaults
  happen to be. The HTTP driver sends each execution as a single batch —
  the pins followed by the caller's statement — using the client's own
  non-interactive batch form. `session-state` stays `false`, because it
  means "state persists between executions" and that remains untrue; the
  driver simply guarantees its own statements, which is a claim it can
  keep.
- **Roles**: `authenticatedRole` and `anonymousRole`. Neon's Data API
  creates `authenticated` and **`anonymous`** — not Supabase's `anon`. The
  names differ because the platform's names differ; matching Supabase
  here would make the constant lie about the SQL it emits.
- **Auth expression helpers**: `authUid()` and `authJwt()`, over
  `pg_session_jwt`'s `auth.uid()` and `auth.jwt()`. The extension exposes
  the same function names and return types Supabase does, so the helpers
  are shape-identical to the Supabase preset's — an agreement between two
  platforms, not a copy.
- **Context builders, one per authentication mode.** `pg_session_jwt`
  resolves identity from `request.jwt.claims` when no JWK is configured
  and from `pg_session_jwt.jwt` — a raw token it verifies itself — when
  one is. The two are mutually exclusive: where the database verifies a
  token itself, the claims setting is ignored outright. Both settings are ordinary
  `Userset` GUCs, so both modes are expressible through the existing
  `{role, settings}` context with no new mechanism; what differs is the
  key. The mode is stated **once**, when the preset's auth surface is
  constructed, and the builders that surface exposes are the ones that
  mode can use — the same principle as the driver's overload, applied a
  second time: a fact about the environment is fixed as data at
  construction rather than discovered by a probe. This does not make a
  wrong *declaration* impossible — a user can state the mode their
  database does not use. What it makes impossible is **mixing the two
  modes inside one codebase**, which is always a bug because a database
  has one mode, and it collapses the audit to a single line: does this
  declaration match this database?
  `asUser(claims)` keeps the Supabase preset's name (the concept is
  identical, and a second name would be a migration tax rather than
  information) and keeps its `sub` guard, because `auth.uid()` returns
  NULL rather than failing when `sub` is absent — the same silent failure
  mode on both platforms. `asAnonymous()` does **not** keep the name
  `asAnon`, for the role reason above.
  Which mode a database uses is a fact about that database, and reading
  it back would be a probe. The preset therefore documents the mismatch's
  shape instead of detecting it — and the shape has two halves, because a
  context applies a role *and* an identity. A wrong mode disables only
  the identity half: policies keyed on `auth.uid()` deny, but policies
  keyed only on the role still admit, and the request runs as a generic
  authenticated user with no identity. The second half is the one worth
  warning about, and it lands in the skill where users read, not only in
  a spec.
- **`contributedRoles`** on the driver: `authenticated` and `anonymous`,
  so `db.as(...)`'s fail-closed role allowlist admits them without a
  declaration that grants them.
- **Gate registrations**, as first-class work rather than cleanup:
  `scripts/crap-report.mjs`'s `TARGET_PACKAGES`,
  `scripts/pack-install-smoke.sh`'s `PACKAGES` and its tarball
  assertions, and `.changeset/config.json`'s fixed group (5 → 6). These
  lists are hardcoded, not derived; a new package that misses them is not
  measured and not packed, while CI stays green. That failure mode
  already has a name here (#372).
- **`.claude/rules/supabase-preset.md` becomes `provider-preset.md`**,
  scoped to an explicit list of preset packages, with `AGENTS.md`'s two
  references to it updated in the same change. Its content was always
  about providers in general; only its filename and path glob were about
  Supabase. A rule that does not load for the second preset is not a
  rule, and a root document pointing at a filename that no longer exists
  is a broken reference in the one file every session reads.

## Capabilities

### New Capabilities

None. A per-provider capability spec would establish exactly the wrong
precedent — the next preset would add a third, and the interface these
specs describe would stop being one interface.

### Modified Capabilities

- `driver-contract`: the "Presets ship their own driver" requirement
  gains its second implementation, and gains scenarios for a preset
  driver that declares a capability `false` — the case the existing
  scenarios describe abstractly but no shipped driver exercises.
- `rls-execution-context`: "Presets define the context type" currently
  enumerates the Supabase preset and the vanilla surface; Neon becomes
  the third. A new requirement covers the Neon context builders, and a
  new scenario fixes what happens when a context is requested on a driver
  that cannot open an interactive transaction.

## Impact

- **Affected code**: `packages/neon` (new) plus three gate registrations
  and one rules file rename. **No file under `packages/core`,
  `packages/query`, `packages/cli`, `packages/pg`, or
  `packages/supabase` is edited.**
- **The interface claim, stated so it can fail.** `driver.capabilities`
  is read in exactly one place in the repository
  (`packages/query/src/driver/errors.ts`), reached from exactly two
  (`db/context.ts`, `db/transaction.ts`). A driver that declares its
  capabilities as data therefore has no reason to touch
  `packages/query/src/db/`. If this change's diff touches it, the claim
  that the provider interface admits a second provider is false, and the
  right response is to fix the interface — not to special-case Neon.
- **Breaking**: none. New package; no existing package's behavior
  changes.
- **Decision log**: no decision is revisited. D95 (drivers live in preset
  packages, capabilities as data, missing capability is an explicit
  error), D96 (generic mechanism in `@hejbro/query`, context type from
  the preset), and D98 (this package's deferral) are applied as written.
- **Publishing**: `@hejbro/neon` joins the fixed changeset group, so it
  versions with the other five. The first npm publish remains an owner
  gate; nothing here changes who approves a release.

## Why the HTTP path ships with `interactive-transactions: false`

The honest declaration is the deliverable. D95's rejected alternatives
name this exact scenario — "an HTTP one-shot driver pretending to run
transactions" — and the contract already specifies that a capability
declared `false` fails closed, never "attempt it anyway". Until now no
shipped driver declared one `false`, so that requirement had a scenario
and no implementation behind it. Shipping the HTTP path is what turns
`driver-contract`'s fail-closed rule from a described behavior into a
measured one.

The consequence is deliberate and must be documented, not hidden: **RLS
contexts do not work over Neon's HTTP path**, and the reason is ours, not
Neon's. Measured: a batch containing `SET LOCAL ROLE`, a `set_config`
claims setting, and a query does apply the context correctly over HTTP,
and the context does not leak to the next call. The platform can carry
D96's mechanism.

What it cannot carry is the contract's shape. `Driver.transaction` takes
a callback that awaits between statements, so the next statement may
depend on the previous result; a batch must be assembled before any of it
runs. `interactive-transactions: false` is therefore the true
declaration, and `db.as(...)` fails on this driver — not because Neon
lacks the ability, but because the contract has no vocabulary for the
ability Neon has. That distinction belongs in the record: this is not the
"pretending" D95 rejected, and it is not a platform limit. Widening the
capability set to name batched transactions is a separate decision about
`@hejbro/query`, deliberately not taken here.

## Why the HTTP driver pins per request

`session-state: false` is honest about persistence and silent about
correctness. `@hejbro/query`'s value conversion assumes the pins
`setupSession` applies; over HTTP those pins would evaporate with the
connection that carried them, and `interval` and `bytea` values would
arrive shaped by server defaults that hejbro does not control. Nothing in
the query layer would catch it: the capability is declared truthfully,
and no code reads that capability for this purpose. A truthful
declaration that changes nothing is not a safeguard.

Batching the pins with each statement removes the divergence at its
source, inside the driver, without asking the query layer for a new
capability or a new code path. The claim the driver makes stays exactly
as strong as what it can deliver: not "state persists", but "my
statements run under my pins".

This is measured before it is relied on. The first implementation task is
a failing test that reads an `interval` and a `bytea` back over the HTTP
path; if the batch form cannot carry the pins, the HTTP driver is dropped
from this change and reopened with #483, and the WebSocket path ships
alone. That fallback is pre-approved, so the measurement decides it
without another round of approval.

## Why `@neondatabase/serverless` is a peer dependency

Not by symmetry with `packages/pg` — by the same condition that put `pg`
there, plus one Neon adds.

The condition: the driver takes a client the user constructed.
`neonDriver(pool)` never builds a connection itself, so the user already
depends on the client library directly, and a second copy installed under
`@hejbro/neon` would be a second instance, not a convenience.

Neon's addition: `neonConfig` is **global to the module instance**. The
options that make local development work at all — `wsProxy`,
`fetchEndpoint`, `fetchFunction` — are set on that global. If our copy
and the user's copy are different module instances, the user's
configuration is invisible to our driver and local development breaks
silently. A peer dependency is how a package manager is asked for exactly
one instance.

The repository's other precedent does not apply here and it is worth
saying why. `hejbro check` declares `@hejbro/pg` as **no** kind of
dependency and imports it dynamically, because most CLI commands never
connect and should not drag a driver along. `@hejbro/neon` has no such
path: wrapping the client is the entire package. The precedent's
condition is absent, so its answer is too.

## Out of scope

Each of these is excluded because Neon does not ask for it — not because
it was overlooked, and not because `@hejbro/supabase` lacks it.

- **A live round trip over the HTTP path.** Neon publishes an official
  WebSocket proxy image (`wsproxy`), and the WebSocket witness runs
  against it locally. It publishes no official HTTP proxy image; the
  guide points at a third-party one. Committed test infrastructure will
  not depend on a third-party image. The HTTP path's capability
  declarations and its missing-capability errors are fixed by pure tests;
  the round trip is stated as outside the verification boundary rather
  than implied to be covered.
- **`auth.jwt_session_init(jwt)`, the extension's own session helper.**
  It is not needed and it is weaker than what the context mechanism
  already does: the helper is a thin wrapper that runs `SET
  pg_session_jwt.jwt = …`, and that GUC is `Userset`, so the context
  mechanism sets it directly through `set_config`. The helper's `SET` is
  session-scoped and survives past a transaction on a pooled connection;
  the context mechanism's `set_config(..., true)` is transaction-local by
  construction. Calling the helper would trade D96's pooling safety for
  nothing.
- **A capability for batched transactions** (#486). Neon's HTTP path can
  run a pre-assembled batch — measured: a batch carrying `SET LOCAL
  ROLE`, a claims setting, and a query applies the context correctly and
  does not leak it to the next call. That is a real ability the contract
  has no word for. Naming it changes `@hejbro/query`'s capability set and
  belongs to whoever takes that decision, with a third provider's needs
  in view rather than this one's.
- **Wrapping `authToken`.** `@neondatabase/serverless` accepts a bearer
  token on its HTTP path, sent to Neon's proxy for verification. It is
  request-level, exists only on that path, and would put this package in
  the business of handling raw tokens — which the context specs
  deliberately keep presets out of. Users pass it to `neon()` themselves.
- **A `Preset` bundle object.** A preset bundle carries kinds and
  validators to register; this preset has neither, and an empty bundle
  would be a surface invented so a gate has something to import. The pack
  smoke asserts the package's entry point by importing a real value
  instead. If a kind ever arrives, the bundle is an additive change.
- **A reference to Neon Auth's synchronized users table.** The Supabase
  preset ships `authUsers` because `auth.users` exists in every Supabase
  project. Neon's equivalent table exists only where a separate product,
  Neon Auth, has been enabled, so a constant naming it would resolve for
  some projects and be a lie about the schema for the rest. Reopen when
  someone needs the foreign-key anchor.
- **A claims setting on the anonymous context.** The Supabase preset's
  `asAnon()` writes `{"role":"anon"}` into the claims setting; Neon's
  `asAnonymous()` writes no setting at all. Nothing on the Neon side
  reads a claims object for an unauthenticated request — the role is the
  whole context — so a setting there would be a value the database never
  looks at, which is worse than absent: it reads like an identity.
- **A custom `ObjectKind`.** Supabase has storage buckets — a resource
  outside the database that still belongs in a declaration. No Neon
  analogue was found. Inventing one to match the shape would add a kind
  with nothing behind it, and would collide with a known CLI defect
  (#482) for no gain.
- **Supabase's other validators** (exposed tables, view security
  invoker, the two RLS `auth` call checks) and the **`*Cached`
  expression variants**. These encode Supabase's documented guidance.
  Whether Neon documents the same guidance is unconfirmed, and a
  validator that fires on unverified assumptions costs users more than
  its absence.
- **A reserved-schema validator** for `neon_auth`/`auth`. Whether Neon
  actually refuses DDL against these schemas is unconfirmed; a hard error
  that is wrong is worse than no error.
- **A `service_role` analogue.** Neon's documentation has none.
- **`neon_superuser` and friends as role constants.** They are facts
  about the environment, not things a declaration names.
- **`examples/neon`.** Neon declarations are identical at the DSL level to
  `examples/postgres`; a new example would restate what two examples
  already cover.
- **A connection-string overload** (`neonDriver(url)`). It would make the
  package construct the client, which reverses the dependency argument
  above. If it is ever wanted, the dependency form is re-decided with it,
  in that order.
