# Work — quickstart-now/hejbro#356

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — array-ergonomics group 1 — notNullElements, and the lead's oscillation on the record

_2026-08-28T00:00Z_

Piece record for `add-array-ergonomics` tasks 1.1–1.3 (tracking #356),
built by the g1 piece team (planner opus / implementer sonnet /
reviewer opus) in worktree `array-g1-declaration` off dev `1712bf2`,
verdict PASS (0 defects) at `fa25ced…`, tsdoc follow-up at `ca20a41…`,
rebased onto `5aebe5c` for the lead closing.

### What landed

`.array().notNullElements()`: `TMeta` flag (conditional method typing —
measured en route: a `TFamily extends "array" ? … : never` return does
NOT block the call, only poisons the result type, confirming design
decision 3's "the runtime throw is the contract") + optional
`columnState.notNullElements?: true` (kept optional so no constructor
outside the flag's own setter is touched — `packages/core` is the whole
diff), misuse validated at `table()` where the column name exists
(`invalid-not-null-elements`, column named, literal `Next:`), read and
write element narrowing through `BaseTsType`'s array branch and
`ColumnReadType`'s brand-array branch (the write side proven via the
`@ts-expect-error` pins in mutate's type tests), and the derived CHECK
joining the declaration's checks list before `validateChecks` — name
`<column>_no_null_elements`, expression structured
(`array_position(columnRef, null) is null`), rendered fully qualified.

### The expression-form escalation, in full — a lead-failure record

The reviewer found the spec delta's example text
(`array_position("tags", null) is null`, bare column) unreachable: the
shared renderer always fully qualifies column refs and has no bare
mode. What followed is recorded as a lead failure with the team's
correctives, per D89's no-summarization spirit:

- The lead pre-ruled twice on partial facts (raw fragment, then a
  reversal to structured), each crossing the planner's own analysis in
  the mailbox; the contract flipped five times team-visible, and the
  implementer — who had honestly finished a raw-fragment version
  before the contract settled, flagging "tell me if this needed owner
  confirmation" — reworked finished code through two round trips (a
  separate 20m process ledger row, attributed to the coordination
  layer, not the implementer).
- Settled terminal contract: structured nodes, fully-qualified pin.
  The deciding facts each came from the team: a column rename changes
  the derived check's NAME, so drop+recreate happens under either node
  form (planner); a table/schema rename retargets structured refs via
  `retargetColumnRef` while bare text merely has nothing to update
  (reviewer + planner); no introspection exists anywhere, so PG
  normalization can never break a text pin (reviewer). At equal
  correctness, structured wins on live guards, emitted-SQL consistency
  with every hand-declared check, and D67's direction — at the cost of
  the artifact-example corrections this closing commit carries
  (proposal, design, delta scenario, and the D99 row's expression
  wording — amended under the D94 correction precedent, owner
  notified with veto during the piece).
- Correctives now standing for later pieces: contract changes reach
  the team only through the planner's `TERMINAL 갱신` stamp; the lead
  rules only to the planner, never preemptively during a crossing; a
  new ruling requires naming the new FACT and the rework cost first;
  verdicts open with `worktree=… HEAD=…` on their first line; a new
  frozen SHA aborts an in-flight verdict (the g2-measured handshake);
  and a tree is identified by results only that tree can produce, not
  by labels.

### Verdict strength

Eight mutation axes all red with tests untouched — structured→raw
reversion, function name, schema-name corruption (the qualification
axis), `isNull`→`isNotNull`, join order moved after `validateChecks`
(exactly the collision test red), column name deleted from the error
message, `BaseTsType` branch removal (read red plus the write axis via
`TS2578`), `ColumnReadType` brand-array branch removal. Independent
reproduction on a reviewer-authored schema (`shop`/`items`/
`sku_labels`) against built `dist`: emitted
`check (array_position("shop"."items"."sku_labels", null) is null)`
byte-identical, snapshot JSON carries no `notNullElements` leak, and
the four test files show zero deleted lines (no assertion weakened).
Gates at the frozen SHA and again at this closing: all `Cached: 0`,
functions 1189→1190 with g2 rebased in, 0 violations.

### Ledger

Tasks 24m est → 45m actual (back-to-back, retrospective split
unavailable) + the 20m churn row; tokens 718 requests / 532,315 output
/ 98.2% cache from the three team transcripts.

Migrated from the single-file entry `.blackbox/2026-08-28-array-ergonomics-group1.md`, kept verbatim at `.blackbox/356/artifacts/2026-08-28-array-ergonomics-group1.md`.

