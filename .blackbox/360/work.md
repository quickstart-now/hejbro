# Work — quickstart-now/hejbro#360

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — array-ergonomics group 3 — the guard, and four signals that never reached their target

_2026-08-28T00:00Z_

Piece record for `add-array-ergonomics` task 3.1 (tracking #360), built
by the g3 piece team (planner opus / implementer sonnet / reviewer
opus) in worktree `array-g3-guard` off dev `c7bdddd`, verdict PASS at
`738624c65aade8087f7e3982bf1a6f352c7c7470` (single commit, two files).

### What landed

The defense-in-depth backstop from design decision 4: inside
`convertArrayElement`'s `raw === null` branch, a column whose
`columnState.notNullElements === true` rejects an arriving `NULL`
element through the existing `result-conversion-failed` family (plain
`Error` cause, no new code — proven on two axes: the query-src literal
inventory stayed 15 package-wide / exactly 2 in `convert.ts`, and a
runtime `cause.code === undefined` assertion the implementer added
unprompted, which also kills the variable-routed-code mutation the
inventory grep cannot see). A plain array column still passes `null`
elements through (the mandated negative control), a whole-column SQL
`NULL` still passes untouched ((G)), and the cause message carries a
real `Next:` remedy asserted at the cause level ((H)). Fixture isolated
in a new `flags` table — extending the existing `events` fixture was
tried and measured to break six-plus rows on the missing-column guard,
so the choice is evidence, not taste.

### The piece's defining pattern: "does this signal actually reach this target?"

Four cited signals turned out to be structurally blind, and all four
were caught in-flight:

1. The lead's briefed boundary signal "diagnostic-xref 106 invariant"
   was stale (107 at base — g1/g2 had landed codes) AND blind:
   `check-diagnostic-xref.mjs`'s `SOURCE_ROOTS` never scans
   `packages/query/src`. Lead fault, recorded as such; the corrective
   is now standing — a boundary signal may be briefed only after
   verifying the gate actually scans the piece's files.
2. `check:next-marker` is doubly blind for this piece (same
   `SOURCE_ROOTS`, and it inspects only `throwHejbroError` call
   sites). Reviewer raised the possibility; planner confirmed at
   source and swapped the criterion.
3. The substitute test assertion targeted the OUTER error's message —
   which always carries `Next:` — so deleting the remedy from the
   implementer's cause message passed everything. Fixed by (H),
   asserting on the cause itself.
4. The planner's own expectation table tried to evidence (H) via the
   test COUNT (21), which cannot distinguish an in-`it()` assertion;
   self-corrected to artifact-only proof.

The planner also mis-read turbo's tail as a monorepo total ("180 vs
559 contradiction", filter suspicion) and retracted it with the
reviewer's full per-package extraction — yielding two standing rules:
cite test-gate numbers with their package labels, never a bare tail;
and pin per-package counts as a scope-leak detector (only
`@hejbro/query` 558→560 moved; nine packages byte-flat). The
gate-blindness half became #361 (both scripts' `SOURCE_ROOTS` omit
`packages/query/src` and `packages/pg/src` — a whole published
package's user-facing error discipline currently has no automatic
gate).

### Verdict strength

Five scoring mutants, five kills, each mapped to the exact test that
dies — including the two late-added assertions. The reviewer then ran
the counterfactuals unprompted: deleting (H) alone lets mutant 5
survive; deleting (G)'s `it()` alone lets mutant 4 survive. The three
freeze holds were therefore not formalism — each blocked a real hole.
The equivalent mutant (`=== true` → truthy) was excluded WITH its
impossibility proof (the flag's value domain is `true | undefined`),
and the nested-array axis was held as an observation tool, explicitly
barred from FAIL grounds (out of contract; escalation path instead).

### Ledger and process

Est 6m → 30m pure (fixture-isolation design + full-monorepo gate runs
per round) + a separate 17m crossing-rerun process row: requirements
(G)/(H) were derived incrementally after the gate-blindness
discoveries, each issuance crossing the implementer's commit reports.
The planner's own root-cause: settle the requirement set before red
starts. Tokens 438 requests / 380,247 output / 96.7% cache. The
implementer's above-and-beyond items: two real mutation-kill runs
executed and reverted with diff proof, the unprompted `cause.code`
assertion, and the `events`-breakage measurement.

Migrated from the single-file entry `.blackbox/2026-08-28-array-ergonomics-group3.md`, kept verbatim at `.blackbox/360/artifacts/2026-08-28-array-ergonomics-group3.md`.

