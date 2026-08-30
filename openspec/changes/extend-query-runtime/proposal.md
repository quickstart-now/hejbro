# Proposal: extend-query-runtime

## Why

Two deferrals parked at the query-layer v1 cut (D98) come back together
because they are the same seam: what the runtime knows about the
database it is talking to, and how it talks to it.

- **A runtime handle types its queries from declarations and never
  checks them** (#302). `db(schema, driver)` trusts that the connected
  database matches the declarations it was built from. When it does not
  — a migration that never ran, a database pointed at the wrong branch —
  the failure surfaces later as an arbitrary SQL error from whichever
  statement happened to touch the drifted object first, if it surfaces
  at all.
- **Every execution recompiles, and no statement is ever prepared**
  (#303). `compile()` is pure and deterministic, so its output is
  cacheable by construction; `@hejbro/pg` sends `{ text, values }` with
  no statement name, so Postgres re-plans every statement. Both are
  costs paid on every call, and neither has ever been measured here.

## What Changes

### A. A db handle can assert the database matches its declarations (#302)

- **Terminology, corrected up front.** `hejbro verify` checks the
  on-disk migration chain and never connects to a database; the command
  that compares declarations against a live database is `hejbro check`.
  The assertion reuses `check`'s semantics, not `verify`'s.
- **Opt-in and explicitly awaited.** Nothing happens when `db()` is
  called. The assertion is a call the user writes and awaits, so the
  cold-start cost is visible at the call site rather than buried in
  handle construction.
- **Fails before any query runs.** On divergence it throws a coded
  hejbro diagnostic carrying the per-object findings `check` already
  produces — findings per object, never a diff — with a `Next:` clause
  naming the migration to apply.
- **Coverage is `check`'s coverage, and it says so.** The assertion
  states the boundary of what it compared, the same obligation
  `cli-commands` already places on `check`; it does not grow a second,
  differently-scoped notion of "matches".
- **The handle keeps what it was built from.** `db()` today classifies
  the schema module down to tables and functions; every other
  declaration (enums, views, grants, policies, triggers, sequences) is
  discarded. The assertion needs the whole declaration list, so the
  handle retains it.
- **One definition, not two.** The catalog reader and the comparison
  are not reimplemented. Which package hosts them is the change's one
  structural question (see Open decisions).

### B. Prepared-statement caching, measured before it ships (#303)

- **Measurement is the first deliverable, and it gates the rest.** A
  benchmark against a real Postgres over `@hejbro/pg`'s session path
  compares (i) today's unnamed text execution against a named prepared
  statement, and (ii) recompiling a statement against reusing a cached
  compile. Reported as the command, the iteration count, and the spread
  — never as an adjective.
- **Nothing ships on an unmeasured path.** The measurement covers the
  session (TCP) path and the one-shot path separately, because a driver
  that cannot hold session state cannot prepare at all and must not
  pretend to.
- **If the win shows, a driver capability gates it.** Support becomes an
  explicit, exhaustively declared capability: a driver that cannot
  prepare declares it false and fails closed, exactly like every other
  capability. The conformance kit observes the new capability's
  obligation, so a driver that declares it true and does not honour it
  is caught in this repository rather than in a user's application.
- **If the win does not show, nothing ships but the measurement.** The
  numbers land in the change record and the issue, and the capability is
  not invented to hold a benefit that was not there.

## Capabilities

### Modified Capabilities

- `query-execution`: adds the startup assertion — its opt-in shape, its
  fail-before-first-query guarantee, its coverage statement, and the
  declaration retention that makes it possible.
- `driver-contract`: adds the prepared-statement capability, its
  fail-closed behaviour, and the tier obligation the conformance kit
  checks. **Conditional on B's measurement.**

## Impact

- **Affected code (A)**: `packages/query/src/db/db.ts` (declaration
  retention), the assertion's own module, `packages/cli/src/check/*`
  (reuse — the exact edit depends on the hosting decision below),
  `skills/hejbro` query reference, a live witness under
  `packages/pg/test/*.integration.test.ts`.
- **Affected code (B)**: a new benchmark harness (none exists in this
  repository today), `packages/query/src/driver/contract.ts`,
  `packages/query/src/testing/driver-conformance.ts`,
  `packages/pg/src/driver.ts`, and every in-repo driver's capability
  literal.
- **Breaking**: adding a capability key is a compile-time break for
  every driver author, in this repository and outside it — that is the
  designed behaviour of an exhaustive capability record, not a
  regression. No runtime behaviour changes for an existing caller: the
  assertion is opt-in and prepared statements are gated.
- **Decision log**: no new row is expected. Both items are parked halves
  of D98 landing as planned; the hosting decision under A is a layer
  question resolved inside this change, and is recorded here rather than
  as a new decision unless it moves code out of `packages/cli`.

## Open decisions

Settled before implementation starts.

1. **Where the live-comparison machinery lives.** The catalog reader
   (fifteen `pg_catalog` queries, validated with zod) and the comparison
   both sit in `packages/cli/src/check/`. Neither touches the
   filesystem; both already take `@hejbro/query`'s `DriverSession`. But
   `packages/cli` depends on `@hejbro/query`, so the query layer cannot
   import them. Either they move down into `@hejbro/query` (which today
   has exactly one runtime dependency, `@hejbro/core`, and would gain
   zod), or the assertion is hosted in `hejbro` — whose runtime entry
   re-exports core and the query layer and is already free of the CLI's
   filesystem code — and reuses them in place.
2. **Which surface the user calls.** A free function taking the handle,
   or a member on the handle. Follows from (1): a handle member requires
   the query layer to host the machinery.
3. **Where the comparison gets its registry.** Building a snapshot from
   declarations needs a `KindRegistry`, and presets contribute kinds.
   The assertion therefore takes the registry the project uses, or
   defaults to core's, and the choice decides whether a preset user's
   objects are compared or silently skipped.
4. **The success threshold for B's measurement**, and what happens at or
   below it — capability contract only, or nothing at all.
5. **Whether compile caching is in scope at all.** Reusing a cached
   compile needs a stable key for a statement, and the chain surface
   builds a fresh statement object per call, so a structural key can
   cost what compiling costs. A user-held prepared statement handle
   would give a real key; that is a larger surface than #303 asks for.
6. **Coordination for the new capability key.** Adding it obliges every
   in-repo driver's capability literal to declare it, including drivers
   this change does not otherwise touch.

## Verification note

The claims that matter here cannot be made by a fixture driver.

For A, the claim is that a *real* divergence is caught before a query
runs: the live witness applies declarations, drops or alters one object
directly in the database, and asserts the assertion throws with the
object named — and that the same assertion passes against an untouched
database, so the witness is not self-fulfilling.

For B, the claim is a performance one, and a fixture driver cannot make
it at all. The measurement runs against a real Postgres, reports the
command and the spread, and is reproducible from the change record.
