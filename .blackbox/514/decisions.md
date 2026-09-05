# Decisions — quickstart-now/hejbro#514

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — .references() takes the referential actions as a second argument; parity with extras is the contract; the example converts as the witness

_lead · extension · basis 412/D24, 412/D25; #514's measurement (identical DDL but for the dropped on delete clause; 0 of 7 example FKs expressible); D102 (one declaration feeds DDL and types) · 2026-09-05T05:40Z · ratified: pending_

Design (design.md Q1-Q4): options object over foreignKeyActions on both keys, folded into the one ForeignKeyDeclaration; type-level edge unchanged; self-referencing/composite stay on extras; examples/postgres converts with byte-identical artifacts as the witness; D102's "actions stay on extras" sentence amended by the lead under delegation, surfaced on return. table-declaration: one MODIFIED requirement with two scenarios. Ratification: owner on return.

