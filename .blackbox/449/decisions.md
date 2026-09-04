# Decisions — quickstart-now/hejbro#449

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Q3: refuse, innermost-in-progress invariant over the whole tree, two codes by remedy, at send time

_lead · extension · basis D1 · 2026-09-04T15:17Z · ratified: pending_

Q3 (#449): (a) refuse, never serialize — serializing reorders what the user wrote (a second silent behavior) and deadlocks when the nested callback awaits a queued statement's promise; same shape as #445's sibling guard. (b) the invariant is "only the innermost transaction in progress in the tree may send": the starting tx, any ancestor tx, and a nested handle kept after its callback settled are all refused (a settled handle used while a new sibling runs reproduces the original defect through another door; the shared tree state answers it for free). (c) two codes because the remedies differ: `statement-during-nested-transaction` ("use the nested callback's tx for this work, or await the nested transaction first") and `statement-after-nested-transaction` ("use the enclosing tx; the nested handle was that nested transaction itself"); names follow `concurrent-nested-transaction`. (d) refused at send time — `execute` on call, a chain and `with` on await — never at chain construction, before compilation; the sibling guard stays. (e) surface: `execute` plus the five chain roots through the single `buildTx` builder, unscoped and scoped alike. Basis: hejbro's purpose — what the user wrote must not vanish silently (D13 on dev).

<a id="r2"></a>
## R2 — 1.4b: a nested transaction started from a settled handle is refused with statement-after-nested-transaction

_lead · interpretation · basis D1, R1 · 2026-09-04T15:46Z · ratified: pending_

Tripwire during 1.4: a nested handle kept after its callback settled refuses `execute` and chains with `statement-after-nested-transaction`, but `leaked.transaction(cb)` still opens and releases a new savepoint (measured on the wire) and, worse, its `finally` restores `tree.innermost` to the settled token, after which the live parent's statements are wrongly refused. Ruling (i): starting a nested transaction from a settled handle is refused with the same code and remedy — the handle is that nested transaction and nothing else, and a savepoint opened from it is as much "through it" as a statement is; refusing statements while allowing savepoints (ii) is an asymmetry with no explanation. Delta: the requirement's second paragraph gains "— or a nested transaction started from it —", the settled-handle scenario's WHEN gains "or starts a nested transaction"; the check sits at the savepoint entry before the sibling guard. Basis: R1's invariant (only the innermost transaction in progress may send) and D13 on dev.

<a id="r3"></a>
## R3 — Review: settled root handle refused with statement-after-transaction (1.4c); rollback-to-savepoint is not an end (1.2b); N2 filed

_lead · extension · basis D1, R1, R2 · 2026-09-04T16:24Z · ratified: pending_

Review (spec-bound, live PG 17): passed, four non-blocking. Two are inside this change's purpose and are taken now, under D13 on dev (what the user wrote must not run somewhere else silently):
- N3: a top-level `tx` handle kept after its callback settled (the transaction committed or rolled back) still sends statements, which then run outside any transaction on the connection — the same invariant as #449 ("only a transaction in progress may send") at the root of the tree. Task 1.4c: refuse with a new code `statement-after-transaction` (remedy differs from the nested case: "that transaction is over — open a new `transaction()`"), scenario added to query-execution, red rows for `execute`, a chain and `with` on a settled root handle; narrow re-review.
- N1 (#761): the kit classifies `rollback transaction to savepoint x` as ending the transaction, contradicting the requirement's own savepoint sentence. Task 1.2b: a `rollback [work|transaction] to savepoint` form is a savepoint operation, not an end; row added to the statement table.
N2 (a vendored table named `fn` or `as` is masked by the client's own members — pre-existing) is filed; N4 (pooler wire observation) recorded only.

