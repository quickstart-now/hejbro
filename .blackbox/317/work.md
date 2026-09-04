# Work — quickstart-now/hejbro#317

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — 2026-08-31 — extend-supabase-driver (#317)

_2026-08-31T00:00Z_

### What was asked for

The owner was absent for this change; the standing delegation applied, so
every decision below was taken as a delegated owner decision and is
recorded here as such.

The opening instruction was to take issue #317 (the Supabase driver's
transaction-mode pooler story) and #318 (an automatic RLS context via a
claims-provider callback) through a full OpenSpec cycle: proposal, owner
approval, tasks, TDD implementation, review, PR, archive. Two framing
constraints came with it. First, the Neon preset is the control group —
it already ships a path that declares session state `false` and carries
its settings per request — but the comparison had to establish structural
sameness before treating agreement as evidence. Second, no sentence of
the form "Supavisor does X" was to be written anywhere until it had been
measured against a local stack, with the commands and output recorded.

### What was built

`@hejbro/supabase`'s driver factory takes an optional second argument
naming the endpoint the caller already chose:
`supabaseDriver(driver, { endpoint: "transaction-pooler" })`. On that
path the driver declares interactive transactions `true` and session
state `false`, and carries the `IntervalStyle`/`bytea_output` pins inside
the same transaction as the caller's statement — for a single-statement
execution, in a transaction it opens itself. Omitting the option leaves
the previous behavior and the previous capability declaration exactly as
they were.

#318 is **not** in this change. See "The reversal that mattered most".

### Decisions, in the order they were taken

### 1. The endpoint is declared, never detected

`driver-contract` already requires a driver's capability set to be final
before any connection exists, and forbids discovering it by probing. It
also requires the path to follow "the caller's existing decision (which
client they constructed), not a second decision the driver asks them to
repeat" — written when the only known shape was a client library offering
two client types. Supabase offers one client type and two endpoints, so
that sentence's premise does not hold here.

Three alternatives were weighed. Probing is refused by the contract.
Reading the pool's connection string for a port number is not a probe but
is worse in a different way — port numbers are conventions, so the
inference is right most of the time and silently wrong the rest, in
exactly the direction this change exists to remove. Declaring the fact
costs one argument and makes a wrong declaration a visible line in the
caller's own file.

A fourth option — take the declaration as truth *and* diagnose when the
connection string contradicts it — was deliberately deferred rather than
rejected: the diagnostic's truth table depends on configurations no
measurement here covers (self-hosted stacks, proxies), and a warning that
fires on a correct configuration costs more than its absence.

Spec consequence: the existing requirement was **narrowed** to the case
it actually describes (the client value distinguishes the path) and a new
requirement covers the case it does not. Adding the new requirement
without narrowing the old one would have left two requirements in one
spec file forbidding each other — caught in review before it landed.

### 2. An unrecognized endpoint value is refused at construction

The planner's recommendation was a compile-time type error alone, on the
grounds that a runtime check duplicates what the type already prevents.
This was overruled. The argument that carried: a caller without type
checking who writes `"transactoin"` would fall through to the session
path and get a `session-state: true` declaration — reproducing exactly
the silent, intermittent, wrong-value-shape failure this change exists to
remove, and reproducing it for the caller who tried hardest to be
explicit. The check runs once, where the driver is constructed, and never
on the execution path; the error carries the code `unknown-pooler-mode`
and lists the recognized values.

### 3. The pins are restated in the preset, not delegated

Delegating to the wrapped driver's own session-setup member would reuse
its knowledge but send session-scoped `SET` — the failure this path
exists to remove — and would leave that state on a pooled backend
afterwards. Restating duplicates a list the vanilla driver also owns, so
the duplication's drift trigger was named rather than assumed: if the pin
list stops matching what value conversion needs, the value-shape
assertions in the pooler path's own tests fail by name.

### 4. The conformance kit is reported on, not repaired

The repository's driver conformance kit judges a `session-state: false`
driver by where the caller's statement lands. Handing it a capture that
includes transaction control makes it fail, because the last entry is
`COMMIT`. The observation was therefore narrowed to the driver-session
surface, and — because a narrowed observation is exactly how an
obligation can be made to pass by choosing what to look at — everything
the narrowing stops showing is asserted separately in this package's own
tests. Two findings were recorded for the kit's owner rather than fixed
here (the kit lives in the query layer): the implementation is stricter
than the requirement it implements, and its documentation names two
fixtures whose observation domains differ from each other. Filed as #528.

### Measurements

Run against a local Supabase stack with the transaction-mode pooler
enabled, each sequence executed both idle and under a pool saturated by
parallel clients. Full commands, output and the environment are in
`openspec/changes/extend-supabase-driver/design.md`.

One methodology correction changed the result and is recorded because it
would have inverted the conclusion: the first attempt pinned
`IntervalStyle` to `'postgres'`, which is the server's own default, so a
lost setting would read back as if it had held — a false negative by
construction. Every result uses a non-default value instead.

- A session-level `SET` was lost between two consecutive statements,
  together with a change of backend process, under saturation and not
  otherwise.
- `SET LOCAL` held for its transaction and expired after it, in every
  run, with the backend fixed for the transaction's duration.
- The exact statement sequence the RLS context path emits worked through
  the pooler unchanged, in every run.

The third result is why this change touches no context code, and it is
also what made #318 separable rather than a second half of the same
problem.

One inference was deliberately not drawn from the numbers: the `false`
declaration rests on the **absence of a guarantee**, not on the frequency
of the failure. Had the measurement never caught a loss, the declaration
would still be `false`.

### The reversal that mattered most

#318 was in scope at the start and was removed after two corrections, one
of which reversed the other.

The issue sketched a claims provider registered on the driver factory.
That shape cannot be built correctly: a context's role must be validated
before any statement is sent, against a union computed from the schema,
the handle's own opt-in list, and the driver's contributed roles — and
three of those four sources are unreachable from a driver value, which
carries no schema reference at all. A driver-level automatic context
could not perform that validation; it could only skip it. The
specification also forbids a preset supplying an alternative path that
applies a context another way.

The first repair was to wrap the db handle instead of the driver, so the
automation would go through the existing context path rather than beside
it. Review rejected that too, on two grounds: the preset boundary
enumerates exactly five things a preset contributes and a handle wrapper
is a sixth, and calling `handle.as(...)` at run time is a structural
dependency on the query layer regardless of the import being type-only.

The observation that settled it: implemented where the specification
points — a generic context provider in the query layer — the Supabase
preset contributes no new code at all, because `asUser(claims)` already
produces the context value such a provider would supply. #318 is
therefore a query-layer feature that was filed against the preset. It was
removed from this change and re-scoped rather than built in the wrong
place.

### Corrections made during review

Recorded because each was a claim this change made before checking it.

They share one shape, and the shape is worth naming for the next change:
**the code was right every time; the prose ran ahead of it.** Not one of
the corrections below changed what the driver does. Each changed a
sentence that claimed more than had been measured — a suppression that
never happened, a precedent that did not exist, a guarantee the type
system did not give, a cost stated at half its size. The review that
caught them worked by measuring the claim rather than reading it, which
is the only method that would have.

- **"The pooler path bypasses the vanilla driver's checkout pin."** False.
  Measured on the landed code: the session-scoped pin still runs. The
  vanilla driver reads its session-setup member late but from an object
  it captured, so a decorator that returns a new object is never
  consulted. The claim became "this path stops depending on that pin; it
  does not suppress it", with the cost stated. Filed as #531 — and
  re-characterized once more after review: the vanilla driver documents
  the case it supports (assignment onto the returned object), so the gap
  is in a contract sentence that does not distinguish that pattern from
  building a new value, not in an implementation.
- **"Both shipped drivers already observe at this surface."** False. One
  is checked on the other tier, where the question cannot arise; the
  other has no textual transaction control to exclude. This change is the
  first to draw the line, and said so.
- **"The endpoint list and its type can never drift apart."** False as
  written: adding a value to the union alone compiled. The type is now
  derived from the list, and the comment was narrowed to what that
  actually buys — the natural edit path is drift-free, not drift-proof
  against someone widening the derived type deliberately.
- **"Declaring the pooler path on a session endpoint costs one extra
  `SET LOCAL` pair and nothing else."** Understated by half. Measured:
  four extra statements, and a single-statement execution moves from
  autocommit into an explicit transaction. Corrected in the user-facing
  reference, where the number is what a reader sizes capacity with.

### Process notes

- Three of twelve implementation tasks never had a failing stage. A task
  whose subject is "this existing property still holds" cannot start from
  a red test unless the property is broken first. All three were then
  shown by mutation to be real regression locks, but they should have
  been written as regression locks with their trigger named, not as TDD
  tasks. Recorded as a planning lesson.
- Handoff tags collide across teams because tags are a repository-global
  namespace. The convention settled on `handoff/<change-id>-g<N>[-rN]`,
  and the rule that a tag named in a handoff message is immutable —
  because what freezes is not the name but the name-to-SHA reference
  already exchanged. One tag was moved after being handed off; the fix
  was to correct the reference forward rather than move it back, and to
  stop sending handoffs before the pushed state has been read back from
  the remote.

Migrated from the single-file entry `.blackbox/2026-08-31-extend-supabase-driver.md`, kept verbatim at `.blackbox/317/artifacts/2026-08-31-extend-supabase-driver.md`.

