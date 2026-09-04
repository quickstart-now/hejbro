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

