# Work — quickstart-now/hejbro#561

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-context-boundary — a mandatory context that applies nothing (#561)

_2026-09-01T00:00Z_

(Pins re-taken at the archive round; originally taken before this
change's PR commit; the blackbox file itself is not pinned. The
`openspec/changes/harden-context-boundary/` paths move when the change
archives and are re-pathed then, blobs unchanged unless the D106 round
corrects text. Pins die three ways — squash preserves them, an archive
kills the path, a concurrent same-file edit on dev kills the blob — so
every later commit re-verifies all of them, itemized.)




Piece run by the cb team (planner, researcher, implementer, reviewer)
under the owner's standing delegation ("continue processing #282's
sub-issues", 2026-08-31, in session); the lead ruled every `[design]`
detail and stands in for the owner on the proposal gate. This entry
exists because the change alters two shipped contracts — what satisfies
a driver's mandatory-context declaration, and the `operation` token in
two coded errors — on the strength of a D106 finding rather than a user
report.

### What was measured before deciding

- The vacuous path was real but unreached by shipped drivers: the Nile
  rendering already refused an empty tenant through its UUID check
  (`nile-context-value-invalid`), an accidental defense with no test.
  The public `renderContext` contract still admitted a rendering that
  returns `[]`, so "no sample in the repo" was not "no exposure".
- The `driver-missing-capability` operation vocabulary was per entry
  point (`transaction`, `db.as`, `db.context`), not per surface — the
  lead's opening assumption was wrong and was corrected before the
  proposal.
- The same `operation` value flowed into both `context-required` and
  `driver-missing-capability`, so narrowing the token to one error would
  have cost extra code for a worse result.
- Existing pins: `context.test.ts:136-147` pins the vacuous shape on a
  non-mandatory driver (kept — the refusal is scoped to `contextRequired`);
  `exports.test.ts:126-130` pins `defaultContextRendering({}) === []`
  through the public barrel (kept — the default rendering itself does not
  refuse); `neon/test/driver.test.ts:392-395` pinned the scoped-path
  token `db.as` as a string (moved to `db.execute` — the intended
  consequence of both-paths/both-errors; a symbol-reference sweep had
  missed this string pin, so token changes now get a separate string-pin
  sweep).

### Rulings (lead, under delegation)

F6-SCOPE=required-only · F6-CODE=new-code · F6-NAME=`context-rendering-empty`
(the `context-provider-empty` family: subject + `empty`) ·
F6-POINT=after-rendering (before any caller statement; the wrapping
transaction carries none) · F7-GRAIN=per-verb (`db.execute`, `db.select`,
`db.insert`, `db.update`, `db.deleteFrom`, `db.with`, `db.fn`; the
transaction API keeps `transaction` because a driver's own thrower names
it and the cross-driver uniformity rule binds that spelling) ·
F7-SYMMETRY=both-paths · F7-SURFACE=both-errors ·
NEON-PIN=update-to-db.execute.

### What landed

- Query layer (`packages/query/src/db/`): `applyContext` counts the
  rendering's output where the driver declares a context mandatory and
  refuses with `context-rendering-empty` — after the rendering ran,
  before any caller statement, the opened transaction carrying none; the
  conclusion is drawn from the count alone. `createChainApi` takes a
  per-member run factory so every refusal carries the member's own name;
  `PROVIDER_OPERATION` is retired; the scoped path's three literals are
  replaced the same way; the empty-rendering refusal carries `operation`
  too, so the scoped path has a refusal that satisfies the naming
  universal (round 2's finding).
- Nile: a regression pin for the accidental defense (`asTenant`-less
  context dies in the preset's own rendering before any statement).
- Skill `query-layer.md`: the two boundary paragraphs now state the
  refusal; the error table gains `context-rendering-empty`; the
  `driver-missing-capability` row's operation examples follow the new
  vocabulary.
- One `minor` changeset (`@hejbro/query` names the fixed group).
- Ledger: per-task rows for both groups, spike/process time separated,
  `waited_user_min` instrumented from group 2 (group 1's zeros are
  marked unmeasured, not no-wait).

### Review findings folded in before the PR

- Round 1 (spec vs tasks): the retained scenario "A role-less context is
  admitted where the platform has none" could not absorb the new
  counter-example, so the whitelist requirement gained "admission by this
  check is not admission by every check" (MODIFIED, existing scenarios
  byte-preserved); the contract-to-test table grew from 6 to 10 rows with
  regression pins marked; the chain-factory task gained a scenario that a
  coarse implementation cannot pass (two chain members must not share a
  name); the `transaction` exception was written into the universal
  itself; a normative-looking `MAY` became `can`.
- Round 2 (gates): `context-rendering-empty` carried only `{ code }`, so
  the scoped path — where `context-required` structurally cannot fire —
  had nothing satisfying "names the surface … on the explicitly scoped
  path and the provider path alike": the vacuous satisfaction this change
  removes had reappeared in its own sentence. The refusal now carries
  `operation`; the scoped `db.select` assertion makes a hard-coded token
  fail.

### Method notes

Eight `X-FINAL` seals (seven design axes and the neon pin) ruled the
design before code; the one mid-group stop the implementer raised (the
neon string pin breaking outside the whitelist) was resolved by the lead
measuring the pinned test directly and sealing the consequence.
The review ran two rounds inside the cap — round 1 on the artifacts
(four majors, all closed by narrowing sentences), round 2 as the full
isolated gate (one major, closed by carrying `operation`). Gates were
re-run at 0 cached for every verdict; mutants were run per branch where
new branches existed and skipped, with the reviewer's concurrence, where
the change added none.

Migrated from the single-file entry `.blackbox/2026-09-01-harden-context-boundary.md`, kept verbatim at `.blackbox/561/artifacts/2026-09-01-harden-context-boundary.md`.

