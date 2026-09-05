# Decisions — quickstart-now/hejbro#514

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — .references() takes the referential actions as a second argument; parity with extras is the contract; the example converts as the witness

_lead · extension · basis 412/D24, 412/D25; #514's measurement (identical DDL but for the dropped on delete clause; 0 of 7 example FKs expressible); D102 (one declaration feeds DDL and types) · 2026-09-05T05:40Z · ratified: pending_

Design (design.md Q1-Q4): options object over foreignKeyActions on both keys, folded into the one ForeignKeyDeclaration; type-level edge unchanged; self-referencing/composite stay on extras; examples/postgres converts with byte-identical artifacts as the witness; D102's "actions stay on extras" sentence amended by the lead under delegation, surfaced on return. table-declaration: one MODIFIED requirement with two scenarios. Ratification: owner on return.

<a id="r2"></a>
## R2 — references() options argument: sibling state slot, no runtime guard, fold-side null normalization

_lead · interpretation · 2026-09-05T16:28Z · ratified: pending_

Basis: 514/R1 -- the options argument is the direction, and byte-identical
DDL, snapshot and diff against the `extras` form is the contract.

(a) The actions live in a sibling column-state slot,
`ColumnState.referenceActions?: { readonly onDelete?: ForeignKeyAction;
readonly onUpdate?: ForeignKeyAction }`, not in a promoted `references`
struct. `.references()` is the only writer of either slot, so the
"actions without a thunk" state is unreachable; a one-line constraint
comment on the slot records exactly that. Promoting the existing thunk
slot would widen this change's diff across every reader and its tests for
no behavioral gain, and raise the rebase risk against the two concurrent
changes.

(b) No runtime guard on the action value. The `extras` form validates
actions at the type level only; guarding one form alone would break the
parity this change exists to establish. A guard is a two-form question,
filed under #815 if it is ever wanted -- not here.

(c) The fold normalizes: `onDelete: actions?.onDelete ?? null`,
`onUpdate: actions?.onUpdate ?? null` -- the same point and the same
expression the `extras` path uses, which makes `.references(t)` and
`.references(t, {})` identical by construction; the input table's
"neither" row pins it.

(d) If every foreign key in `examples/postgres` converts, the example
keeps none on `extras`: the example shows the form users should read, and
the mixed-form canonical-order scenario is covered by core's own tests.

<a id="r3"></a>
## R3 — examples/postgres conversion scope: app.schema.ts and step-10 only

_lead · interpretation · 2026-09-05T16:36Z · ratified: pending_

Basis: 514/R1 and 514/R2 -- the example is the honest witness, and the
committed snapshot and migration chain must not move by a byte.

Measured: all seven foreign keys in `examples/postgres/src/app.schema.ts`
are declared through `extras.foreignKeys`, and all seven carry `onDelete`
(`projects.ownerId` -> `members.id` also carries `onUpdate: "cascade"`).
One of them, `comments.parentId` -> `comments.id`, is self-referencing.
`src/app.schema.ts` and `src/steps/step-10.schema.ts` are byte-identical;
`step-1` through `step-9` are earlier tutorial snapshots carrying fewer
foreign keys.

Scope: `app.schema.ts` and `steps/step-10.schema.ts` convert together in
one diff and stay byte-identical -- six foreign keys move to
`.references()` with their actions, and the self-referencing one stays on
`extras`, which satisfies the design's "the example keeps one of each
form" on its own. `step-1` through `step-9` stay as they are: they are the
tutorial's own progression, and the delta's witness is the final state's
unchanged snapshot and chain. Converting every step would drag step
artifacts and prose along and outgrow one change and one PR; converting
`app.schema.ts` alone would break its identity with step-10 without
knowing whether a check enforces that identity -- finding out whether one
exists is the conversion's own first red.

Tutorial prose that teaches the `extras` form is not edited by this
change; its location is reported and filed under #815.

<a id="r4"></a>
## R4 — history-rewriting commands are out of the implementer's hands; the retitling of the first two commits stands

_lead · interpretation · 2026-09-05T16:56Z · ratified: pending_

Basis: 412/D24 and the team's division of labour -- the implementer
commits, the lead pushes, opens and merges.

The rewrite stands. The two commits rewritten while retitling `4cd42275`
were never pushed, and `git diff 4cd42275 727ffb98` and `git diff
48e44cf4 c645e48e`, run without a path filter, are both empty: only the
messages moved, the trees are identical. That emptiness is the condition
-- had either diff carried content, the work would have stopped there
instead.

The rule is now spelled wide: the implementer runs no command that
rewrites history -- `git rebase` (non-interactive included), `git commit
--amend`, `git reset --hard`, `git push`, the `filter-*` family. The
earlier wording named push, PR, merge and rebase, which left
"non-interactive is fine" open to read. Three things stacked: the planner
instructed an amend, retracted it late, and the implementer read a
non-interactive rebase as outside the ban. The implementer reported the
true state instead of returning the confirmation that was asked for --
that is the right conduct, and this ruling records it without penalty.

A test table that never went red is not proven by its own green. The 1.2
tables are proven by swapping in the pre-1.1 source and measuring -- 60 of
60 diff rows and 6 of 6 rename rows fail, 101 of 103 overall -- and then
restoring. A swap that fails nothing means the table is vacuous and goes
back to the planner.

<a id="r5"></a>
## R5 — the d102 amendment lands in the row's own revision parenthesis

_lead · interpretation · basis R1 · 2026-09-05T17:10Z · ratified: pending_

D102's row already records its revisions outside the bold decision
sentence, in the trailing parenthesis ("amended at group 1 review,
owner-ruled: ..."). The brief's instruction to append "(amended under
delegation, 514/R1; owner ratification pending)" was read two ways:
nested inside the bold sentence at the clause it corrects (A), or in the
row's revision parenthesis in the row's own format (B). Ruling: B. The
bold sentence loses only the words "and actions" so it states the current
contract; the revision parenthesis gains, before "; v6 was never
released": "; amended under delegation, 514/R1: `.references()` takes an
optional second argument naming the referential actions, so actions no
longer stay on `extras` -- owner ratification pending". Nothing else in
the decision log moves; the owner ratifies or reverts this one sentence
on return. The decision log is an owner hard gate, so this ruling is
itself in the ratification queue.

<a id="r6"></a>
## R6 — the last references() call replaces the whole reference, actions included

_lead · interpretation · basis R1 · 2026-09-05T17:46Z · ratified: pending_

The reviewer built the input the delta's universal sentence spans and the
tests did not: two `.references()` calls on one column. Today the target
is the last call's and the actions are the first call's, because
`referenceActionsField(undefined)` in
`packages/core/src/types/column-builder.ts` returns an absent key and so
never clears the slot an earlier call wrote; the input type-checks, and
the rendered DDL disagrees with the `extras` form written from the same
intent. Ruling: a `.references()` call replaces the reference as a whole
-- target and actions together -- so a second call without actions leaves
the column with no referential action and a second call with different
actions leaves exactly those; the slot is written to `null` explicitly
when the argument is absent, never left as it was. This is the reading the
target already has (last call wins) extended to the field that travels
with it; no refusal is added, because the DSL treats a repeated builder
call as a re-declaration everywhere else and a loud error here would be
the only one of its kind. Red first: two rows in the column-builder test
(second call without actions -> no action in DDL and snapshot; second call
with different actions -> the second's), each compared byte-for-byte
against the `extras` form; the reviewer's reproduction under
`/private/tmp/review-ra-scratch/corpus/` is the source of the rows. Files:
`column-builder.ts` and its test only.

<a id="r7"></a>
## R7 — the replacement rule of a repeated references() call enters the delta as a scenario

_lead · interpretation · basis R6 · 2026-09-05T18:15Z · ratified: pending_

The re-review closed B1 and found that R6's observable contract -- a
repeated `.references()` call replaces target and actions together --
lived only in a test title, a comment and this record. A contract the user
can observe belongs in the spec (D87), and the D106 archive gate reads
spec sentences only, so it would never see this one. Ruling: the delta's
requirement *A column-level reference carries referential actions* gains
one scenario stating the rule; #972 keeps the open question of whether a
repeated call should instead be refused, and the scenario says so in its
last clause so the two do not contradict. N6 (the public
`ColumnState.referenceActions` type widened to `| null`) is recorded as
fact; its only reader folds it with `?.`.

