# Proposal: generalize-context-application

## Why

`db.as(context)` was designed against one platform's shape and generalized
once, to a second that shared it. Supabase and Neon both express an
execution context as *a role plus JWT claims*, and both accept the same two
statements: `set local role "X"`, then `select set_config($1, $2, true)` per
setting. `packages/query/src/db/context.ts` therefore hardcodes exactly that
sequence (`roleStatement`, `settingStatement`, `applyContext`), and
`DbContext` makes `role` mandatory.

The third preset measured that assumption and it does not hold. On Nile:

- `set local role "X"` is a **silent no-op** — the server answers
  `WARNING: GUC 'role' cannot be changed and the current setting is kept`,
  not an error. It also **blocks** the tenant setting that follows it.
- `select set_config('nile.tenant_id', …, true)` is **permanently
  rejected**: `ERROR: changing nile.tenant_id within a transaction is only
  allowed before any queries are performed` — and `set_config` is itself a
  query, so no ordering rescues it. The one working form is `SET LOCAL
  nile.tenant_id`, sent as the **first statement after `BEGIN`**.
- `DbContext.role` is mandatory and Nile has **zero application roles** to
  name. This is not a gap that closes later. Nile's own compatibility page
  lists `CREATE ROLE` as unsupported ("Developer roles can be supported in
  Nile's console when we support it"), and its published authorization
  design assigns policy bundles to principals over an HTTP API
  (`POST /workspaces/{workspace}/access/policies`) — so a role never
  becomes SQL a declaration could emit, on the roadmap either.

Every one of these is a fact about a platform, and the contract has no way
to hear it. That is the definition of the wrong seam: `@hejbro/query`
decides *how a context becomes statements* for platforms it has never seen.

**Half of this change is security, not ergonomics.**

1. On Nile, the `set_config` path **silently bypasses the platform's own
   tenant-authorization check**. The same value sent as `SET LOCAL
   nile.user_id` is refused (`ERROR: user is not authorized to access this
   tenant`); sent through `set_config` it is accepted and the query runs
   under that identity. hejbro sends every setting through `set_config`, so
   hejbro's path is precisely the path that disarms the platform's check.
   [MEASURED, container-only — no first-party source speaks to it in either
   direction, so it is treated conservatively rather than as settled.]
2. Nile is **fail-open without a context**: a connection with no tenant
   context reads across all tenants. RLS is fail-closed, so every existing
   assumption in this repository points the wrong way here — an unapplied
   context is a data-leak-grade bug, not a no-op. [Confirmed three ways:
   two documentation statements and the vendor SDK's own no-context pool.]
   A pooled connection that carries a *leftover* session-level tenant
   setting makes it worse than "everything": the query then runs **as
   somebody else's tenant**, and whether Nile's own pooler resets that
   state is not answerable from any public source (recorded as
   `SOURCE-UNDECIDABLE`).

A driver must therefore be able to say two things it cannot say today:
*this is how my platform takes a context*, and *never run anything on me
without one*.

**Approval basis.** Owner ruling, 2026-08-31, in session: direction D+A —
this change precedes and gates #301, carried by the same piece team, with
the vendor-SDK cross-confirmation feeding the design rather than gating the
direction. Nothing here revisits a decision: D95 (drivers live in preset
packages, capabilities as data), D96 (generic mechanism in `@hejbro/query`,
context type from the preset) and add-context-provider's resolver are
applied, not amended — D96's "generic mechanism" is exactly what is being
made generic, having so far been generic over two platforms that agreed.

## What Changes

- **The driver contributes the statements, the query layer still owns the
  transaction.** A driver gains an optional way to render a `DbContext`
  into an ordered list of `CompileResult`s. `@hejbro/query` keeps every
  responsibility it has today: it validates the context, opens the one
  fresh transaction, sends the contributed statements **first and in the
  given order**, and then runs the caller's work on the same session.
  The driver never opens a connection or a transaction of its own for
  this, and it never sends anything itself — it returns statements.
  `[design]` settles the exact member name and signature.
- **Today's sequence becomes the default contribution.** A driver that
  contributes nothing gets `set local role "X"` followed by one
  `select set_config($1, $2, true)` per setting, byte-identical to today.
  `@hejbro/pg`, `@hejbro/supabase` and `@hejbro/neon` are therefore
  unchanged in behavior, and that is asserted, not asserted-by-absence.
- **A role stops being mandatory — without weakening the whitelist.**
  `DbContext.role` becomes optional, and the fail-closed rule is restated
  so it cannot be diluted: a context that *names* a role is validated
  against the same four-source whitelist, unchanged, before any I/O. A
  context that names none is admitted **only** if the driver declares its
  platform has no roles; on any other driver it is an explicit error, not
  a permissive default. `[design]` settles how that declaration is spelled.
- **A driver can declare a context mandatory.** For a fail-open platform,
  the driver declares that no statement may run without a context;
  `@hejbro/query` then refuses every uncontexted execution surface at its
  own layer, before anything reaches the database, with a named error and
  a `Next:` remedy. The check is the driver's declaration read as data —
  never a probe, never a heuristic about the platform.
- **Spec deltas**: `rls-execution-context` (context application becomes a
  driver contribution; role optionality; the context-mandatory rule) and
  `driver-contract` (the two new driver-declared properties, and the
  ordering guarantee the query layer owes a contributing driver).
- **What explicitly does not move: the capability gate.** A context still
  requires `interactive-transactions`, checked before anything else and
  before a resolver is consulted, so a driver that cannot hold a
  transaction open (`@hejbro/neon`'s HTTP path) still cannot run a context
  — and still fails with the same missing-capability error. Widening a
  contribution point must not quietly widen who may run a context; if this
  change moves that boundary, that is a behavior change, not a
  generalization, and it is out of scope here.

## Capabilities

### New Capabilities

None. Neither addition is a `DriverCapabilityKey`: capabilities answer
"can this driver do X", and both of these answer "what does my platform
require" — a declaration about the environment, in the same spirit as
`contributedRoles`, which is likewise not a capability.

### Modified Capabilities

- `rls-execution-context`: the requirement that fixes the applied
  statements moves from "these two statements" to "the driver's
  contribution, applied first, in order, inside the query layer's
  transaction", with the default contribution named so the existing
  behavior stays specified. New scenarios: a role-less context on a
  role-less driver (admitted), a role-less context on a role-bearing
  driver (refused), a named role on any driver (whitelist unchanged), and
  an uncontexted execution against a context-mandatory driver (refused).
- `driver-contract`: gains the context-rendering contribution and the
  context-mandatory declaration, both as data on the driver, plus the
  ordering guarantee the query layer owes in return.

## Impact

- **Affected code**: `packages/query` only. **No file under
  `packages/core` is edited** — if this change needs one, the seam being
  moved is the wrong seam and the right response is to stop.
  `packages/pg`, `packages/supabase`, `packages/neon` are unchanged in
  behavior; their own test suites gain regression pins that fix today's
  statements before the generalization lands.
- **The claim, stated so it can fail.** This change is a generalization,
  so the falsification is lexical: **no identifier, string, or comment in
  `packages/query/src` may name Nile, a tenant, or any other
  platform-specific concept.** If one appears, this is a special case
  wearing a generalization's clothes, and the review should fail it on
  that ground alone.
- **Breaking**: none intended. `DbContext.role` widening from required to
  optional is source-compatible for every caller that passes one; the
  new driver members are optional. Existing drivers keep their exact
  statement sequence via the default contribution.
- **Publishing**: one `minor` changeset; the fixed group moves together.

## Why the driver returns statements instead of applying them

The tempting shape is `driver.applyContext(session, context)` — hand the
driver the session and let it do the work. It is rejected for three
reasons, all of which the repository has already paid for once.

1. **Transaction ownership would move with it.** `db.as()` and the
   registered provider both guarantee that the context and the caller's
   work share one transaction on one connection, and that the context is
   applied *first*. If the driver does the sending, that guarantee becomes
   a convention each driver re-implements, and the next Nile — a platform
   where ordering is load-bearing — depends on three implementations
   agreeing.
2. **Observability.** Statements that flow through the query layer's own
   `sendCompiled` carry its error contract (`query-execution-failed`) and
   are visible to the driver-conformance kit at the contract's execute
   domain. Statements a driver sends privately are visible to nobody.
3. **Testability without I/O.** A contribution that is a pure function
   from `DbContext` to statements can be asserted exactly, in a unit test,
   with no database and no stub protocol — which is what makes "the tenant
   setting is the first statement" a checkable claim rather than a hope.

## Why `set_config` cannot simply be replaced everywhere

Not with one global switch to `SET LOCAL`, because the two forms are not
interchangeable and the difference is not cosmetic. `set_config($1, $2,
true)` carries its value as a **bind parameter**; `SET LOCAL` cannot, so a
driver contributing `SET LOCAL` must interpolate — and therefore owns the
quoting. That is an argument for the contribution being per-driver (each
platform's own driver takes responsibility for its own form), and an
argument against a repo-wide swap. Two measured facts bound the risk: the
value interpolation is needed **only** for the `SET` statement itself —
every following statement in the same transaction parameterizes normally,
including prepared statements — and the platform that motivated this
type-checks its own setting server-side. The general rule stays with the
driver: a contributed statement that interpolates is the contributing
driver's own safety obligation, stated in the spec.

## Out of scope

- **`@hejbro/nile` itself** (#301). This change ships no preset. It is
  verified by the drivers that already exist plus tests, not by the one
  that motivated it — a generalization that needs its motivating case to
  be demonstrated is not general.
- **A batched-transaction capability** (#486) and the conformance kit's
  own generalization (#528). Both are adjacent and both stay closed here.
- **Anything a cloud account would settle.** Whether the motivating
  platform's pooler binds connections per tenant or per database is
  recorded as `SOURCE-UNDECIDABLE` and is deliberately *not* a premise of
  this design: the transaction-local form is correct under either answer,
  which is why it was chosen over the vendor SDK's connection-scoped form.
- **Changing what a role means where roles exist.** The whitelist, its
  four sources, and its fail-closed behavior are untouched.
- **Reading a platform's shape at runtime.** No probe, no capability
  discovery, no error-text sniffing — every new fact enters as data the
  driver declares before any connection exists.
