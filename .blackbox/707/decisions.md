# Decisions — quickstart-now/hejbro#707

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — cv proposal approved; Q1-Q9 settled (informational lines, managed tables only, declared-constraint index exclusion with a backs-constraint line, identifier order, generated/identity included); constraint kind → #859

_lead · interpretation · basis 412/D12, 412/D13, 412/R28 · 2026-09-04T22:19Z · ratified: pending_

Proposal approved under the owner's delegation (412 D12/D13/R28). The nine open decisions of `harden-check-inventory` design.md are settled; rule: `check` names every column, index and check constraint that exists on a managed table and is declared nowhere, one rule for the three kinds, and the loss report says what `check` will actually do.

- Q1 (a): informational inventory lines, no exit-code effect — the same rule and reason as the table axis (`generate` cannot repair a DB-only object, so it is not a failure). #843's distinct exit code for not-compared is unrelated.
- Q2: the existing sentence with the kind swapped — `unmanaged column (not covered by any declaration): app.users.legacy_note`, one line per object; same form for index and check.
- Q3: managed tables only; objects on unmanaged tables are not listed (the table line already says it all); `existingTable()` excludes the table and everything on it; schemas the declaration never touches are out of scope.
- Q4 (a) with one addition: only an index whose name equals a constraint the declaration names (the declared primary key's name, a declared column's unique name) is excluded. An index that backs a constraint the declaration does not name is reported as an index, and its line states the fact the catalog already gives `check`: `unmanaged index (backs constraint <name>; not covered by any declaration): <name>` — so the line is never misleading. (b) is refused: it would hide DB-only primary keys and uniques entirely. A fourth kind, `unmanaged constraint` (PK/unique/FK/exclusion), is purpose-bound but its own change: filed as #859 under #815, next in the check area.
- Q5: no special marking for a name a declaration cannot carry; existence only. Coupling `check` to the inference rules is recorded as a follow-up candidate in design.md, not filed.
- Q6: text mode identical, no new boundary line.
- Q7: identifier order (the loss report's `sortedBy` convention); the inventory asserts no order and D81's oracle is untouched.
- Q8: generated and identity columns included (both declarable, so a gap is real); system and dropped columns stay excluded by the existing query.
- Q9: no cap.
- Delta scope as drafted: cli-commands MODIFIED (inventory axis), catalog-inference MODIFIED (the index/check loss lines stop saying "will not mention it again"); the import requirement's column sentence becomes true by behaviour and is not edited. No diagnostics delta. Changeset: `minor` (a new capability of `check`). Task 1.8 (the brownfield witness asserts the column promise) stays in.

