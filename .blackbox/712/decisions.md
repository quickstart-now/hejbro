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

<a id="r6"></a>
## R6 — #873 measured one step earlier: the reading dies in core's foreign-key resolution before writing; proposal §4 corrected

_lead · interpretation · basis 712/R1 (design Q4); task 1.3 red run: TypeError in core table.ts findForeignColumnRef via infer/table.ts inferTable and compose.ts; delta catalog-inference 'takes with it every foreign key … so a starter declaration always loads' · 2026-09-06T02:45Z · ratified: pending_

Task 1.3's red run measured #873 one step earlier than the issue and proposal.md "Why" §4 describe: with a foreign key whose source column is omitted for its name, `inferFromCatalog` does not write a starter that later fails to load — it dies before writing anything, with an unhandled `TypeError` from core's foreign-key resolution (`table.ts` `findForeignColumnRef`: the omitted column is gone from `columns` while the table's `foreignKeys` still name it), so `import`/`pull` produce neither declarations nor a loss report.

Ruling: option (A). proposal.md §4 is corrected to the measured symptom (one sentence, "the reading itself dies with an unhandled error from core's foreign-key resolution before any file is written, so `import` produces neither declarations nor a loss report"); the delta requirement and scenario already state the fix and stay as they are. The remedy is unchanged: an omitted column takes its foreign keys with it before the table is built. The issue gets the measurement as a comment.

<a id="r7"></a>
## R7 — the dropped primary-key name has one way out: check fails on the declared name every run; line, requirement and scenario aligned

_lead · interpretation · basis 712/R5 (L4 procedure); task 1.3 second measurement: check-object-missing on app.orders.orders_pkey plus unmanagedIndexes pk_orders; delta 'the consequence it states SHALL be what hejbro will actually do'; 712/R2 · 2026-09-06T03:38Z · ratified: pending_

Task 1.3's second measurement (L4) settled what `check` does with a primary key whose catalog name is not the derived one: with the constraint `pk_orders` in the database and the declaration deriving `orders_pkey`, `check` both lists `pk_orders` in its unmanaged-index inventory (informational) and reports the declared `orders_pkey` as missing with `check-object-missing` — a failing finding on every run. The lead's delta paragraph, its scenario and the L3 line all offered "keep it and read the inventory line as expected" as a second way out; that way out does not exist, since keeping the name fails `check` every time.

Ruling: option (A), three texts aligned to the one fact.
- L3 (import and pull alike): `Approximated: the primary key "<schema.table.catalog-name>" is declared under the derived name "<derived>" instead -- the DSL derives every primary-key name, so \`generate\`/\`check\` will name this constraint differently from the database. Rename the constraint to "<derived>" in the database; until you do, \`check\` reports the declared "<derived>" as missing on every run and lists "<catalog-name>" in its unmanaged-index inventory.`
- The delta requirement's parenthesis becomes "(rename the constraint in the database to the derived name; keeping it leaves `check` reporting the declared name as missing on every run, beside its inventory line for the catalog's own name)".
- The scenario's THEN becomes "the loss report names `pk_orders` as dropped and states the way out whole, and `check` after `baseline` both lists `pk_orders` in its unmanaged-index inventory and reports the declared `orders_pkey` as missing, exactly as the report said it would".
Option (C) — making `check` accept a differently named primary key — is a `cli-commands` comparison-rule change outside this delta; not opened, since the derived name is the DSL's contract. Task 1.5's live witness gains the primary-key case so both signals are observed on a real server. proposal.md §4 is made self-consistent ("is still carried into the declaration step" in place of "is still written").

<a id="r8"></a>
## R8 — the foreign-key omission line follows its cause: a column lost with its enum type points at renaming the type

_lead · interpretation · basis 712/R3 (no line states a cause not its own); 712/R5 (name-cause sentences); delta 'the consequence it states SHALL be what hejbro will actually do'; crossing row E7 measured in task 1.2 · 2026-09-06T04:55Z · ratified: pending_

Task 1.2 made a second cause for an omitted column (its enum type omitted for its name) and the foreign-key omission line settled in 712/R5 knew only the first (the column's own name): on the crossing input the line said "left out because no declaration can carry its name" and pointed at "rename the column", both wrong for a column that lost its type. The delta's truthfulness rule and 712/R3's "no line states a cause that is not its own" apply.

Ruling: option (A). The foreign-key omission record carries its cause (`"name"` or `"enum"`, with the enum's identifier for the second), and the reason and way-out clauses follow the cause. The name-cause sentences stay as in 712/R5. The enum-cause sentences:
- import: `Omitted: foreign key "<schema.table.name>" -- it is declared on column "<schema.table.column>", which this reading left out with the enum type "<schema.enum>" that types it, so the key cannot be declared either. Next: rename the type in the database, then re-run \`hejbro import\`.`
- pull: the same reason clause, "so the key cannot be carried either. Rename the type in the database, then link the schema repository."
- the target-end variant keeps 712/R5's "it references column …" in place of "it is declared on column …".
The delta needs no change: "a column left out takes with it every foreign key that references it or is referenced through it" names no cause. A mutation reusing the name-cause sentence for the enum cause must redden the crossing row only.

<a id="r9"></a>
## R9 — a foreign key lost at both ends is announced once, its reason on the source end

_lead · interpretation · basis 712/R3 D2 (no object on two lines); 712/R8 (cause-specific clauses); live witness on postgres:17-alpine: an omitted enum type takes both ends of an enum-to-enum foreign key · 2026-09-06T04:56Z · ratified: pending_

Task 1.5's live witness (postgres:17-alpine, the crossing-cell database) printed the same foreign key twice — once for its source end, once for its target end — when one omitted enum type took both of its columns out at once (Postgres allows an enum-to-enum foreign key only over the same type, so losing the type loses both ends). 712/R3 D2 forbids an object on two lines; the unit fixtures had only ever lost one end.

Ruling: option (A). A foreign key is announced on exactly one line; when both ends failed, the reason clause names the source end (the column the key is declared on), and the target end's own loss is on that column's or enum's own line, so nothing is lost. Option (B), naming both ends in one sentence, multiplies the cause/way-out branches of 712/R8 and cannot state one way out when the ends differ in cause; option (C), leaving the duplicate, violates D2. The delta is unchanged (it states neither cause nor count). The dedup shares 712/R8's function and commit; a mutation removing it must redden only the both-ends row.

<a id="r10"></a>
## R10 — review round 1: an omitted column takes its indexes, checks and unique constraints too; two-cause columns name both ways out; the primary-key line states a name collision; ordering sentences narrowed

_lead · interpretation · basis constructor review round 1 (11 databases on postgres:17.11, B1-B3, N1-N6); 712/R3 D2; 712/R5 R8 (reason clauses); delta 'a surviving declaration SHALL never reference an object this reading omitted'; 412/D13; 412/D29 (#1016 #1017 #1018) · 2026-09-06T06:40Z · ratified: pending_

The constructor-mode review (round 1, REWORK, B 3 / N 6) built eleven databases on postgres:17.11 and replayed `import`/`pull`/`baseline`/`migrate`/`check` about fifty times. Rulings on the planner's classification:

- B#1 (an index, check or unique constraint over an omitted column stays in the declarations, so `baseline`'s SQL and `pull`'s vendored `snapshot.sql` fail with `column … does not exist`): fixed here for both causes. The predicate is one — the column was omitted — and excluding the name cause would add a branch, not remove one (412/D13); the tests that move with the pre-existing name-cause behaviour are listed in the PR. The delta's sentence "a column left out takes with it every foreign key that references it" widens to "every index, check, unique constraint and foreign key". Their lines reuse the omitted-index/check skeleton with the reason naming the cause column, import and pull variants; no approximation line is printed for an object the reading omitted (the delta already says so; the unique case printed one).
- B#2 (a column omitted for two causes — its own name and its enum type — reports the name only, so renaming it merely moves it to the enum line): one line stays (712/R3 D2), and its way out names both conditions: rename the column, and rename the enum type and declare it, before the column can be declared.
- B#3 (the primary-key line's way out — rename the constraint to the derived name — is impossible when another relation on the same table already holds that name): the reading already has the catalog, so the line states the collision when it exists ("the derived name is already taken by <relation>; move that first") and stays as it is otherwise. `baseline` emitting the same name twice is #1017.
- N#1, N#2: the delta's ordering sentences are narrowed to what is true — lines are grouped by kind and ordered by code points within each list; "every list the reading orders" (enum values keep catalog order, tables their dependency order).
- N#4: `Not inferred: nothing to infer in schema "<s>"` is not printed for a schema whose omitted objects the report just named.
- N#6: the reference says what an omitted column takes with it.
- Follow-ups under 412/D29: #1016 (a cross-schema handle's columns get arbitrary types; fix), #1017 (baseline's duplicate name; fix), #1018 (server-collation axis and a `compareCodeUnits` unit test; fix, low). Postgres normalising `to public, some_role` to `{public}` is the server's behaviour, a corpus note, not an issue.

Wording settled on the planner's submission M-1–M-6 (approved as submitted): the omitted-index / check-constraint / unique-constraint lines reuse the sibling skeleton with a reason clause naming how the object is bound to the column ("it is declared on column …" for an index or unique constraint, "its expression names column …" for a check), the cause clause in 712/R5's name form or 712/R8's enum form, and the command-specific tail; no approximation line for an omitted unique constraint; the `check` promise in those lines is measured on `buildInventory` before it is pinned. A column omitted for two causes keeps one line whose way out names both renames, stating that renaming the column alone moves it to the enum's line. The primary-key line adds "that name is already taken by another relation in <schema>, so rename that one first" only when a relation in the same schema other than the key's own backing index holds the derived name. The delta's two ordering sentences are scoped to "within each list" and "every list the reading orders by name"; the omission sentence widens to "every index, check and unique constraint that names it, and every foreign key that references it or is referenced through it"; a scenario "An index and a check at an omitted column are omitted with it" is added.

Addendum (lead, 412/R34): the columns an index reads through its expression or predicate come from `pg_depend`, and the authoritative list for an index is the union of its key columns and those dependency rows — a constraint-backed index (`t2_pkey`, `t2_val_key`) depends on `pg_constraint`, not on its columns, so `pg_depend` alone misses even its keys (measured; the live witness caught the single-source implementation). An index with both an expression and a predicate names the omitted column as `its expression or predicate names column`, since the dependency rows do not tell the two apart. A primary key naming an omitted column is omitted whole and announced -- a partial key would be a different constraint.

<a id="r11"></a>
## R11 — generated columns are read, the unread-target sentence narrows to metadata (D106 R1)

_lead · interpretation · basis 712/R1, 412/D29 · 2026-09-07T14:29Z · ratified: pending_

D106 round 1 (evaluation.md) blocked on two findings. B1: a stored generated column is read as a plain column with no line in any band; the delta's first sentence re-asserts "identity and generated markers" and the reviewer's `check --url` against the imported database fails on that column. The root is #1022 (already verdict Fix under 412/D29); the correction round fixes it rather than scoping the sentence, because the sentence is the base requirement's own and scoping it would make the reading's contract smaller than the DSL it targets. The reading emits the DSL's generated-column builder with the catalog's expression text; where the DSL cannot carry what was read, an Approximated line names the column — silence is never an outcome. B2: the scenario "A reference into a schema the run did not name is kept" promises a relation onto a target that has no `Tables` entry, which schema-vendoring's own contract rule forbids (a relation needs a key for its target); the sentence narrows to what is measured true — the foreign-key metadata and `Relationships` carry the reference, no relation exists for it. Non-blocking dispositions (412/D29): N2, N5, N8, N11 are text fixes in this round; N1, N4, N6, N9, N10 are documented in the brownfield reference this round, with N4's "Not inferred" lines filed as a follow-up under #995; N3 (INCLUDE columns dropped silently) filed as a follow-up; N7 is #1016; N12 is an observation.

<a id="r12"></a>
## R12 — a generated column whose expression names an omitted column is omitted and announced, in this round

_lead · interpretation · basis 712/R11, 712/R10 · 2026-09-07T14:39Z · ratified: pending_

Reading generated columns (R11) opens a cell the plain-column reading hid: an expression that names a column the declaration cannot carry (D36 name, or a column of an omitted enum type) would now be emitted verbatim and fail at baseline. The rule the round-1 review settled for objects bound to an omitted column applies unchanged: the generated column itself is omitted and announced under the existing Omitted-line family ("left out because its expression names column <schema.table.column>, which no declaration can carry"), reusing the index/check wording rather than a new form; the delta's enumeration of that family gains "generated column". A generated column of a type with no builder is Approximated, naming what was dropped, only if such a case exists in today's code. Shipping the plumbing while knowing the regression was refused; the wider 2.1 is timed honestly in the ledger.

<a id="r13"></a>
## R13 — not inferred is a third root cause; one rule for every expression-bearing member, no way out today

_lead · interpretation · basis 712/R11, 712/R12 · 2026-09-08T16:40Z · ratified: pending_

The constructor review of the correction round (cfr1-reviewer, 2026-09-08) built a stored generated column whose expression names a column the reading could not infer (a `point` column, "no column builder expresses it"): the generated column survived into the starter, `baseline`/`pull` SQL failed on an empty database with `column "pt" does not exist`, the loss report was silent and `check` reported no difference; a CHECK constraint naming such a column fails the same way and predates the piece. R12 closed the root cause of an omitted expression column to two values (name, enum) on the ground that Postgres forbids a generated column from naming another generated column; that closure was about recursion between generated columns and did not cover a column omitted because its type has no builder. Ruling: "not inferred" is a third root cause, and the rule is one for every member that carries an expression (generated column, check constraint, index predicate where it applies) — the member and everything bound to it are omitted and announced under the existing line family with the root column named; the way out for this cause is the not-inferred column's own (declare it by hand), never a rename. The delta's "so a starter declaration always loads" is universal and admits no pre-existing exception, so the CHECK case is repaired in the same piece. Interpretation of R11/R12; owner ratification queued with them.
The way out for this cause does not exist today: the piece measured that the DSL has no generic column builder (no custom or raw type), so a `point` or `int4range` column cannot be declared by hand either. The line for this cause therefore ends without a `Next:` or rename tail, like the sibling not-inferred column line, keeping only the shared `check` clause that says what would have to be declared for the object to leave the inventory.

<a id="r14"></a>
## R14 — pull mirrors import: the schema list is what was read, absent schemas are announced, an empty pull fails

_lead · extension · basis 712/R11, 412/D23 · 2026-09-08T16:40Z · ratified: pending_

The constructor review of the correction round measured that `pull`'s "pulled <db> (…)" line and the `schemas` list in `hejbro.lock`, after the N11 correction, dropped a schema that was read and then omitted whole, yet kept a schema the database does not hold — a third rule that no specification sentence states, while the base `schema-vendoring` requirement says the lock names "the schemas that were read". Ruling, on the principle that `pull` mirrors `import` wherever both read the same catalog: (1) the line and the lock list exactly the schemas the reading read — a schema omitted whole for its name and a schema absent from the database are not among them, and the delta says so in a sentence; (2) a `--schema` naming a schema the database does not hold or that holds nothing to infer is never silent: `import` was measured to add `Not inferred: nothing to infer in schema "X".` when such a schema is one of several, and to refuse with `import-nothing-to-infer` when every requested schema is such; `pull` mirrors both (`pull-nothing-to-infer`); (3) a `pull` whose every schema is omitted whole for its name fails the way `import-nothing-declarable` does, under `pull-nothing-declarable` with mirrored wording, which also removes the empty-parentheses line. (2) and (3) add surface (a diagnostic and a failure mode), so this is an extension: owner ratification queued; the piece implements it under delegation 412/D23 rather than shipping a lock whose contents no sentence defines.

<a id="r15"></a>
## R15 — an all-omitted schema is announced and refused as nothing-declarable; every line names the way out it has (D106 R2)

_lead · interpretation · basis 712/R11, 712/R14 · 2026-09-08T17:44Z · ratified: pending_

D106 round 2 blocked on two findings. R2-B2: a schema whose only objects are omitted for their names (a table "Only", an enum "Color", a table plus a standalone sequence) was refused as `nothing-to-infer` with an empty report, on `import` and on `pull` (which mirrored it), although requirement 1 says leaving an object out for its name never stops the reading and the report names each of them. Ruling: the classification counts what the reading saw, not what it kept — such a schema prints its report (the Omitted lines and their consequence sentences) and, when nothing at all could be declared or carried, is refused as `nothing-declarable` naming that schema; `nothing-to-infer` is reserved for a schema holding no table, enum, sequence or function, and its text stops promising sequences it does not look at (R2-N3). R2-B1: the round-1 N8(b) correction removed `pull`'s whole way-out parenthetical from the primary-key approximation line while requirement 2's sentence stays universal over commands. Ruling: `pull`'s line names the way out it has (rename the constraint to the derived name) and the delta scopes the `check` clause to `import`, so both sentences are true of both commands. R2-N1 (the foreign-key line under the type cause through a generated column reusing the name-cause words) is fixed in the same round; R2-N2 is stated ("one list per kind and cause"); R2-N4 is #1033, R2-N5 is #1016, R2-N6/N7 are reference sentences. Interpretation of R11/R14.

