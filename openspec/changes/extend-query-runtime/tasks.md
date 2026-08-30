# Tasks: extend-query-runtime

Estimates are pure work minutes. Groups are file-disjoint slices; group 5
is conditional on group 4's measurement and MUST NOT be started before
its outcome is decided.

Conventions that apply to every group:

- The gate set is `pnpm check`, `pnpm check-types`, `pnpm test`,
  `pnpm check:bans`, `pnpm check:crap`, `pnpm check:tasktime`, and
  `openspec validate extend-query-runtime --strict`, all under
  `TURBO_FORCE=1`. `check:bans` is not optional: since the ban list
  moved out of Biome, it is the only machine check for `let` and loop
  forms. `check:tasktime` is in the set for the same reason the task
  ticks are: a group that writes ledger rows and leaves the badges
  stale fails CI on one matrix leg, long after it looked green here.
  Run `check:crap` before `check:tasktime`, the order CI itself uses:
  the first proves README clean, so the second's diff can only be the
  badge block.
- Every mutation used as evidence is reverted, and the revert is shown
  with `git status --porcelain`, not asserted. A mutation planted in a
  file this change is otherwise forbidden to touch is the case that
  matters: an unreverted one ships as a behaviour change.
- A record is produced, not transcribed. Numbers copied by hand into a
  document can drift from the run that made them, and the drift emits no
  signal: the arithmetic stays correct and the document stays plausible.
  Where a document cannot be generated, it carries what lets a reader
  tie it back — the command, the run's timestamp, and the sample count
  it claims — and the claimed count is asserted against the collected
  one in the harness itself.
- A gate that **rewrites** a file is judged by the diff it leaves
  behind, not by its own exit code — `check:crap` and `check:tasktime`
  both rewrite README, so a green run with `README.md` still modified
  means the refresh was never committed. Run them, then show
  `git status --porcelain`; that pair is the check, and it is the same
  pair CI performs.
- Any claim about how the code behaves — in a scenario, in a task, in a
  review finding — cites the code that runs it. This change produced
  four counterfactual claims across all three, every one of them written
  from a module's name or role rather than its source; two reached the
  spec and one nearly turned a positive control green. The test: is
  there a code change that would make this claim false? If not, it is
  decoration. A suspicion is not a claim: stating it as a hypothesis and
  closing it against the source before reporting is the procedure, not a
  lapse. What this rule counts is a claim that left the desk unverified.
  An observation is one claim and what gets built on it is another, and
  the rule covers both. A failure that was really seen can still be
  blamed on the wrong cause; a behaviour that was really seen once can
  still be written up as one the tests hold. Both travel further than
  the observation did, and neither announces that it outran its
  evidence. A summary is a third: this change produced three of them
  where the document and the arithmetic were right and the sentence
  relaying them was not. Whoever compresses a result owns the
  compression.
- A group whose output is a number gets the reviewer's prediction on the
  record before the measurement runs. The prediction is never evidence
  and never affects the verdict; it exists so that the reviewer's own
  leniency toward an expected result — or severity toward an unexpected
  one — becomes detectable afterward. Restraint is not reusable, a
  device is. The same holds for any distinction registered in advance:
  if the case it anticipated never arises, it cost a sentence and served
  as a negative control; the ones that look like over-engineering
  beforehand are indistinguishable from the ones that later decide an
  outcome.
- A `[design]` task settles a contract, and a contract's shape is half
  types. Every `[design]` task therefore names at least one **type-level**
  mutation alongside its runtime one — a value mutation cannot make a
  widened generic red. A type-level red is proved with `check-types`,
  never with the test runner: a type assertion does nothing at runtime,
  so a green runner says nothing about it either way.
- The task ticks in this file and the rows in `openspec/task-times.csv`
  are written at group boundaries and travel in that group's own commit.
  A review round earns its own ledger row when it was clock-stamped;
  when it was not, no row is invented and the gap is stated in the
  group's report instead. A task born from a review carries no
  estimate, as the ledger's own precedents do. Group 1 predates the
  stamping and so has no review rows — that absence is the record, not
  an omission to be filled in later from memory.
- A group that touches `packages/cli` hands off only on **two
  consecutive green runs** of that package's suite, and a red run is
  reported with its full output rather than silently rerun. That suite
  flakes at a few percent under parallel load for reasons outside this
  change (tracked separately), so one green run is weak evidence and
  one red run is not yet a regression.

Two facts shape the layout:

- The live-comparison machinery (catalog reader, comparison, inventory)
  stays where it is, in the `hejbro` package. The assertion is a new
  module beside it, reachable from that package's runtime entry, so the
  query layer's single runtime dependency is untouched.
- The capability half only exists if the measurement earns it. Its own
  delta spec is written after group 4, not before.

## 1. The handle keeps what it was built from

- [x] 1.1 (~7m) [design] The handle retains the full declaration list.
      The design part is the retained member's name and shape, and
      whether it joins the public handle type or stays an internal
      assembly surface. The settlement is not complete until both the
      name and the typing are confirmed with the owner; task 1.3 is
      where the settled typing becomes machine-checked, so this task
      stays open until then. Possible outcomes and their Files:
      (a) a new public member on the handle type — Files:
      `packages/query/src/db/db.ts`,
      `packages/query/test/db/db.test.ts`;
      (b) a new field inside the existing declarations record —
      Files: the same two;
      (c) the raw schema module retained as-is under its own member —
      Files: the same two, plus
      `packages/query/test/types/chain-types.test.ts` if the member is
      typed by the schema generic.
      Red: `packages/query/test/db/db.test.ts` — "keeps a declaration
      that is neither a table nor a function". What makes it red:
      delete the retention assignment from the handle literal and the
      enum export is unreachable from the handle.
- [x] 1.2 (~6m) Retention is the module's own values, and classification
      is unchanged. Red: `packages/query/test/db/db.test.ts` —
      "retained declarations are the module's own objects" (identity
      assertions, so a defensive copy fails it) plus tables/functions/
      roles asserted unchanged. What makes it red: map the retained
      entries through a shallow-clone helper and the identity assertion
      fails while every other assertion still passes.
      Files: `packages/query/src/db/db.ts`, that test.
- [x] 1.3 (~6m) The retained member's *type* is pinned, not only its
      value. A widened member is invisible to every runtime assertion,
      and this member exists so the assertion can read declared types
      off it. Red: `packages/query/test/types/chain-types.test.ts` —
      "the handle's retained schema keeps the module's own type". What
      makes it red: widen the member to `Record<string, unknown>` — the
      type assertion fails while all runtime tests stay green.
      Files: that test.
- [x] 1.4 (~5m) The declared-role set is pinned exhaustively, matching
      the delta's "exactly what they were" wording; today only two
      memberships are asserted, so an extra role passes unnoticed. Red:
      `packages/query/test/db/db.test.ts` — the role assertion compares
      the whole sorted set. What makes it red: inject one extra role
      into the classifier.
      Files: `packages/query/src/db/db.ts`, that test.

Gates: the standard set above. Group files:
`packages/query/src/db/db.ts`, `packages/query/test/db/db.test.ts`,
`packages/query/test/types/chain-types.test.ts`.

## 2. The assertion

- [x] 2.1 (~10m) [design] The public surface. **Settled with the owner**:
      a free function `assertSchema(handle, options?)` resolving to a
      report that keeps compared and uncompared declarations in separate
      places — "not counted as matching" has to be observable, not just
      asserted in prose; `options` carries the registry and the opt-out
      for uncompared declarations; a divergence throws under
      `assert-schema-diverged` and an uncompared declaration under
      `assert-schema-not-compared`, while the per-object findings keep
      the codes the comparison already gives them;
      the findings the comparison already produces travel on the error,
      and their message text is reused, never rewritten. The report's
      own field names are part of this settled surface, not an
      implementation choice made later, and no other task in this group
      may introduce one: the two places are **`compared`** and
      **`notCompared`**, a compared entry carrying the identity alone
      and an uncompared entry being `{ identity, reason, code? }` — the
      comparison's own message and code where it produced one, the
      kind's own stated reason and **no code** where the kind declares
      its objects never comparable. The optional code is how "one place,
      two identifiers is wrong" becomes a type rather than a test:
      reusing the comparison's finding type here would make its
      mandatory error force a code onto the case that must not have one.
      This task lands that surface. The vocabulary rule resolves to a
      fixed mapping on the reuse path, and it is the mapping — not the
      rule's illustration — that the code follows: the snapshot
      builder's ownership error propagates, a raw driver error
      propagates if one is ever met directly, and both `check-`-prefixed
      failures (unreadable catalog, empty declaration set) translate.
      The catalog reader wraps the driver's own error before the
      assertion can see it, so the illustration's "propagate" answer and
      this path's "translate" answer are both correct about different
      errors. Red:
      `packages/cli/test/assert-schema.test.ts` (new) — "a matching
      database passes" and "a missing declared table throws naming it",
      both driven by a fixture session returning canned catalog rows.
      What makes it red (runtime): drop the declared table from the
      fixture's catalog rows and the passing case throws. What makes it
      red (type): widen the report's type to `unknown` — the report's
      own type assertion fails while both runtime cases stay green.
      Files: `packages/cli/src/assert-schema.ts` (new), that test.
- [x] 2.2 (~8m) The failure is one coded diagnostic carrying a finding
      per object with a `Next:` clause — the shape the live-comparison
      machinery already produces, reused rather than re-derived. Red:
      `packages/cli/test/assert-schema.test.ts` — "the thrown error
      carries one finding per diverging object". What makes it red:
      join the findings into a single message string and the per-object
      assertion fails.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [x] 2.3 (~8m) "Could not answer" is not success: a declaration no
      registry kind owns fails the assertion under its own code, distinct
      from a real divergence's, and the opt-out changes only whether it
      throws — the names stay in what the caller receives either way.
      Red: `packages/cli/test/assert-schema.test.ts` — "an uncompared
      declaration fails under its own code" and "opting out still names
      it". What makes it red: reuse the divergence code for both and the
      first assertion fails; drop the names from the opted-out report and
      the second does.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [x] 2.4 (~7m) The registry is an explicit parameter defaulting to the
      generic Postgres registry. Omitting one a declaration needs is
      refused outright at declaration ownership — the snapshot builder's
      own error, propagated, before any catalog read — and supplying it
      turns that refusal into a stated boundary, not into a comparison:
      the comparison's kind coverage is fixed and this assertion does
      not widen it. Red: `packages/cli/test/assert-schema.test.ts` —
      "without its registry a preset declaration is refused, with it the
      run completes and the declaration is still named". What makes it
      red: hard-code the default registry inside the function and the
      supplied-registry case is refused too.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [x] 2.5 (~8m) The import-graph guard: the assertion module's
      transitive imports reach no filesystem, process, or command-line
      module. This is why the comparison machinery can be reused at all
      — that directory imports no node builtin anywhere, so reusing it
      costs nothing here; the modules that do are the loader, the
      snapshot file reader, the git helper, and the commands.
      Red: `packages/cli/test/assert-schema-imports.test.ts` (new) —
      "the assertion's module graph is free of filesystem access".
      Three operations, and all three must redden it: `import
      "node:fs";` in the assertion module itself; the same line in a
      module the assertion imports (if only the first reddens, the
      walker is not walking); and an import of the declaration loader or
      the snapshot file reader, which is the realistic regression — a
      later change needing config or entry loading and pulling one in.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [x] 2.6 (~7m) The two reasons a declaration goes uncompared are
      independently observable: no kind owns it, and the kind that owns
      it declares its objects uncompared. These are different code
      paths, so each has its own test and neither test may cover the
      other. Red: `packages/cli/test/assert-schema.test.ts` — the
      second cause's case, using a registered kind that declares itself
      uncompared. The kind is found through the registry's own public
      surface, and the reason carried is the kind's own string — never
      the command's sentence *about* that string, which names a command
      the caller never ran. Two helpers are deliberately left closed:
      the one that wraps that sentence, and the comparison's private
      not-compared finding (whose code means "should have been compared
      and could not", a different fact from "never comparable"). Two
      further cases are pinned here because a passing run proves them
      only by accident otherwise: a run whose gaps are all
      never-comparable completes with those names still reported and
      nothing compared, and a mixed run fails on the comparable gap
      alone — make the never-comparable ones count toward the failure
      and the mixed case's test must redden, which a single-cause
      fixture would never catch. What makes it red — a two-by-two, and the diagonal is
      the point: breaking only the registry-lookup path (an unowned
      declaration passes silently) reddens the first cause's test and
      leaves the second green; breaking only the declared-uncompared
      path (that kind's objects go through as compared) reddens the
      second and leaves the first green. One operation reddening both
      means one test is covering both paths, and then one of the two
      scenarios is redundant.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [x] 2.7 (~6m) The runtime entry exports it. Red:
      `packages/cli/test/exports.test.ts` — "the runtime entry exposes
      the assertion". What makes it red: remove the re-export line from
      `packages/cli/src/index.ts`.
      Files: `packages/cli/src/index.ts`, that test.

Gates: `pnpm check`, `pnpm check-types`, `pnpm test` (all with
`TURBO_FORCE=1`), `openspec validate extend-query-runtime --strict`.

## 3. The live witness

- [x] 3.1 (~9m) Against a real postgres:17: the assertion passes on a
      database built from the declarations, then an object is dropped
      directly in the database and the assertion throws naming it. Red:
      `packages/cli/test/assert-schema-live.integration.test.ts` (new)
      — "passes against the applied schema, throws once an object is
      dropped". Load-bearing check: assert it still passes after the
      drop, which must fail.
      Files: that test.

Gates: `pnpm --filter hejbro test:integration` against a real
postgres:17 (Docker), plus `pnpm check`, `pnpm check-types`,
`pnpm test` (all with `TURBO_FORCE=1`).

## 4. The measurement (gate for group 5)

No product code in this group. The rule is fixed before the numbers
exist: the session path, at least 1000 iterations, median and spread
reported, and prepared statements ship only if the improvement exceeds
twice the run-to-run spread **and** is at least 5% of the median. Both
comparisons are made in **percent**, since the second is already
relative and a rule cannot answer in two units.

"Spread" was left unspecified, and an unspecified parameter gets chosen
after the data is in — so it is specified now, as invariance: the
improvement clears the bar under **every** spread estimator reported
(interquartile range, median absolute deviation, standard deviation,
full range), or it does not clear it. Two reasons. A result that flips
with the choice of estimator is not "exceeding" anything, which is what
the rule asks. And ambiguity a pre-registration failed to remove is
resolved against the side arguing to ship, because shipping here costs
every driver a compile break.

The two outputs of this group carry different burdens. The shipping
decision needs only one estimator to miss — the rule ships on unanimity,
so a single miss settles it, and the group closes either way. The
record's wording needs all four to miss before it may say the
improvement was insufficient; short of that it says the estimators
disagreed and the data cannot answer. "Cannot answer" is not a
deadlock: it decides nothing about this change and everything about
what a future reader is told, and those are the opposite instruction
about whether to try again.

"Run-to-run spread" means the variation between **independent runs of
the harness**, at least five of them, not the jitter between iterations
inside one run. The distinction decides the outcome: within-run jitter
is systematically smaller, so using it as the denominator would let
almost any improvement clear "twice the spread". The record states how
many independent runs the spread came from.

"Independent" means at least a separate process invocation. Five runs
inside one process share a warm pool, a warm cache and a warm JIT, and
their agreement measures that warmth rather than the machine's real
variability — the same shrinking denominator, one level up. The record
says what each run shared and what it started fresh, so a later reader
can tell whether the spread was underestimated.

The two paths are measured **interleaved or in alternating order**, and
the record says which. Always running them in the same order banks
every warm-up gain on whichever goes second, and that is precisely the
question this group exists to answer.

- [x] 4.0 (~6m) The instrument is checked before it is trusted: the
      harness is first pointed at two conditions whose difference is not
      in doubt, and it has to report that difference. A harness that
      cannot see a manufactured gap cannot be believed about a real one,
      and this group's whole output is a comparison. Red:
      `packages/pg/test/prepared-statement.bench.integration.test.ts`
      (new) — "the harness separates two deliberately different
      workloads, and does not separate one from itself". Both directions
      are checked through **the same decision function this group's rule
      names**, not through a looser "the medians differ": a instrument
      validated by one test and used by another is two instruments. What
      makes it red: feed it the same workload twice and the
      no-difference direction fails; push the rule's threshold to an
      absurd value and the difference direction fails — if that second
      operation changes nothing, the check is not running the rule.
      The two workloads run **through the harness**, not as arrays fed
      to the function: a harness that times the wrong window — setup
      included, or two paths that are secretly the same send — produces
      honest arithmetic on dishonest numbers, and only a workload whose
      difference is physically real (one side deliberately slowed at the
      server) can catch that.
      Files: that test.
- [x] 4.1 (~9m) Prepared-vs-unnamed measurement over the session path:
      the same statement executed as today's unnamed text query and as a
      named prepared statement, N ≥ 1000, median and spread reported,
      the command printed so the run is reproducible. Red:
      `packages/pg/test/prepared-statement.bench.integration.test.ts`
      (new) — "reports a median and a spread for both execution
      shapes", failing while the harness reports neither. What makes it
      red: return a single sample instead of the distribution and the
      spread assertion fails.
      Files: that test.
- [x] 4.2 (~7m) Compile-cost measurement: recompiling a statement versus
      reusing a cached compile, same reporting shape. Quantifies the
      cost only — no caching surface ships in this change. Red: same
      file — "reports the compile cost per execution". What makes it
      red: measure a single compile instead of the per-execution
      repetition and the per-execution figure collapses to zero.
      Files: that test.
- [x] 4.3 (~6m) The numbers are recorded with the exact command,
      iteration count, median and spread, and the decision rule is
      applied to them **by the decision function itself**, with its
      output recorded — a verdict reached by looking at the numbers and
      judging them sufficient is not reproducible, and a negative
      verdict reached that way is indistinguishable from simply deciding
      not to do the work. The record also states the conditions
      the numbers were taken under, the exclusive container window among
      them: a timing figure taken while something else competed for the
      machine does not announce itself as wrong — it just reads as a
      slower number — so the window is part of the measurement, not a
      note about it.
      Files: `openspec/changes/extend-query-runtime/measurement.md`
      (new).

Gates: `pnpm --filter @hejbro/pg test:integration` against a real
postgres:17 (Docker), plus `pnpm check`, `pnpm check-types`,
`pnpm test` (all with `TURBO_FORCE=1`).

## 5. The capability — not activated

**Group 4's measurement did not clear the rule, so this group does not
run.** The improvement cleared the bar under two spread estimators and
missed it under two others, which is the definition of not exceeding
the run-to-run spread; one of eight runs was a 22.5% regression. No
capability key is added, no `driver-contract` delta is written, and the
one-line additions the exhaustive capability record would have forced on
the other drivers are not needed. The tasks below stay unticked as the
record of what the measurement decided against, not as work outstanding.

This is the measurement doing its job. The numbers are in
`measurement.md`; a later change with a different workload or driver
path can reopen the question from them.

- [ ] 5.1 (~8m) [design] The capability key's name and its fail-closed
      semantics. Possible outcomes and their Files — every outcome
      touches `packages/query/src/driver/contract.ts` and
      `packages/query/test/driver/contract.test.ts`; additionally:
      (a) one new key on the existing capability union — no further
      files; (b) the key plus a driver-side option describing what is
      prepared — plus `packages/query/src/driver/errors.ts` and
      `packages/query/test/driver/errors.test.ts`.
      Red: `packages/query/test/driver/contract.test.ts` — "a driver
      omitting the new capability does not type-check" and "the
      capability declared false fails closed". What makes it red: give
      the key a default and the omission case compiles.
- [ ] 5.2 (~8m) The conformance kit observes the new capability's
      obligation, so a driver declaring it true without honouring it is
      caught here. Red:
      `packages/query/test/driver/conformance.test.ts` — "a driver that
      declares the capability and does not prepare fails its tier". What
      makes it red: make the kit skip the obligation when the capability
      is true and the non-honouring fixture passes.
      Files: `packages/query/src/testing/driver-conformance.ts`, that
      test.
- [ ] 5.3 (~10m) `@hejbro/pg` prepares statements when the capability is
      declared. Red: `packages/pg/test/driver.test.ts` — "a repeated
      statement is sent with a stable statement name" plus the existing
      passthrough assertions unchanged. What makes it red: drop the name
      from the query object and the repeat assertion fails while every
      current test still passes.
      Files: `packages/pg/src/driver.ts`, that test.
- [ ] 5.4 (~5m) The exhaustive site list — the capability record is
      exhaustive, so exactly these declarations gain exactly one line
      each, and no other edit is made in those packages:
      `packages/supabase/src/driver/*` capability literal (one line),
      `packages/neon/src/*` capability literal (one line). Reviewed by
      diffing those two files and confirming a one-line addition each.
      Files: those two files only.

Gates: `pnpm check`, `pnpm check-types`, `pnpm test` (all with
`TURBO_FORCE=1`), `openspec validate extend-query-runtime --strict`,
`pnpm --filter @hejbro/pg test:integration`.

## 6. Wrap-up

- [x] 6.1 (~8m) The published surface's documentation: the assertion in
      the query reference, and the capability if group 5 ran. Red: the
      skill's own surface check — the reference names every export the
      runtime entry adds. What makes it red: add the export without the
      reference entry.
      Files: `skills/hejbro/references/query-layer.md`.
- [x] 6.2 (~6m) Release hygiene: one changeset (`minor` — the assertion
      is a new capability, and a new public surface must not ride out in
      a patch), the task-time rows, the README badges. The changeset's
      prose covers the assertion only: prepared statements never
      shipped, and a release note is the easiest place for something
      that did not ship to look as if it had.
      Files: `.changeset/*.md`, `openspec/task-times.csv`, `README.md`.
- [x] 6.3 (~9m) The flight-recorder entry, since this change was driven
      by owner decisions throughout: what was asked, what was built, and
      why — including the decisions that were reversed (the measurement
      verdict's own rule, the error-vocabulary illustration, the
      unanimity overclaim) and the one that decided nothing shipped.
      Red: none — this is a record, and the check on it is that a reader
      can reconstruct why the capability half is absent without asking
      anyone. Files: `blackbox/<entry>.md`.

Gates: `pnpm check`, `pnpm check-types`, `pnpm test`,
`pnpm check:crap`, `pnpm check:tasktime` (all with `TURBO_FORCE=1`),
`openspec validate extend-query-runtime --strict`, and
`git status --porcelain` shown verbatim after the last two.

## Totals

19 tasks (4 + 7 + 1 + 4 + 3). Group 5's four are not counted and never
ran: the measurement they were conditional on decided against them.
