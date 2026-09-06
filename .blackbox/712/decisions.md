# Decisions — quickstart-now/hejbro#712

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — harden-catalog-inference-2: roles from policies too (public excluded); an enum name is held to D36 and omitted with its columns

_lead · extension · basis 412/D24, D25; the requirement's own one-rule sentence for identifiers; #678's measurement (pg_policies.roles never read); #712's finding (pgEnum asserts nothing) · 2026-09-05T05:55Z · ratified: pending_

Design (design.md Q1-Q2): pg_policies.roles joins the inferred role union, `public` dropped; an enum whose catalog name D36 rejects is omitted together with every column typed by it, one report line naming both with the check consequence. catalog-inference: two MODIFIED requirements. Constructor-mode review (catalog input). Ratification: owner on return.

<a id="r2"></a>
## R2 — the omitted-enum line says check names the column and not the type; commands/check.ts joins task 1.4 for the comparator move

_lead · interpretation · basis 712/R1; delta catalog-inference 'SHALL NOT promise that check will report it where check will not'; measured: check/inventory.ts has no enum axis, cli-commands inventory requirement closed list; compareCodeUnits lives in commands/check.ts 229-254; #1006 · 2026-09-06T01:45Z · ratified: pending_

Two questions from the planner's start report, before any code.

Q1 — the omitted-enum line's `check` consequence. The delta's scenario "An omitted enum's line names its columns and what check will do" and tasks.md 1.5 said `check` keeps listing "both" the enum and its column as unmanaged. `check`'s inventory (`packages/cli/src/check/inventory.ts`; the `cli-commands` inventory requirement) names a table, and on a managed table a column, an index and a check constraint, and extensions — it has no enum axis, so it never names the type; the column typed by it is a database-only column on a managed table and is named. The delta's own requirement forbids a line that promises a report `check` will not make. Ruling: option (A), the lead's artifact error is repaired in the artifacts — the scenario's THEN and task 1.5 now say that `check` keeps naming the column until it is declared and does not name the type, and the report line says both halves in one line (import and pull variants, wording settled in task 1.2's design step). Option (B), an enum axis in `check`'s inventory, is a `cli-commands` contract change outside this delta and is filed as #1006 (fix, low priority); when it lands the line is re-worded there.

Q2 — file boundary for task 1.4. The comparator to share is `compareCodeUnits` in `packages/cli/src/commands/check.ts` (229–254), not in `check/inventory.ts`; moving it to a shared module means editing `commands/check.ts`, which tasks.md did not list. Ruling: `packages/cli/src/commands/check.ts` joins task 1.4's files for exactly the move and its import line — no assertion or logic moves with it; tasks.md's header names it. A copy in `loss-report.ts` would contradict the delta's "the same comparator, shared" and is refused.

<a id="r3"></a>
## R3 — task 1.2 design: OmittedEnum names only the columns its omission takes out; import and pull line texts; schema-level position and code-point order

_lead · extension · basis 712/R1 (design Q2); 712/R2 (check names the column, not the type); delta catalog-inference 'one line names the enum and the column'; loss-report.ts sibling Omitted* family and line skeleton (measured 183-240, 400-577, 614-635) · 2026-09-06T02:04Z · ratified: pending_

Settles task 1.2's `[design]` question — the omitted-enum omission's data shape and the loss-report line — on the planner's submission D1–D5.

D1, the type: `OmittedEnum` (`schema`, `sqlName`, `columns: ReadonlyArray<{ schema, table, sqlName }>`), named like its five siblings in `loss-report.ts`; tasks.md's `EnumNameOmission` was the lead's wording and is corrected to match.

D2, the columns a line names: only the columns the enum's omission itself takes out — columns on a surviving table whose own names pass. A column already omitted for its own name is reported by its own line, and a column on an omitted table by that table's line; no object appears on two lines and no line states a cause that is not its own.

D3, the `import` line. With columns:
```
Omitted: enum type "app.Status" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it, and every column typed by it is left out with it: "app.orders.status". `check` keeps naming each of them as unmanaged until it is declared, and never names the type itself -- its inventory has no enum axis. Next: rename the type in the database, re-run `hejbro import`, and declare both.
```
Without columns:
```
Omitted: enum type "app.Status" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it. No column is typed by it, so nothing else is left out, and `check` never names the type -- its inventory has no enum axis. Next: rename the type in the database and re-run `hejbro import`.
```
"each of them … until it is declared" reads for one column and for many, so the line has no singular/plural branch.

D4, the `pull` line: as submitted — "so neither it nor the columns typed by it can be carried in the contract: …" with columns, "so it cannot be carried in the contract." without; both end "Rename the type in the database, then link the schema repository." No `check` sentence on the pull side, as the sibling lines.

D5, position and order: the enum lines follow the omitted-table lines and precede the omitted-index lines (schema-level objects first, then table-level ones); lines sort by `schema.sqlName` and a line's columns by `schema.table.sqlName`, both under the shared code-point comparator of task 1.4, so task 1.4 runs before task 1.2. Golden diffs caused by the new position are reported verbatim.

<a id="r4"></a>
## R4 — declare-emit's two localeCompare sorts join task 1.4 and the starter file orders by code points

_lead · interpretation · basis 412/D13 (complete within purpose); #874; delta catalog-inference 'ordered by code points, never by a collation'; measured emit.ts 1580 and 1584 · 2026-09-06T02:04Z · ratified: pending_

The planner reported, before touching it, that `packages/cli/src/declare-emit/emit.ts` sorts twice with `localeCompare` (the out-of-scope target handles, and the columns each handle references), and both orders appear in the starter declaration file `import` writes — the same locale dependence #874 removes from the loss report, in the other half of `import`'s output. The file is outside the change's listed files.

Ruling: the piece is completed within its purpose (412/D13). `declare-emit/emit.ts` joins task 1.4's files for exactly the two sort sites, which import the shared code-point comparator task 1.4 creates; no other logic moves. The red table gains a row over the starter text: an NFC/NFD pair and a locale-reordered pair of out-of-scope targets print in code-point order under both collators. The delta's first requirement gains one sentence: "Every ordered list the reading writes into the starter declarations SHALL be ordered by code points as the loss report is, so the file `import` writes does not depend on the process locale." No separate issue: the fix is two lines on a module this piece creates, and a follow-up would cost more than the change.

<a id="r5"></a>
## R5 — task 1.3 lines: foreign-key omission names the failing end; the dropped primary-key name is one approximation line; check's naming is measured before the line is pinned

_lead · extension · basis 712/R1 (design Q3-Q4); 712/R2 (never promise a report check will not make); delta catalog-inference 'references it or is referenced through it'; loss-report.ts foreignKeyNameApproximations precedent; compose.ts holds migration.snapshot before buildLossReport (482-525) · 2026-09-06T02:44Z · ratified: pending_

Settles the loss-report lines task 1.3 adds (CLI output, hence contract), on the planner's submission L1–L4, with the design fact that the primary-key comparison reads the snapshot hejbro is about to write (`migration.snapshot.primaryKeyName`) against the catalog's constraint name, so no core export is added.

L1 (import) and L2 (pull) — a foreign key at an omitted column: the sibling skeleton, with the reason clause naming the end that failed, because that end is the column the user has to rename:
- source end: `Omitted: foreign key "<schema.table.name>" -- it is declared on column "<schema.table.column>", which this reading left out because no declaration can carry its name, so the key cannot be declared either. Next: rename the column in the database, then re-run \`hejbro import\`.`
- target end: `… -- it references column "<schema.table.column>", which this reading left out …` (same tail). The pull variant says "cannot be carried in the contract" for the column and "so the key cannot be carried either", ending "Rename the column in the database, then link the schema repository." A single "touches" wording was rejected: which end failed is which column to rename.

L3 — a dropped primary-key name, one line for import and pull alike, following the foreign-key-name approximation precedent: `Approximated: the primary key "<schema.table.catalog-name>" is declared under the derived name "<derived>" instead -- the DSL derives every primary-key name, so \`generate\`/\`check\` will name this constraint differently from the database. Either rename the constraint to "<derived>" in the database, or keep it and read \`check\`'s inventory line for "<catalog-name>" as expected.`

L4 — the last clause promises what `check` will name; before the line is pinned, the planner measures it on `buildInventory` (catalog constraint `pk_orders`, declaration deriving `orders_pkey`) in an uncommitted run and reports the raw output. If `check` does not name the constraint, or names it under another line, the clause is rewritten to the measured fact and re-submitted; the 712/R2 trap is not repeated.

