# Work — quickstart-now/hejbro#452

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — windowed aggregate cell cast: red before task 1.2's fix

_2026-09-05T05:32Z_

Before task 1.2's `select.ts` change, `select.test.ts`'s new
BUILDER_READ_SHAPES-driven it.each table failed 11 of its cases, all
windowed forms: `count`, `row_number`, `rank`, `dense_rank` (int8
shape) and `min`, `max`, `lag`, `lead`, `first_value`, `last_value`,
`nth_value` (argument shape, over a bigint column). Every failure was
`expected false to be true` on `rendersCastFor(...)` -- the compiled
SQL carried no `::text` cast, confirming the proposal's own claim that
`atRiskCastSuffix` neither unwrapped a window node nor named any window
function. All 68 unwindowed cases were already green. After task 1.2's
fix (BUILDER_READ_SHAPES read through a window-unwrapping helper), all
79 cases passed.

<a id="w2"></a>
## W2 — task 1.4 ratchet verified: reverting select.ts reproduces the 11 red rows

_2026-09-05T05:32Z_

To confirm the task 1.4 ratchet (nested-revive.test.ts's "select.ts
casts iff convert.ts revives" it.each over BUILDER_READ_SHAPES) actually
catches the regression it exists to catch, select.ts was checked out to
its state one commit before task 1.2's fix (eb4dcdf1~1) and
@hejbro/core rebuilt (TURBO_FORCE=1 pnpm --filter @hejbro/core build).
Running the ratchet against that build reproduced exactly the same 11
windowed rows as red (count, row_number, rank, dense_rank, min, max,
lag, lead, first_value, last_value, nth_value -- "expected false to be
true" on wasCast), 10 unwindowed/own rows staying green. select.ts was
then restored to its committed state (git diff showed no residual
change) and @hejbro/core rebuilt again; all 56 tests in
nested-revive.test.ts passed.

