# Proposal: add-prepared-statements (#303)

## Why

`compile()` is pure and deterministic, so a built statement's SQL text is
already a stable identity — yet every execution sends that text to the
server as an unnamed statement, and the server parses and plans it again
each time. The driver contract was designed for the alternative from the
start: a driver that holds a real session can prepare a statement once
per connection and bind to it afterwards, and a driver that cannot hold
session state must never pretend to. What was missing was a measured
reason and a settled shape. The measurement exists: on a local
`postgres:17`, naming the statement saved a consistent 6.6–8.4% of the
per-statement median across fifty independent runs (the effect never
reversed sign); it did not clear the pre-registered shipping bar, whose
four spread estimators split structurally, and that record was archived
as "cannot determine". The owner's rule for this pass is that a sound,
already-designed capability does not stay parked — it ships or it is
shown wrong, and nothing in the record shows it wrong.

Two things make this an opt-in rather than a default:

1. **A transaction-mode pooler breaks it silently.** A client that named
   a statement on one backend and later binds to that name on another
   backend gets `prepared statement "…" does not exist`. Supabase's
   Supavisor only carries named prepared statements across backends
   behind a feature flag hejbro cannot see. The transaction-pooler path
   already declares `session-state: false`, but the vanilla driver it
   wraps would still name statements inside the transactions the
   decorator opens — so the decorator has to be able to refuse a base
   driver that prepares, and that requires the base's behaviour to be a
   declaration, not a hidden implementation detail.
2. **A prepared statement changes how the server plans.** After a few
   executions Postgres may switch a prepared statement to a generic
   plan, which is the server's own documented behaviour
   (`plan_cache_mode`) and a real difference on skewed data. That is a
   choice a caller makes knowingly, in the spirit of explicit over
   implicit.

## What Changes

- **The capability set grows to three.** `prepared-statements` joins
  `interactive-transactions` and `session-state`; every driver declares
  it, the type forces the declaration, and every fake driver in this
  repository's tests declares it too.
- **The vanilla driver and Neon's session-path driver prepare on
  request.** `pgDriver(poolOrConnectionString, { preparedStatements:
  true })` and `neonDriver(pool, { preparedStatements: true })` declare
  `prepared-statements: true` and send every *built* statement
  (`select`, `insert`, `update`, `delete`, `setOp`) as a named statement
  whose name is derived from the statement text alone. A `sql`-kind
  statement (the escape hatch, the session pins, a migration body) is
  always sent unnamed: hejbro does not parse SQL, and a text carrying
  more than one command cannot be prepared. Without the option both
  drivers declare `false` and behave exactly as today.
- **The transaction-pooler path refuses a base that prepares.**
  `supabaseDriver(base, { endpoint: "transaction-pooler" })` fails at
  construction, with a coded error and a `Next:` line, when `base`
  declares `prepared-statements: true`; the decorated driver declares
  `false`. The session endpoint passes the base's declaration through.
  Neon's one-shot HTTP driver declares `false`; the Nile decorator keeps
  its base's declaration, as it keeps the other two.
- The user-facing skill documents the option, the exclusion of the
  escape hatch, the pooler refusal and the server's own plan-cache
  behaviour; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`driver-contract`** — MODIFIED requirements: *Drivers declare their
  capabilities* (the complete set names three), *The capability set is
  exhaustive and statically checked* (exactly three), *Vanilla Postgres
  driver* (prepared statements as stated at construction, `false` when
  not stated), *A driver's capability set follows its connection path*
  (the session path's third declaration is the caller's, the one-shot
  path's is `false`). ADDED requirements: *A driver that declares
  prepared statements names its built statements* and *A path without
  session state refuses a base driver that prepares*.

## Impact

- `@hejbro/query`: the capability key union and the fixture/fake
  declarations in its tests; the conformance kit reads only the two
  existing keys and is not extended.
- `@hejbro/pg`, `@hejbro/neon`: an options argument on the session-path
  constructors and the naming rule in their one session builder each.
- `@hejbro/supabase`: the construction-time refusal on the
  transaction-pooler path.
- `@hejbro/nile`, `hejbro` (CLI) and the examples: declarations in test
  fakes only; the CLI's apply path sends `sql`-kind texts and is
  untouched by the option.
- `skills/hejbro`: the query-layer, Supabase and Neon references.
