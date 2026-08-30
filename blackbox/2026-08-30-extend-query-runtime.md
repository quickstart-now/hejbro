Refs:
- .changeset/add-assert-schema.md @ blob 7bc31f24ea5178c7deef769333dfd60dd23cebed
- openspec/changes/extend-query-runtime/issues.md @ blob 85f13d11267423908ff1bb25761d0d1bfc78f3fb
- openspec/changes/extend-query-runtime/measurement.md @ blob 6c00be28cb949f8a960e1e0e7f497268300d531e
- openspec/changes/extend-query-runtime/proposal.md @ blob 7be4ff7f4ce5e63dfc89d61e0c917cc699043c16
- openspec/changes/extend-query-runtime/specs/query-execution/spec.md @ blob 5978643a1c18043d4585303f10c6c1c6f67c1f68
- openspec/changes/extend-query-runtime/tasks.md @ blob a6379d5a8b6513c866a569d1e1bf18ca28b65f4a
- openspec/task-times.csv @ blob 558ed65318c5741ad2b1eb3da4c5792d4e42591e
- packages/cli/src/assert-schema.ts @ blob fa351c6c902e02cfa8305bf1e023977c3141fc43
- packages/cli/src/index.ts @ blob 3214e36aac733d70150bec904dd6cd2694126708
- packages/cli/test/assert-schema-imports.test.ts @ blob ff182161c5ebcb33cc4e4891975209d74693dc80
- packages/cli/test/assert-schema-live.integration.test.ts @ blob 9fd5d3fbafe08618745163aebf927df125733179
- packages/cli/test/assert-schema.test.ts @ blob ca0f9e5f3c15a2725c3a1f43e535620335f3cfaf
- packages/cli/test/exports.test.ts @ blob cf3631f0b9e1a4084fe6515f732cdfb6658fc60f
- packages/pg/test/prepared-statement.bench.integration.test.ts @ blob 55579942e3a75d0f3630c634a5aafd20f2acf753
- packages/query/src/db/db.ts @ blob 184b829b800dd9527b9727b55f1c3a694c3cf037
- packages/query/test/db/db.test.ts @ blob 166e1d6371580dfef8ed14fd1b7330f7a01c549a
- packages/query/test/types/chain-types.test.ts @ blob 14d85770ef36048f4e108a3dc04b781245aee409
- README.md @ blob 99f5562c97121fd9384fb15f2965a64bfc2b15e7
- skills/hejbro/references/query-layer.md @ blob 917eb5775f6d8fd9ba85c818291329109763c455

(Taken from `git rev-parse HEAD:<path>` immediately after the group-6
commit (`49aa375`), each cross-checked against `git hash-object
<path>` on the same, clean working tree -- all 19 matched, `ok`, no
mismatch.

Re-pinned a second time, after `feat(cli): name the finding type on the
public surface` (`5a27e59`, group 6 round 2 -- exporting
`AssertSchemaFinding`, an owner decision landing after the group-6
commit above): five of the nineteen paths this round touched content
`spec.md`, `assert-schema.ts`, `index.ts`, `exports.test.ts`,
`query-layer.md`, so their hashes above are this round's, not the
first commit's; the other fourteen are unchanged and still pin
`49aa375`'s own content. Each of the five re-verified the same way
(`git hash-object` against `git rev-parse HEAD:<path>`, all `ok`) --
the same class of staleness the enforce-driver-contract entry's own
"Re-pinned a second time" note closes, caught the same way, before
handing the SHA off rather than after.

This file's own path is not included, since it cannot pin
its own hash; the drafting note below has the same reasoning
`blackbox/README.md` states for why intermediate-state blobs are
unsafe to pin -- squash discards them, and no gate catches a stale
pin.)

(Drafting note, recorded rather than silently omitted: this entry is
written by the implementer session from committed artifacts —
`proposal.md`, `issues.md`, `tasks.md`'s own conventions section and
group headers, `measurement.md`'s own text, and this session's own
message history with the qv-planner session (which itself relayed the
reviewer and, on gated points, the owner) — not from a raw transcript
of the owner⟷lead exchange this implementer was never party to. Every
specific technical claim below (a number, a code, a file, a test name)
is grounded in one of those committed artifacts and can be re-checked
against them; the narrative connecting them is this session's own
reconstruction. If anything here understates or misstates what the
owner actually intended, the lead/planner session should amend this
entry.)

# extend-query-runtime — one half ships, one half is measured and does not

Team work (qv-planner + qv-implementer, reviewer and owner relayed
through the planner throughout), branch `feat-extend-query-runtime` off
`dev`. Two deferrals parked at the query-layer v1 cut (D98) came back
together because they share one seam — what the runtime knows about the
database it talks to, and how it talks to it:

- **#302**, "startup verify assertion on the db handle" — `db(schema,
  driver)` trusts that the connected database matches the declarations
  it was built from, and nothing checks that at runtime.
- **#303**, "prepared-statement caching behind the driver capability
  contract" — every execution recompiles and sends unnamed; nothing in
  this repository had ever measured whether preparing statements would
  be worth the driver-contract surface it would cost.

`proposal.md` scoped both explicitly as measurement-gated: #302 ships as
an opt-in assertion reusing `hejbro check`'s own comparison; #303 ships
**only if** a benchmark clears a pre-registered rule, fixed in
`proposal.md`'s own "Open decisions" #4 before any number existed. One
did. One did not.

## What was built

- **Group 1** — `db()` retains the full declaration list it was built
  from (`packages/query/src/db/db.ts`, a `readonly schema: TSchema`
  field, identity-preserved), the structural prerequisite the assertion
  needs (it compares every declared kind, not just tables/functions).
- **Group 2** — `assertSchema(handle, options?)`
  (`packages/cli/src/assert-schema.ts`), exported from `hejbro`: five
  types (`AssertSchemaHandle`/`Options`/`Entry`/`NotComparedEntry`/
  `Report`), three own error codes (`assert-schema-diverged`/
  `-not-compared`/`-catalog-unreadable`), and the propagate-vs-translate
  split this whole capability's error handling follows — a declaration
  no registered kind owns propagates `generateMigration`'s own
  `unowned-declaration` `HejbroError` unchanged (it already speaks this
  caller's vocabulary); every `hejbro check`-vocabulary refusal along
  the way is translated into this library's own plain-`Error`
  `{code, cause}` shape instead of left as-is. Reuses `hejbro check`'s
  own catalog reader and comparator (`packages/cli/src/check/*`) rather
  than reimplementing either.
- **Group 3** — the live witness
  (`packages/cli/test/assert-schema-live.integration.test.ts`): the one
  place this capability runs its real `readCatalog` path against a real
  postgres:17 rather than a canned fixture catalog, proving a real
  divergence (a table dropped directly in the database) is caught, and
  that a clean database is not a vacuous pass (`report.compared` names
  the object). A follow-up assertion, added on review after the group
  first closed, pins that the umbrella `assert-schema-diverged` code
  also carries the correct per-object finding code
  (`check-object-missing`) — the umbrella code alone does not prove the
  per-object finding survived intact.
- **Group 4** — the #303 measurement. No product code — the group's own
  header states this. Full account in
  `openspec/changes/extend-query-runtime/measurement.md`; summarized in
  "The decision that nothing shipped" below.
- **Group 5** — never opened. Conditional on group 4's own measurement
  clearing its pre-registered rule; it did not, so the driver-contract
  capability delta, the four tasks under it, and any change to
  `packages/query/src/driver/contract.ts` were never started. `tasks.md`
  states this outcome in its own "5. The capability — not activated"
  section rather than leaving the tasks merely unticked with no
  explanation.
- **Group 6** — this entry, the skill doc update
  (`skills/hejbro/references/query-layer.md`, `assertSchema`'s own
  section plus its "Not supported" entry for #303 moving from "not
  built yet" to "measured, not shipped"), and the release changeset
  (`.changeset/add-assert-schema.md`, `minor`, `hejbro`'s asserted
  surface only — #303 is not mentioned in the changeset body, since it
  never shipped and a release note is the easiest place for something
  that did not ship to look as if it had). **Round 2**, after review:
  `error.findings`' own per-object type carried no exported name —
  declared a contract but left the caller unable to type it. Owner
  decision: export it, as `AssertSchemaFinding`, a type alias (not a
  copy) of `check/compare.ts`'s own `Finding`. Named on this surface's
  own vocabulary rather than re-exported as `Finding` bare — the owner's
  own reasoning: a bare, generic name occupies a slot on the public
  surface and lets `hejbro check`'s internal vocabulary reach it, and
  since this exact type had never been published before this decision,
  the moment it is exported for the first time fixes its name; the
  reused-`check-`-prefixed-code exception elsewhere in this capability
  does not apply here, because that exception protects an *already*
  public contract, and this type was not one.

## Reversed decisions

Five, named because a summary that says "the document and the
arithmetic were right" without saying *what was wrong first* is the
same incomplete-honesty shape this change spent group 4 correcting in
its own record — `tasks.md`'s own conventions section (edited this
round) states the rule this entry follows: "whoever compresses a result
owns the compression."

1. **The measurement verdict's own rule, tightened mid-fragment.** The
   pre-registered rule in `proposal.md`'s open decision #4 fixed *that*
   there would be a threshold (twice the run-to-run spread, at least 5%
   of the median) before any number existed, but left "spread" itself
   underspecified. The first working measurement used one spread
   estimator (IQR) and reported a pass at N=8 after an earlier N=4 read
   as a miss — a reversal the owner did not let stand: reasoning that an
   unspecified parameter chosen after seeing data is chosen by the data,
   the rule was tightened to invariance across four independent
   estimators (IQR, MAD, SD, range) — ship only if **every one**
   independently clears the bar. This is not a rule the implementer
   changed after seeing an inconvenient number; it is the owner
   tightening an ambiguity the pre-registration had not closed, before
   the numbers this stricter rule would itself be judged against were
   collected under it.
2. **Whether cause ⓒ alone fails an `assertSchema` run — the owner's own
   first ruling, replaced by a second.** Group 2's classification splits
   a not-compared declaration into two causes: ⓑ, a comparison that
   *should* have run and could not (a registered kind with no
   comparator), and ⓒ, a kind that declares by design that none of its
   objects is ever comparable. The owner's **first** ruling: cause ⓒ
   alone still fails the run by default — the fix is not "make it pass"
   but a conscious, documented opt-out (state the fact and the kind's
   own reason, and if that boundary is accepted, move to
   `options.allowNotCompared: true`, which still leaves the object named
   in the report). An "always pass on cause ⓒ alone" shape was rejected
   outright at this stage — reasoning recorded then: making ⓒ pass by
   default lets "no silent gaps in what was compared" be routed around
   by nothing more than a kind's own declaration. The owner's **second**
   ruling **replaced** the first: cause ⓒ alone does *not* fail the run.
   Three reasons, recorded in the owner's own words: (1) `hejbro check`
   itself already exits `0` on cause ⓒ, and `assertSchema` reusing
   `check`'s own semantics more strictly than `check` itself violates
   this change's own premise — a fact the first ruling was made without
   having in view; (2) a failure with no available remedy violates this
   codebase's own `Next:`-sentence discipline (every error names a
   concrete next step; "wait for a kind to change what it declares
   about itself" is not one); (3) decisive — if the only escape from a
   ⓒ-alone failure is the same global opt-out that also silences cause
   ⓑ, then a caller who reasonably reaches for that opt-out for a
   harmless ⓒ case silences genuine ⓑ gaps right along with it. In the
   owner's own words: "what I called a 'conscious opt-out path' turned
   out to actually be a kill switch for the whole protection."
3. **An early illustration of the propagate/translate error-vocabulary
   split relied on a test that could never have caught what it claimed
   to.** A first version of "the message is reused, not reconstructed"
   called the same production function twice inside the test — once via
   `assertSchema`, once directly — and compared the two outputs. Two
   values produced by the same call can never diverge for a wording
   change, since both sides move together; the flaw surfaced only when
   the implementer's own mutation-drill discipline (a required step for
   every "this test catches X" claim in this change) mutated the real
   message text and watched the test stay green. Rewritten to pin
   literal expected strings from the real, current source, so a
   temporary one-character edit to that source reddens the test — the
   template later review rounds pointed back to by name. (This is a
   distinct event from the next item — an implementer-caught test flaw,
   not an owner reversal.)
4. **The owner's own worked example for the propagate/translate
   principle — withdrawn by the owner, on the reviewer's correction.**
   Settling the vocabulary principle itself ("a thrown error is judged
   by whether its code names something this library's own caller
   invokes"), the owner illustrated it with a hypothetical: "a driver
   connection failure is already at the caller's own layer, so it
   propagates." The reviewer checked the real path and found this
   false: `readCatalog` wraps the raw driver rejection into
   `check-catalog-unreadable` *before* `assertSchema` ever sees it
   (`packages/cli/src/check/catalog.ts:333-336`) — so what
   `assertSchema` actually meets is a `check-`-prefixed code, and the
   principle's own answer for that shape is *translate*, not propagate.
   The owner withdrew the example outright rather than defending it:
   "withdrawing my driver-failure example — the reviewer's correction
   is right. The principle stands; the instructions should carry a
   concrete mapping table instead of a hypothetical example. You may
   also record that my own example was the lead case of a citation-
   convention violation — the convention applies to me too." The
   example's place was taken by a concrete table (propagate:
   `unowned-declaration`, a raw driver rejection; translate:
   `check-catalog-unreadable`, `check-declarations-empty`) rather than
   a second hypothetical.
5. **"Unanimous agreement across all four estimators is structurally
   unreachable" — an overclaim, withdrawn.** Mid-group-4-closure, a
   draft of `measurement.md` argued that because `MAD` cleared the bar
   in every dataset collected and `range` never did, unanimity could
   never be reached under this rule at all. The reviewer verified this
   independently and found a counterexample: the old harness's 8 runs,
   sign-reversed run C excluded and each run expressed as a percentage
   of its own baseline (a statistic `decide()` itself does not compute
   — see below), reach 4-of-4. The claim was corrected in place to what
   the data actually supports: unanimity is achievable in principle, and
   this record's own dispersion — not an unsatisfiable rule — is what
   falls short. A further, sharper correction followed once the
   implementer re-checked the reviewer's counterexample against
   `decide()`'s own actual statistic (raw-millisecond spread, no per-run
   baseline normalization) rather than the percent-normalized one the
   counterexample used: under `decide()` itself, no dataset this record
   collected — old or new, any subset — has ever reached unanimity; the
   best is 3-of-4 (old runs, C and the baseline-outlier run D excluded).
   `measurement.md` states this precisely (achievability is *indirect*
   evidence, from a different statistic) and does not change `decide()`
   to close the gap — doing so after already seeing that it would move
   this exact dataset toward a different verdict would have repeated
   the same results-informed-rule-change shape this correction exists
   to name, one level up.

**The citation-attribution convention this change followed ("a
mechanism claim cites the code it describes; a quoted claim about what
someone else said carries that attribution, not a paraphrase presented
as the original") was itself violated and caught at four separate
layers, not one, across the change** — worth stating together, since no
single instance would show this was systemic rather than one person's
slip, across four layers: the spec layer (an original citation and its
own replacement — this entry does not have the specific detail behind
that pair, and does not guess it); the instructions layer (the planner
relayed a reviewer attribution without independently verifying it
against the code first); the review layer (the reviewer's own
accusation about `check/driver.ts`'s contamination source, which the
reviewer itself later withdrew); and the owner layer (the driver-
failure example above, item 4) — the owner's own words name this
explicitly: "the convention applies to me too." The planner's own
message-relay errors during this change (see "What went wrong" below)
are a related but separate failure mode —
imprecise transmission of an already-correct source, not an unverified
claim presented as verified.

## The decision that nothing shipped

`measurement.md`'s own verdict: **cannot determine — the four spread
estimators do not agree, in any dataset collected.** Deliberately not
"insufficient improvement" — that word would claim all four estimators
agree the effect fails to clear its own spread, which never happens in
any of the seven datasets the record collected (six individual passes
plus one pooled application of `decide()` to all 50 runs). What
happens, consistently, is that the estimators disagree with each other:
`range` never clears the bar, `MAD` always does, `IQR`/`SD` split
depending on the dataset. The ship decision itself (which requires all
four to agree) is unaffected by which word is chosen — unanimity is
never reached either way — but the word changes what a future reader is
told about whether trying again is worth it, which is the entire reason
`measurement.md` spells out the distinction this precisely rather than
picking whichever reads more final.

Contributing findings, each real and independently checked rather than
asserted: a vitest-reporter bug (the default reporter silently drops
`console.log` from a *passing* test, so a spawned child's own measured
result can vanish from the parent's view with no other symptom —
found, fixed with `--reporter=verbose`, and documented alongside the
sample-count assertions that exist specifically because of it); a real,
quantified order effect (runs measured unnamed-first show roughly double
the improvement of runs measured prepared-first — 0.0832ms vs 0.0424ms
mean, a 0.0408ms gap that is itself 63.6% the size of the effect being
measured); the old harness's one sign-reversed run (1 of 8, non-
independent process, no order control) vanishing entirely across 50 new
independent-process, order-balanced runs (0 of 50 negative); and — per
the reviewer's own explicit self-check against confirmation bias,
recorded because it is the harder-won kind of honesty — a pre-registered
run-count cap ("exactly 5 runs, no more") that was exceeded (5 passes,
50 runs total), named as a violation rather than laundered as protocol
expansion, with the overage's own upside disclosed alongside the
admission: the instability across passes it produced is part of the
evidence for "cannot determine," not a defect that happens to be
convenient to explain away.

Group 5 is not merely postponed. `measurement.md`'s own conclusion
scopes the finding precisely — not a claim that prepared statements are
not faster in general, nor that they are not faster on this exact
workload, only that this evidence does not let the pre-registered,
estimator-invariant bar be resolved either way — and names what would
actually change the answer for a future attempt: not more runs of this
same measurement (the estimator split is structural to this data's own
dispersion, not a sample-size artifact — `range` would need to shrink by
2×–3× across every new-harness dataset collected, a target the record
states as a number, not a direction), but reduced dispersion, a larger
underlying effect, or a rule that names one estimator instead of
requiring invariance across four.

## What went wrong / self-corrections during implementation

- **A vitest `-t` filter, anchored, silently matched nothing.** The
  4.1 orchestrator's first child-process invocation used
  `-t "^single measurement worker$"` against vitest's actual matched
  string (the full `describe > it` path, never anchored the way the
  filter assumed) — diagnosed by re-running manually and observing zero
  matches where a passing run was expected, fixed by removing the
  anchors and confirming the match was still unique against the file's
  other test names.
- **A first mutation-drill edit accidentally swapped a workload
  assignment** (4.0's same-workload drill, `fast` and `slow` reversed
  mid-edit) — caught on re-reading the file immediately after the edit,
  before the drill was ever run, corrected, then verified fresh.
- **4.2's own relative-only assertion missed a real mutation.** Moving
  the timed `compile()` call outside its loop (measuring one compile
  instead of one per execution) collapsed both the recompile and the
  cached-reuse figures to the same near-zero noise floor, and the
  original `expect(cached).toBeLessThan(recompiled)` assertion still
  passed under that mutation — both sides near-zero, the relative
  comparison held by a tiny, meaningless margin. Caught during the
  mutation drill this change requires for every "this test catches X"
  claim; fixed with an absolute-floor assertion
  (`recompiledStats.medianMs > 0.001ms`), which is what actually reddens
  under the mutation. The same relative-comparison-collapse risk was
  then checked against 4.1's own assertions on review and closed the
  same way (`expect(unnamedMedians).not.toEqual(preparedMedians)`).
- **A real production bug, found and fixed in the live witness**
  (group 3): a `finally`-block step meant to "recreate the table for
  later tests" re-ran `generateMigration(...).sql`, which includes
  `create schema ...` — colliding with a schema that still existed (only
  the table inside it had been dropped). Removed rather than patched:
  the file's last test, and the container is torn down in `afterAll`
  regardless, so nothing needed recreating.
- **Two commit-message substitutions**, both disclosed rather than
  silently applied: a relayed header exceeding commitlint's 72-character
  limit, and a relayed header containing a mid-sentence camelCase
  identifier commitlint's `subject-case` rule rejects. Both reworded to
  fit while preserving meaning, both reported back explicitly rather
  than assumed acceptable.
- **Repeated message-crossing between the planner and implementer
  sessions**, several times across group 4's closing rounds and again
  once at the very start of group 6 (an in-flight API interruption).
  No work was lost to any single crossing — each was caught by
  re-querying `git status`/`git ls-remote` for the actual current state
  rather than trusting either side's most recent message as
  authoritative, the same discipline the enforce-driver-contract piece's
  own entry names for the identical failure mode. Two tag operations
  needed correcting as a direct result (a tag moved, then restored to
  its originally-reported commit) — recorded in the piece's own message
  history and `git ls-remote` output rather than reconstructed here.
- **Three relay errors in the planner's own transmission of group 4's
  measurement figures**, named because the planner asked for them not
  to be hidden. The planner does not compute the underlying numbers
  (the implementer does, from raw harness output) but does relay them
  in guidance messages, and three of those relays did not match the
  source they were relaying — including an ordering claim about the
  four spread estimators' own relative magnitudes ("SD < IQR < range
  consistent in six of six") that the implementer checked against the
  raw data and found did not hold as stated (two of the seven datasets
  have `SD` exceed `IQR`, not the reverse). Each was caught the same
  way: by recomputing from the raw values already on file rather than
  transcribing the relayed figure — the practice `measurement.md`'s own
  "a record is produced, not transcribed" principle names, applied here
  to a message rather than a document.
