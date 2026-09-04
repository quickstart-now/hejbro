Refs:
- openspec/changes/add-array-ergonomics/proposal.md @ blob dc18882ee21861cc57f41125a6b4032d11c13cc0
- openspec/changes/add-array-ergonomics/design.md @ blob 27326013342cb3b1e19d9d9108ec16af4c4bc1bd
- openspec/changes/add-array-ergonomics/tasks.md @ blob 044d427cb087c4cdc24bab4fff5c7ebf359c7000
- openspec/changes/add-array-ergonomics/specs/table-declaration/spec.md @ blob 1f3c4a0d07bec7777c9544715da107010ce791d1
- openspec/changes/add-array-ergonomics/specs/value-utilities/spec.md @ blob ac65d35450993c1d2b3f3a39d94f9b8c651b7167
- openspec/changes/add-array-ergonomics/specs/query-type-inference/spec.md @ blob 9cb583fed42a1bfa48ea9682f7692929b9e6a36c
- openspec/changes/add-array-ergonomics/specs/query-execution/spec.md @ blob 9fffb489fc28cdfc452a776666256429a595117a
- docs/specs/2026-08-19-hejbro-design.md @ blob a879b576608de2cfb9cc38f2c4e2874607085b01

# array-ergonomics-proposal — the honest default gets its ergonomics (#354, D99)

OpenSpec change proposal `add-array-ergonomics` (proposal + design + 4
delta specs + tasks, `openspec validate --strict` PASS), authored by
the lead session directly in worktree `array-ergonomics` off dev
`d93729c`. The PR carrying this entry is the owner's approval gate for
both the proposal and decision-log row D99.

## Owner inputs (English rewrites)

The direction accumulated across the #349 session (see
`2026-08-28-fix-array-null-elements.md` for that trail): honesty stays,
ergonomics must be overwhelming, dedicated surfaces on both sides —
the owner sketched `.array().$notNullElements()` and
`hasNoNulls(rows[0].tags)`. Three surface decisions were then settled
by AskUserQuestion (2026-08-28), each with background first:

1. Method name: `.notNullElements()` — the owner accepted the lead's
   recommendation to drop the `$` prefix, on the grounds that `$` is
   this codebase's type-only convention (`$type`) and this method
   emits real SQL, making it schema-declaration family like
   `.notNull()`.
2. Utility: `assertNoNulls`, throwing form — the boolean-guard reading
   of the owner's `hasNoNulls` sketch was surfaced (the name reads as
   a predicate, but the sketched usage assigns the return), and the
   assert-prefixed throwing form matching the sketched usage was
   chosen. An unchecked assertion was excluded up front as reopening
   the lie channel #349 closed.
3. CHECK name rule: `<column>_no_null_elements`.

## What the proposal commits to

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

## Process notes

Filed as #354 (Feature, #282 sub — the owner accepted the 0.2.0 gate
growing by one, per their own every-sub-issue-closes rule). The
proposal PR's merge is the approval; implementation then follows the
apply workflow with piece teams per group and a per-group tracking
issue (the piece-issue rule).
