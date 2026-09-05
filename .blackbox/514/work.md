# Work — quickstart-now/hejbro#514

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — group 1 closes: references() takes referential actions, parity through diff and rename, example converts

_2026-09-05T17:17Z_

Group 1 (Actions on the column form, tasks 1.1-1.4) closed.

1.1 (options argument): `.references(target, actions?)` takes an optional
second argument, `{ readonly onDelete?: ForeignKeyAction; readonly
onUpdate?: ForeignKeyAction }`. `ColumnState` gains a sibling
`referenceActions?` slot (never a promoted `references` struct);
`foldColumnReferences` normalizes it the same way the `extras` path
already does (`?? null`). The column-form parity table (37 rows,
`foreignKeyActions x {onDelete, onUpdate, both, neither}`) went from 35
failing to 0 once the slot threaded through the fold.

1.2 (diff parity): 60 diff rows (all 30 ordered onDelete transitions and
all 30 ordered onUpdate transitions across the 6-state space
`foreignKeyActions + "none"`) and 6 table-rename rows were green from the
start -- 1.1's threading already covered the diff and rename paths, so
`table.ts` needed no further change. Red-worthiness was proven
separately, not assumed: swapping the pre-1.1 `table.ts`/
`column-builder.ts` (via `git show <sha>:<file>`, no history rewrite) into
the same 103-row test file produced 101 of 103 failures -- 35 of the 1.1
parity rows, 60 of 60 diff rows, 6 of 6 rename rows -- and restoring the
post-1.1 source returned all 103 to green.

History-rewrite integrity (raised by R4): amending the first commit's
message (via a non-interactive `git rebase --onto`, never pushed) and
replaying the ruling-record commit on top of it changed nothing but the
message -- `git diff <old-sha> <new-sha>`, run without a path filter, was
empty for both rewritten commits.

1.3 (the example converts): 6 single-column, non-self-referencing foreign
keys in `examples/postgres/src/app.schema.ts` and the byte-identical
`src/steps/step-10.schema.ts` moved from `extras.foreignKeys` to
`.references(() => target, actions)`; the seventh, `comments.parentId` ->
`comments.id` (self-referencing), stays on `extras` as the design's own
"one of each form" witness. The committed `migrations/` and
`hejbro.snapshot.json` did not move a byte -- `pnpm --filter
example-postgres test` (chain.test.ts + cli.test.ts + query.test.ts) is
4 of 4 green, and a local Docker round-trip (`postgres:17`) reports
"round-trip OK: 195 dump lines identical" with `check-declared-vs-catalog`
green on both the chain and fresh databases.

1.4 (docs, decision log, changeset): the cheatsheet
(`skills/hejbro/references/dsl-cheatsheet.md`) now teaches the second
argument on the column form first, drops the stale "extras only" claim
and its #514 citation, and keeps the self-referencing/composite-only
claim for `extras`. D102's row (`docs/specs/2026-08-19-hejbro-design.md`)
loses "and actions" from its bold sentence and gains a delegated
amendment in its own revision parenthesis (514/R5, ratification pending
on owner return). One minor changeset added for `@hejbro/core` (the
fixed seven-package group moves together).

Observed, not fixed (outside this piece's scope):
- `scripts/roundtrip.sh` names its own container (`hejbro-roundtrip-$$`)
  and self-cleans via a trap; it never binds a host port at all, so the
  team's `ra-pg`/55560-55569 convention did not apply to this script.
- No test or script directly diffs `app.schema.ts` against
  `steps/step-10.schema.ts` for byte-identity; `test/chain.test.ts`
  enforces the same outcome indirectly, by requiring `step-10`'s own
  declarations to reproduce the committed migrations and snapshot
  `app.schema.ts` is verified against.
- The first `pnpm --filter example-postgres test` run after the 1.1/1.2
  history rewrite failed on a stale `@hejbro/core` dist (rebase/checkout
  bumps mtimes even when content is unchanged); `pnpm build --force`
  resolved it, matching the repository's own documented pitfall.

<a id="w2"></a>
## W2 — review outcome: b1 repeated references() fix, n1 cheatsheet restore, n2-n4 dispositioned

_2026-09-05T17:50Z_

Review outcome for group 1 (add-references-actions): B1 (must-fix), N1
(should-fix), N2/N3/N4 (no action inside this piece).

Review scale (the reviewer's own real-server reproduction, cited so this
entry does not repeat the reasoning): 117 input rows, 72 real-server
applications, 69 `pg_constraint` catalog comparisons with zero
mismatches, and 36 form-conversion rows all `hasChanges: false`.

B1: a repeated `.references()` call on one column leaked the first
call's referential actions onto the second call's target. Root cause:
`referenceActionsField(undefined)` in `column-builder.ts` returned an
absent key rather than clearing the slot, so a second call without its
own `actions` argument left the first call's `referenceActions` value in
place while `references` (the target thunk) was correctly overwritten --
target and actions disagreed on which call "won". Ruling 514/R6: a
`.references()` call replaces the reference as a whole, target and
actions together; the slot is now written to `null` explicitly whenever
`actions` is absent, and the now-dead `referenceActionsField` helper was
removed. Two new red rows in `references-actions.test.ts` pin it: a
second call without actions clears the first call's action, and a second
call with different actions keeps only the second's -- both compared
byte-for-byte against the equivalent `extras` declaration.

N4 (no action): the reviewer judged the type-only import cycle between
`column-builder.ts` and `dsl/table.ts` (both directions `import type`)
safe -- erased before emit, so no runtime edge exists, and the direction
matches an existing precedent elsewhere in the same package.

Reviewer self-report: running `pnpm test` (backgrounded) and
`check:crap` at the same time in the same worktree produced 55 failures
from a missing `dist/cli.js` (`test:coverage` and `check:crap`'s own
`turbo run test:coverage` raced each other's build step); a serial rerun
was a clean exit 0 -- the same class of self-interference #102 already
documents for concurrent gates in one worktree.

Out of scope, filed for the lead to register under #815 on return: N2
(no runtime validation of an action string on the column form -- parity
with `extras`, which validates only at the type level too) and N3 (a
derived foreign-key name silently truncates past 63 bytes, undocumented
either form).

<a id="w3"></a>
## W3 — review outcome supplement: #970/#971/#972 filed, reviewer's independent verification

_2026-09-05T18:02Z_

Supplement to W2 (review outcome) -- issue numbers for the two
out-of-scope findings, a third filed issue, and three facts from the
reviewer's own independent, deeper verification.

Filed issues (registered under #815, not fixed in this piece):
- #970 -- N2: no runtime validation of an action string on either form;
  a raw string reaches the rendered DDL unchecked, same on `.references()`
  and `extras.foreignKeys`.
- #971 -- N3: a derived foreign-key name longer than 63 bytes is silently
  truncated by Postgres, leaving the snapshot and the catalog's actual
  constraint name to disagree; same on both forms.
- #972 -- whether a second `.references()` call should be refused at
  declaration time, and the pre-existing behavior of a repeated call
  silently dropping the first target, is filed as its own `[design]`
  task under #815. This piece implements only R6's option (a): the last
  call replaces the reference as a whole, target and actions together --
  no refusal is added.

Reviewer's independent verification (beyond the gate run already
recorded in W1/W2):
1. Full cross-check of the committed `hejbro.snapshot.json`'s seven
   foreign-key entries against the converted declarations: 7 of 7 match
   on target, both actions, and the derived constraint name --
   `projects_owner_id_fk` (the only entry carrying `onUpdate`) keeps both
   keys -- and the self-referencing entry stays on `extras`, so the count
   agrees too.
2. Independent evidence the artifacts did not move: `git log -1 --
   examples/postgres/migrations` and `git log -1 -- examples/postgres/
   hejbro.snapshot.json` both point to `99b9554d` (#900), not `e14d7265`
   (this piece's example-conversion commit). Running the built CLI's own
   `hejbro verify` directly reports `verify: 5 checks passed (10
   migrations, snapshot sha256:88394459665c...)`.
3. The self-referencing foreign key staying on `extras` is enforced by
   the type layer itself -- a column-level self-reference fails to
   type-check (TS7022/TS7024). There is no runtime refusal, and bypassing
   the type system, a self-referencing column form would render
   byte-identical DDL to the equivalent `extras` form -- the reviewer's
   judgment is that this is a correct result, not a wrong one, and no new
   guard is needed.

<a id="w4"></a>
## W4 — re-review outcome: b0, repeated references() widened to 13+1 rows, delta scenario closes n5

_2026-09-05T18:16Z_

Re-review outcome for group 1 (add-references-actions): B 0. B1 and N1
are closed; the piece is otherwise unchanged.

Re-review scale: the reviewer widened the repeated-`.references()` input
to 13 rows plus 1 interleaved row and reran it -- all pass under R6's
contract (the last call's target, the last call's actions, no other
state-slot contamination). The pre-existing parity tables (36/30/36 rows)
are unharmed, a 66-row real-server catalog comparison shows zero
mismatches, and the example's `hejbro verify` hash is unchanged from
before this rework.

Procedure deviation (recorded as fact): during the B1 task, the
implementer ran red then green without first sending the red output as
its own message, contrary to the team's standing instruction. The red
output was included in the eventual completion report and the deviation
was self-reported. This is the only procedure deviation in this piece.

N5 is closed: it became the delta scenario `A repeated references() call
replaces the reference as a whole` (514/R7), under the requirement
`Column-level foreign keys are declared with references`. #972 (whether
a repeated call should instead be refused, and the pre-existing behavior
of a repeated call silently dropping the first target) stays open and is
cited from the new scenario's own last clause so the two do not
contradict.

N6 (fact only, no action): the public `ColumnState.referenceActions`
type widened from `{...}` to `{...} | null`; its only reader
(`foldColumnReferences` in `table.ts`) already folds it with `?.`, so the
widening needed no reader change.

The type layer is unchanged by this fix: `.references(target, null)`
still fails to type-check (TS2345) -- the `| null` widening landed only
on the internal `ColumnState`, never on the public `references()`
parameter type.

