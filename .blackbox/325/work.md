# Work — quickstart-now/hejbro#325

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — add-query-layer group 7 — public surface, thenable chains, release wiring

_2026-08-27T00:00Z_

Piece team g7 (planner opus, implementer sonnet, reviewer opus),
worktree `query-g7-surface` off dev `047b2ef`, 24 team commits (tip
`c1e2f54`) plus this close-out. The final group of the change. The
owner design round for this group (same day) settled: hejbro facade
(A) with one dual-use `sql`; the db-first chain INCLUDED in this group;
thenable termination with `.compile()` preview and a three-surface
identical chain; the five-package fixed group aligning at 0.2.0 (npm
`time` entries checked first — 0.2.0 was never burned; query/pg E404);
real packaging + private flips; `privatePackages` removal; smoke
promotion; the #289 hold lift at close. The g5 lesson was applied: gate
wiring and test-binding standards were pre-settled in the tasks.md
header, and this group's review-driven rework (~100m) went to mutation
verification rather than requirement discovery.

### What landed

Thenable chains (`handle.select/insert/update/deleteFrom`) delegating
to core's builder stages — inert until awaited, `.compile()` returns
the byte-identical pure `CompileResult`, and the chain surface is
identical across the unscoped handle, `db.as` scoped handle, and both
`tx` creation sites (a shared `buildTx`; the send-primitive-
parameterized `createChainApi(run, tables)` factory, chosen over a
session-consuming factory precisely because the latter would open a
transaction at chain CREATION on scoped handles — the inertness
violation invited by design). The hejbro facade re-exports `db`, the
chain types, and query's dual-use `sql`, which replaces the core `sql`
re-export — verified as a structural superset with zero exact-match
pins repo-wide, and the hejbro∩query barrel intersection is exactly
`{sql}`. Real packaging for `@hejbro/query`/`@hejbro/pg` (tsdown,
dist exports, files, LICENSE, README, prepack, private:false), both
joining the changeset fixed group (five packages, one version
universe); the interim `privatePackages` entry removed; the
pack-install smoke promoted query/pg into `PACKAGES` with full
assertions and the interim file-wiring block dropped. Spec deltas gain
the chain surface and three-surface uniformity, every sentence
test-traced. The lead closing commit also lands the owner-approved
`openspec/config.yaml` rule: each top-level group gets a GitHub
tracking issue (board-visible layer; tasks.md stays the execution
truth) — researched the same day: OpenSpec has no official issue
integration or user hooks (commander-internal only), so the rule is
our own composition on the official config-guidance surface.

### The five surviving mutations had one shape

R1 caught three (insert/update/delete terminals losing `tables`), R2
caught two more (the scoped and tx wiring points) — in every case the
tests watched SQL routing but never the converted row VALUES, and
fixtures returning empty rows made conversion loss unobservable. One
`rows: [rawRow]` fixture exposed all five. The generalized rule: every
new `createChainApi(…, tables)` call site is a new point on the
conversion axis and owes a conversion assertion — the pair to g5's
"a refactor owes an inventory of the contract axes it creates". The
same inventory failed three times on the same axis (R1, R2, and the
6→7 count fixed at close): when a list claims to be complete, the
claim itself needs verification.

### The 7.4 no-red deviation and its closure

7.4 was wired before its tests; first reported as "subsumed", the
label was self-corrected by the implementer when the planner noted
7.3's subsumed had zero production change while 7.4 had real wiring —
an after-the-fact label that would have become citable precedent for
red-less tasks. Lead ruling: rework would be evidence-free ritual —
red's proposition ("without the feature this test fails") was proven
by per-point removal mutations, CONDITIONAL on the reviewer
reproducing sole-binding per point. The condition was met and
exceeded: removing the wiring spread fails `tsc` (exit 2), i.e. red
was real and merely unobserved in commit order. The reviewer separately
checked the residual risk mutations cannot cover — post-hoc tests
freezing implementation accidents as requirements — and found none.
Rule established: a test that binds already-correct behavior cannot
red in principle; its substitute is (1) a mutation-result report plus
(2) an assertion-to-spec comparison, because a mutation proves only
that SOMETHING is bound, not that the something is the spec.

### Incidents

- **The lead's prepared config.yaml edit was destructively reverted
  twice** (`git checkout --`) by the implementer, who met an
  unexplained working-tree change during `pnpm format` and treated it
  as cleanup both times. Cause allocation: the lead parked uncommitted
  work inside the team's active worktree without an in-file marker;
  the hub read the lead's notice but relayed only instructions, not
  worktree-state facts; the implementer chose a destructive disposal
  for foreign uncommitted work. Structural fix adopted on the
  planner's recommendation: lead work never sits uncommitted in a
  team-writable worktree — parked as a patch outside, applied only at
  close after the team tip freezes. Supporting rules kept: never
  revert foreign uncommitted changes (report instead — excluding from
  a commit and deleting from the tree are different acts), hub relays
  state-affecting facts even when they are not instructions, and the
  final commit stages only explicitly-named files (no `git add -A`).
- **SHA drift reached judgment three times** before the freeze
  handshake ("no work in flight, tip <SHA>", confirmed before any
  handoff) closed it — g5's crossing problem, finally solved as
  procedure rather than apology.

### Findings recorded

- **D59 was convention, not gate, for query/pg**: with any core bump
  pending, `updateInternalDependencies: "patch"` always auto-covered
  both packages, so `changeset status` could never detect a missing
  changeset for them. Fixed-group membership dissolves the question
  (members ride the group bump; the AFTER output shows them at minor
  with the group, not incidental patch).
- **The smoke now requires the registry**: npm 7+ auto-installs
  `@hejbro/pg`'s `pg` peer (measured: 25 packages on the real
  5-tarball set; the earlier 17 was a 3-tarball isolation figure —
  both recorded with their conditions). Ruled accept-and-record: the
  script exists to simulate a real consumer install, and real
  consumers hit the registry; hermeticity would change what is being
  verified. Air-gapped CI, if it ever exists, gets a vendored tarball
  then.
- **Partial-gate blind spots repeated four times** (a `--filter` run
  missing README staleness; type-level guarantees invisible to
  `pnpm test` — binding force lives entirely in tsc since
  `expectTypeOf` is a runtime no-op without vitest typecheck config;
  the same pattern on the absence probe and the TS2308 star guard;
  `pnpm check` not being a turbo task). The portable lesson: state,
  for every claim, WHICH gate protects it.
- The #326 asymmetry (`tx.execute` untyped while tx chains are typed)
  is imprecise-not-unsound, cited in code and spec; the judgment
  nature itself was recorded (the negative clause is vacuity-checked
  via TS2344; the positive clause is bound but not isolated).

### Fairness note (reviewer's closing point, adopted)

The findings list above must not read as "what the implementer
missed": the five surviving mutations were unobservable IN PRINCIPLE
while fixtures returned empty rows — no diligence inside that test
design could see them, and one `rows: [rawRow]` fixture exposed all
five; the `pnpm check` blocker hid behind a turbo-centric gate shape,
a configuration blind spot, not a personal lapse. On the other side of
the ledger: the implementer ran self-mutations every round, added
unrequested probes (the `convertRows` bonus probe separating two
assertions' roles), self-corrected two labels (the 7.4 "subsumed"
correction that the whole TDD ruling stands on, and the `.raw`
no-discrimination note), independently converged with the reviewer's
pre-flagged findings twice (value/type asymmetry, intersection guard
— two non-communicating parties finding the same defect is evidence
the criteria aren't arbitrary), and on the corrected "17" figure
re-measured to 25 and kept both numbers with their conditions. The
slice's true shape: mutation testing made the by-design-unobservable
observable, and both sides held their procedure. The reviewer's own
sentence stays with the record: a judgment history earns trust only
if the judging side's record is held to the same standard — which is
why the planner's two coordination failures are written here, not
hidden.

### Ledger honesty

All implementer times are self-reported approximations (no timer);
est 122m → ~351m on tasks plus ~100m of separated rework rows, and the
final three commits went unmeasured — the gap is recorded in the
ledger row rather than smoothed over. The rework bulk bought the five
surviving-mutation catches. Tokens measured from the three team
transcripts at PR open: 1,884 requests, output 1,700,360, cache hit
99.6%.

### Close mechanics

Base already at dev tip (no rebase); lead closing commit carries the
README CRAP block 1118 → 1136 (reviewer's independent measurement
matched), the ai-metrics group 7 row, both ledgers, the
openspec/config.yaml piece-issue rule, and this entry. Full gates
re-run at close with `TURBO_CACHE_DIR` isolation and `--force`. The
PR closes #325; #293 stays open until the change archives; the #289
release hold lifts by lead comment after this PR merges (7.3 is then
on dev).

Migrated from the single-file entry `.blackbox/2026-08-27-query-layer-group7.md`, kept verbatim at `.blackbox/325/artifacts/2026-08-27-query-layer-group7.md`.

