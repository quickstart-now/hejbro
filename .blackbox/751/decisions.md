# Decisions — quickstart-now/hejbro#751

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Q5: code duplicate-argument, both keys named, column-rule ordering

_lead · extension · basis D1 · 2026-09-04T13:05Z · ratified: pending_

Q5 — new code `duplicate-argument` (option a), message naming both keys and the shared derived name: `defineFunction() "app.f" declares arguments "userId" and "user_id" that both derive to the SQL name "user_id". Next: rename one of the two keys so their snake_case names differ.` Order follows the column rule: per-key refusals first (`invalid-sql-name`, then `reserved-local-name`, in declaration order), then the whole-list duplicate check reporting the first colliding pair. Reusing `duplicate-local-name` (b) is rejected: its wording is about row names and variables. Unifying `duplicate-column`'s wording to name both keys (c) is out of this change's scope and is filed as a follow-up.

