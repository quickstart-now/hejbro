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

