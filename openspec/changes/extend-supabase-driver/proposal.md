# Proposal: extend-supabase-driver

## Why

`@hejbro/supabase` ships one driver decorator, and it carries an
assumption it never states: that the pool it was handed points at a
**session-mode** endpoint. On that assumption it passes through
`@hejbro/pg`'s capabilities untouched — interactive transactions `true`,
session state `true` — and lets the vanilla driver pin `IntervalStyle`
and `bytea_output` once per checked-out connection.

Supabase's transaction-mode pooler breaks the second half of that
assumption, and it breaks it in the worst available shape: **silently
and intermittently**. Measured against a local stack (see *Verification
boundary*): under a saturated pool, a session-level `SET` was observed
landing on one backend and the next statement arriving on another, with
the setting reverted to the server default — and the same sequence run
without concurrency kept its setting through five rounds. Loss of the
pin and reassignment of the backend were observed **together**, never
apart.

Our own half of the failure is not conditional at all. The pin is sent
once per `PoolClient` object and remembered in a `WeakSet` keyed on that
object, and the contract specifies that a connection already pinned is
not pinned again. So when the endpoint puts a different backend behind
the same client object, nothing in the driver can notice: it has already
recorded that client as pinned. Later statements run unpinned, and
`interval` and `bytea` values arrive shaped by the server's defaults.
Nothing in the query layer catches it either, because the capability
declaration says the state persists, and that declaration is the only
thing the layer above reads.

The intermittence is what makes this worth fixing rather than
documenting. A failure that needs a saturated pool to appear is a
failure that passes every low-traffic test and arrives in production
under load, in a value's *shape* rather than as an error.

The declaration is the deliverable here, as it was for the second
provider. The contract already has the vocabulary: a driver may declare
session state `false` and is then obliged to carry the settings with
every execution. One shipped driver already does this — the Neon HTTP
path — but only in combination with interactive transactions `false`,
which is the easy half. A transaction-mode endpoint is the first case in
this repository where a driver keeps a real connection **inside** a
transaction and loses the session **between** transactions — both halves
measured — and that combination is what turns the contract's two
capability keys from a pair of aliases into two independent facts.

**Approval basis.** This is a parked follow-up of the query-layer design
round, filed as an issue at the time, and it sits inside the current
phase's gate. Nothing here revisits a settled decision: the capability
set is not extended, no capability is discovered by probing, and the
existing single-argument surface keeps its behavior.

## What Changes

- **The Supabase driver takes an options object**, and its default
  behavior is unchanged: `supabaseDriver(driver)` continues to decorate
  a driver with Supabase's three contributed roles and nothing else.
- **A transaction-mode pooler option** selects the second path. On that
  path the driver declares interactive transactions `true` and session
  state `false`, and carries the session pins with every execution,
  transaction-locally, instead of relying on a per-connection pin the
  endpoint does not reliably keep.
- **The path is declared, never detected.** The option is the caller
  stating a fact about the endpoint their connection string already
  chose. The driver reads no connection string, inspects no pool option,
  and sends no probe statement to find out.
- **Pins move to transaction-local scope on the pooler path.** The
  vanilla driver's once-per-checkout pin is bypassed on this path — the
  preset replaces the driver value's own session-setup member, which the
  contract already specifies is invoked late-bound at every checkout —
  and the pins are sent as the first statements inside the same
  transaction as the caller's statement, so no statement can run on a
  backend that did not receive them.
- **A single-statement execution opens its own transaction on the pooler
  path.** Transaction-local pins require a transaction to be local to;
  the alternative — session-scoped pins — is the failure this path
  exists to remove.
- **A caller's own `transaction(callback)` carries the pins as that
  transaction's first statements**, not as a second transaction around
  it. The pooler path adds no nesting and therefore never turns a
  supported call into the unsupported nested-transaction case.
- **The hejbro skill's Supabase reference gains the new surface**,
  together with the endpoint-to-capability mapping the issue asks for:
  which Supabase connection path maps to which capability values, what
  goes wrong when the declaration and the endpoint disagree, and the
  endpoint-dependent behaviors a user meets when they switch (including
  the ones this change deliberately does not implement).

## Capabilities

### New Capabilities

None. This change exercises capabilities that already exist; a
per-provider or per-endpoint capability spec would fragment the one
interface these specs describe.

### Modified Capabilities

- **`A driver's capability set follows its connection path`** is
  modified, not merely supplemented. Its current text requires the path
  to follow the client the caller constructed and forbids "a second
  decision the driver asks them to repeat" — written when the only known
  shape was a client library offering two client types. Adding a
  requirement beside it without touching it would leave two requirements
  in one spec file forbidding each other. The existing requirement is
  therefore narrowed to the case it actually describes — a provider
  **whose client value distinguishes the path** — with its force
  unchanged for that case.
- **A new requirement** covers the case it does not: a provider whose
  paths differ in capability but are **indistinguishable in the client
  value**. There the fact is stated by the caller, once, at
  construction, and still never discovered by the driver — neither by
  probing a connection nor by inspecting a connection string's host or
  port.
- **`Presets ship their own driver`** is modified for its second
  Supabase path, following the pattern the second provider already set:
  the existing scenario keeps its subject (the session path) and the
  pooler path arrives as its own scenario alongside it.
- **`A driver without session state guarantees its own statements`**
  gains its first scenario where interactive transactions are `true` at
  the same time, plus a scenario fixing that a preset driver's rows
  arrive in the vanilla shapes on the pooler path — the regression this
  change's pin rework must not cause.

## Impact

- **Affected code**: `packages/supabase` only, plus the skill reference
  and one changeset. **No file under `packages/core`, `packages/query`,
  `packages/pg`, or `packages/cli` is edited.** That boundary is a claim
  this change can fail: the preset interface is supposed to admit a
  second connection path without the query layer knowing, and the
  contract already specifies that a preset's replacement of the
  session-setup member takes effect at every checkout. If the pooler
  path needs an edit inside the query layer, the interface is wrong and
  the right response is to say so, not to make the edit.
- **Breaking**: none. The existing single-argument call keeps its exact
  behavior and its capability declaration; the new path is opt-in.
- **Publishing**: one `minor` changeset. The six published packages move
  together as a fixed group, so one changeset naming this package moves
  them all.

## Verification boundary

Every claim in this change about what a Supabase endpoint does with
`SET` versus `SET LOCAL` — **including the claims in this document** —
is measured against a local Supabase stack before it is asserted
anywhere: in this proposal, in a spec scenario, or in a source comment.
The measurement's commands and output are recorded in `design.md`.

**Measured**, against a local stack with the transaction-mode pooler
enabled, each sequence run both without concurrency and under a pool
saturated by parallel clients:

1. A session-level `SET` of a non-default value was lost between two
   consecutive statements, together with a change of backend process —
   under saturation, and not otherwise. This is the intermittence the
   issue's "does not reliably persist" names.
2. A `SET LOCAL` inside a transaction held for that transaction's
   statements and was gone in the next one, with the backend fixed for
   the duration of the transaction, in every run — saturated or not.
3. The exact statement sequence the context path emits — `SET LOCAL
   ROLE`, a parameterized transaction-local claims setting, then the
   caller's statement — applied correctly through the pooler in every
   run, with the identity function resolving the subject, RLS filtering
   as declared, and role and claims restored after commit.

That third result settles a question this change would otherwise have
had to guess at: **the RLS context path is not what breaks under the
pooler.** It is already transaction-local by construction, and the
measurement confirms it survives the endpoint that loses session state.
Only the once-per-connection pin breaks, which is why this change is
about pins and capability declarations and touches no context code.

One inference is deliberately not drawn from these numbers. The
`false` declaration rests on the **absence of a guarantee**, not on the
frequency of the failure. A transaction-mode pooler is free to hand back
the same backend when nothing else is contending for it, so a run in
which a `SET` survives is evidence about the load at that moment, not
about the endpoint's contract — which is exactly why the idle runs above
are reported and then not used as counter-evidence. Had the measurement
never caught a loss, the declaration would still be `false`: a driver
cannot promise the query layer a persistence the endpoint never
promised it.

Not measured, and therefore not asserted: Supavisor's internal pooling
behavior beyond the above (where saturation begins, how backends are
chosen), and the session-mode pooler endpoint.

## Why the pooler path is declared and not detected

Three ways to learn the endpoint were considered; one is refused by the
contract, one is refused on its merits, and a fourth is deferred rather
than dismissed.

Probing — sending a statement, or opening a connection, to see how the
server behaves — is refused by the contract itself: a driver's capability
set is final before any connection exists. A capability discovered by
asking the database can change under the caller's feet between two
executions, and the point of declaring capabilities as data is that the
layer above reads them without I/O.

Inspecting the pool's own connection string for a port number is not a
probe. It is bad in a different way: it is a guess that reads like a
fact. Port numbers are conventions, not guarantees — a self-hosted
stack, a proxy, or a custom Supavisor deployment moves them — so the
inference is right most of the time and silently wrong the rest, in
exactly the direction that matters. A wrong "session state persists" is
the failure this change exists to remove; reintroducing it as a
heuristic would be a poor trade for one saved argument.

The fourth option is neither of those: **take the declaration as truth,
and additionally diagnose when the connection string contradicts it.**
That is not detection — the declared value still decides behavior — and
it fits the project's posture of telling the user what it sees rather
than acting on it. It is left out of this change for one reason: a
warning that fires on a correct configuration costs more than its
absence, and the configurations that would trip it (self-hosted stacks,
proxies) are exactly the ones no measurement here covers. It is recorded
so that adding it later is an addition, not a reversal.

What remains is the caller stating the fact. The cost is one explicit
option; the benefit is that a wrong declaration is a visible line in the
caller's own file rather than an inference buried in a library.

## Out of scope

- **Detecting the endpoint**, by any means. Covered above; reopening it
  requires a decision that the contract's "final before any connection"
  rule is wrong. The declare-and-diagnose variant is deferred, not
  rejected, on the terms stated there.
- **A capability key for "session state within a transaction only."** The
  existing two keys already express this combination: interactive
  transactions `true`, session state `false`, with the settings carried
  per execution. Adding a third key would break every driver's
  declaration, in this repository and outside it, to name something the
  pair already names.
- **The automatic RLS context layer.** Parked as its own issue and
  deliberately not carried here. The measurement above is the reason it
  can be separated cleanly: the context path does not break under the
  pooler, so the two are independent problems rather than two halves of
  one. Its correct home is the generic mechanism, not this preset —
  where a context provider plugs in, the concrete context surface a
  preset supplies is already enough, and this preset would contribute no
  new code at all.
- **A session-mode pooler distinction.** The session-mode endpoint was
  **not** measured — only the direct connection and the transaction-mode
  pooler were. It is excluded because the existing declaration already
  describes a session-keeping endpoint, so a user on that endpoint needs
  no option and gets none; the exclusion rests on that, not on a claim
  about the endpoint's behavior. A user who suspects otherwise has the
  same remedy this change gives everyone: declare the pooler path, which
  is correct on any endpoint and merely costs one extra statement per
  execution where the session would have held.
- **Prepared-statement behavior under the pooler.** It belongs to the
  client library's configuration rather than to a capability the query
  layer reads, so no code here changes for it — but it is one of the
  endpoint-dependent behaviors the skill reference documents, because a
  user switching endpoints meets it.
- **An `examples/` addition.** The declarations are unchanged; what
  changes is how a driver is constructed, which the skill reference
  documents.

## The conformance kit, and where this change observes

The repository's driver conformance kit reads a driver's own declared
tier and applies that tier's obligation. Its `false`-tier obligation is
implemented as "the caller's own statement is the last thing sent for
one execution, with something ahead of it" — written when no driver held
a transaction open while declaring session state `false`. Measured, not
assumed: handing the kit a capture that includes transaction control
(`BEGIN`, pins, the caller's statement, `COMMIT`) makes it fail, because
the last entry is `COMMIT`.

The observation handed to the kit is therefore taken at the **driver
session surface** — the statements that pass through the contract's own
`execute`, which is where a `CompileResult` reaches a driver — and not
the transaction control the driver issues around them. The justification
is the domain, not a precedent: transaction control never travels as a
`CompileResult` and never crosses the `execute` contract, and the kit's
own statement type is documented as carrying the same two fields a
`CompileResult` carries onward to a driver.

It is worth being exact about what this is **not**. No shipped driver
sets this precedent: the vanilla driver is checked on the `true` tier,
where the observation is the setup hook by definition and no envelope
question exists, and the other `false`-tier driver is captured at its
transport with no textual transaction control to exclude. This change is
therefore the first to draw the line explicitly, and it pays for that by
covering, itself, everything the narrowed observation stops showing.

Two things the kit then cannot see, both fixed directly in this
package's own tests rather than inferred from a green kit:

- that the pins and the caller's statement reach the database inside
  **one transaction** — a pin in a different transaction would be
  worthless and would still satisfy the kit;
- that the pins are sent **after** the transaction opens — a
  transaction-local setting issued outside a transaction block warns and
  is discarded, which is PostgreSQL's documented behavior rather than a
  measurement of this change's own, and it produces exactly the silent
  no-effect this path exists to remove.

The second is invisible to any session-level observation by
construction, because the statement that opens the transaction is not
one of the statements a session-level observation records. So the
division of labor is stated rather than left implied: the kit checks
order within the contract's own surface, and this package's tests check
the position of the pins relative to the envelope. The kit's verdict is
necessary, never sufficient.

The kit is not modified here. One finding is recorded rather than acted
on: the specification describes this tier's check as verifying that
*some statement precedes* the caller's own, while the implementation
additionally requires the caller's statement to be *last*. The
implementation is stricter than the requirement it implements. Nothing
in this change depends on which of the two wins, because the observation
above satisfies both; reconciling them belongs to the kit's owner, with
a third driver's needs in view rather than this one's.
