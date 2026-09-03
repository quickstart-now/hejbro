# Proposal: harden-query-conformance

## Why

Four defects sit on the query layer's own conformance surface. Three are
implementations disagreeing with a contract sentence that is already
right; one is a contract sentence describing something that cannot
happen. They ship together because they are one review's worth of the
same subject — what the layer promises about drivers, joins, and set
operations — and one pull request costs less than four.

1. **The conformance kit is stricter than the requirement it
   implements.** The contract says a `session-state: false` driver's
   check observes that *some statement precedes* the caller's own; the
   kit additionally requires the caller's statement to be *last*. A
   driver that wraps the execution in a transaction sends `COMMIT` after
   it and is dropped by a check it conforms to. The gap was recorded,
   not acted on, when the pooled-transaction path shipped.

2. **The kit cannot see the transaction envelope, and for one shipped
   driver that is where the obligation lives.** A driver declaring
   interactive transactions `true` and session state `false` must send
   its settings *inside* the transaction that carries the caller's
   statement — sent before the transaction opens, a transaction-local
   setting is discarded with a warning and the execution runs unpinned.
   The kit's observation is taken at the driver's execute contract,
   where a transaction's own opening never appears, so both placements
   look identical to it. Today that hole is covered by one preset's own
   hand-written test; the obligation belongs to the check every driver
   in this repository runs.

3. **The checkout requirement promises a late binding that does not
   exist.** The vanilla driver reads its session-setup member from its
   own driver value at every checkout. What is read late is the
   *member*; *which object* it is read from is fixed when the driver is
   built. A decorator that spreads the driver into a new value carrying
   its own hook is therefore never reached from the base's checkout —
   correctly, and contrary to what the requirement says. The shipped
   preset decorator already runs its own hook itself for this reason.

4. **A whole-table projection under a join renders unqualified
   columns**, while the corpus scenario for that construct promises
   every projected column stays schema-qualified. Qualification is what
   makes the projection unambiguous once a second table is in scope.

5. **A core-built set operation loses its row type at `execute()`.** The
   corpus fixes the combined row as the left branch's, without
   restricting that to one of the two ways a set operation is built; the
   chain path types it and the handle path falls back to the driver's
   raw row shape.

## What Changes

- **The kit's `false`-tier obligation becomes the sentence it
  implements**: a statement precedes the caller's own, and nothing is
  claimed about what follows it.
- **The kit gains a transaction-envelope obligation** for drivers
  declaring interactive transactions `true` and session state `false`:
  the transaction opens, the settings follow, the caller's statement
  follows them, and no transaction ends in between. The observation for
  such a driver is taken where the driver's own transaction control is
  visible; an observation that cannot show it is refused rather than
  passed. Recognizing a transaction boundary reads SQL's own
  transaction-control statements only — the kit still reads no driver's
  settings text, and the check stays on the wire the driver emits rather
  than moving to a surface where the envelope is invisible.
- **The checkout requirement states the binding that exists**: the
  supported decoration is replacing the member on the driver value
  itself; a decorator that returns a new value runs its own hook.
  No driver code changes.
- **A whole-table projection is schema-qualified when the select
  carries a join**, in the same form an object projection already
  renders. A join-free select's SQL is unchanged, byte for byte.
- **`execute()` resolves a core-built set-operation stage** to the left
  branch's declared row shape — the projection that stage carries —
  instead of the driver's raw row shape.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`Every declared tier's obligation is machine-verified in this
  repository`** gains the transaction-envelope obligation and the
  refusal of an envelope-blind observation for the tier that needs it.
  A driver outside this repository is unaffected: the check is
  repo-internal and unpublished.
- **`Vanilla driver pins IntervalStyle at checkout`** is corrected where
  it describes the late binding, and its wrapped-hook scenario is
  restated as the in-place replacement that actually takes effect, with
  the new-value decoration named alongside it.
- **`Set-operation branches must be row-compatible, and the result types
  honestly`** gains the sentence for the form it never addressed. Its
  per-key widening was written for a row type built from two resolved
  branches — the chain — and a core-built set operation carries no type
  for its right branch to union. The requirement said nothing about that
  form, and the implementation answered the silence with a raw driver
  row. This change gives it the strongest shape that form can carry (the
  left branch's declared keys and read types) and writes that down.
  **It is the specification of an unspecified path, not the narrowing of
  a specified one**: no statement that types per-key today types
  differently after this change, and the widening sentence keeps its
  full force everywhere it was ever in force.

Items 1 and 4 above carry no delta: each restores a sentence the corpus
already states (`Every declared tier's obligation…` and `Select
statements over declared tables`), so they land in this change as plain
fixes.

## Impact

- **Affected code**: `packages/query` (the kit and `ExecuteResult`),
  `packages/core` (`renderProjection`), and two test files of packages
  whose sources are untouched (`packages/supabase`,
  `packages/pg`) where the changed obligations are observed.
- **Breaking**: none for a caller. Generated SQL changes in one shape
  only — a whole-table projection in a select that also joins — and any
  committed artifact carrying that shape is regenerated in the same
  commit.
- **Publishing**: one `patch` changeset. The new kit obligation reaches
  no third party (the kit is not exported from any package's `exports`
  map), and every other item restores already-specified behavior.

## Out of scope

- **Exporting the conformance kit.** Still deferred, on the terms the
  existing requirement states.
- **Widening a core-built set operation's row type to the union of both
  branches.** Core's own combinators deliberately return the left
  branch's projection and carry no type for the right one, so the
  per-key widening is reachable only where both branch row types are
  resolved — the chain. Closing that on the core path is a change to
  core's combinator surface, not to `ExecuteResult`, and the delta above
  records the present contract rather than presuming that change.
