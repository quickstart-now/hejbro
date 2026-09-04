# Work — quickstart-now/hejbro#354

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — array-ergonomics-proposal — the honest default gets its ergonomics (#354, D99)

_2026-08-28T00:00Z_

OpenSpec change proposal `add-array-ergonomics` (proposal + design + 4
delta specs + tasks, `openspec validate --strict` PASS), authored by
the lead session directly in worktree `array-ergonomics` off dev
`d93729c`. The PR carrying this entry is the owner's approval gate for
both the proposal and decision-log row D99.

### What the proposal commits to

Constraint-backed narrowing end to end: `.notNullElements()` emits
`CHECK (array_position("<column>", null) is null)` derived at `table()`
build time into the ordinary checks list (snapshot shape untouched,
diff/removal free, duplicate names loud), narrows elements to `T` on
read and write (`TMeta` + `columnState` flag; `MutationValue` follows
`ColumnReadType` automatically), and the conversion layer fails fast if
a `NULL` element ever arrives for such a column (constraint dropped
out-of-band must never become a silent type lie). `assertNoNulls`
lives in core (pure, `throwHejbroError("null-array-element", …)` naming
the first null index — `error.ts` itself untouched, so the deferred
enriched-Error conversion is not triggered), re-exported by the
facade. Two new capabilities enter `openspec/specs/` at first touch
(`table-declaration`, `value-utilities`); `query-type-inference` and
`query-execution` get modified-requirement deltas, including writing
#349's landed element-null default into the spec text for the first
time.

Every contract detail is settled in the proposal/design (the g4
prescription — design decisions before summoning), so `tasks.md`
carries zero `[design]` tasks: four parallel-safe groups (declaration
+ narrowing / assertNoNulls / conversion guard / pg witness), six leaf
tasks, 6–9m each, every task naming its red test.

### Process notes

Filed as #354 (Feature, #282 sub — the owner accepted the 0.2.0 gate
growing by one, per their own every-sub-issue-closes rule). The
proposal PR's merge is the approval; implementation then follows the
apply workflow with piece teams per group and a per-group tracking
issue (the piece-issue rule).

Migrated from the single-file entry `.blackbox/2026-08-28-array-ergonomics-proposal.md`, kept verbatim at `.blackbox/354/artifacts/2026-08-28-array-ergonomics-proposal.md`.

