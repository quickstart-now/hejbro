# Decisions — quickstart-now/hejbro#671

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — harden-adoption: adoption creates the table's additive children, normalizes a leftover sequence idempotently, and generate names what it will create

_lead · extension · basis 412/D24, D25; ruling J10 (adoption creates what hejbro manages); the owner's detect-and-name rule (no silent prevention); #694's analysis of fixes A and C; #671 and #668 measurements · 2026-09-05T05:53Z · ratified: pending_

Design (design.md Q1-Q3): (a) for #671 -- indexes, checks, FKs, PK created on adoption, never drops; C scoped by the transition for #694 -- the diff engine's owner-transition knowledge reaches the sequence kind, `create sequence if not exists` + alters on an adopted owner only; `adoption-creates` notice for #668 with the baseline Next. table-declaration MODIFIED; cli-commands ADDED. Ratification: owner on return.

<a id="r2"></a>
## R2 — adoption boundary: plain ALTER-time children, columns untouched, two sequence alters, code-scoped silence

_lead · interpretation · basis 671/R1; design.md Q1-Q2; delta table-declaration (children enumerated: indexes, checks, foreign keys, primary key); base scenarios 'An existing declaration produces no statement'; delta cli-commands 'print nothing under this code' · 2026-09-05T23:11Z · ratified: pending_

Confirms the four contract readings the planner raised at start (a), so the piece's red tables have a fixed boundary:

- Children on adoption render in the ALTER-time forms the table kind already owns (`create index …`, `alter table … add constraint … {primary key|check|foreign key}`), plain — no `if not exists`, no `if not present` guard. A conflict fails at apply time, loudly; only the sequence is idempotent (design Q1, Q2).
- Adoption does not touch columns. The existing declaration is a shape claim and the managed declaration that replaces it is taken to describe the same columns; no `add column`/`alter column`/`drop column` is emitted on the transition. The delta enumerates the children exactly (indexes, checks, foreign keys, primary key) and the base scenarios already pin column silence; a column the managed declaration adds that the database lacks is `check`'s report, and if the witness or the review shows that boundary biting it is filed as a neighbour under #815, never widened here.
- The sequence alters are exactly two statements: `alter sequence … as <type>;` and `alter sequence … owned by <table>.<column>;`. Start, increment, min/max, cache and cycle are untouched by this piece.
- "A handover prints nothing" is scoped to the `adoption-creates` code. Other diagnostics of the same run and their `Next:` lines are unaffected.

<a id="r3"></a>
## R3 — adoption-creates is a cli Diagnostic literal rendered by renderDiagnostics; cited in brownfield-adoption.md; gate gaps are neighbours

_lead · interpretation · basis 671/R1; design.md Q3; delta cli-commands 'prints adoption-creates for widgets … Next: naming hejbro baseline'; packages/cli/src/diagnostics.ts Diagnostic shape; scripts/check-next-marker.mjs 112-138 and check-diagnostic-xref.mjs 105-120 as measured by the piece; #993 #994 · 2026-09-05T23:16Z · ratified: pending_

Settles the two gate questions the planner raised before 1.3, so the diagnostic's shape is fixed before its wording is designed:

- `adoption-creates` is a CLI `Diagnostic` (the type in `packages/cli/src/diagnostics.ts`), built in `generate.ts` as an object literal with `code: "adoption-creates"` and `severity: "warning"`, rendered through `renderDiagnostics` like the command's other diagnostics. That is the `warning[adoption-creates]: <table identity>` shape the delta's "prints `adoption-creates` for `widgets`" describes, and the `Next:` line is part of that rendered text. Landing inside `check:next-marker`'s candidate set (`code: "` literal) and `check:diagnostic-xref`'s DEFINE set follows from the shape; it is not the reason for it. The message wording itself stays 1.3's `[design]` decision.
- The code's citation lives in `skills/hejbro/references/brownfield-adoption.md` (task 1.5, this piece's file), as a literal `warning[adoption-creates]` beside the reference's existing `error[baseline-not-first]` citation. `generate-verify-workflow.md` belongs to the lc piece and is not opened here.
- The two gate gaps the investigation found (next-marker never scans a file whose diagnostics come only from the `diagnostic()` factory; diagnostic-xref never checks that a defined code is cited anywhere) are neighbours: the lead files them under #815; this piece does not touch `scripts/`.

<a id="r4"></a>
## R4 — task 1.1 design: KindChange.transition optional field marks an adopted owner; adoption flows the alter path with children only

_lead · extension · basis 671/R1 (design Q1-Q2); 671/R2 (columns untouched, plain children); D57 (TypeScript-only unions camelCase); .claude/rules/provider-preset.md; measured: core index.ts exports KindChange and ObjectKind, exports.test.ts six-field fixture, bucket-kind.ts and preset-smoke implement ObjectKind, diff-engine.ts:420 ownerIsExisting, notes consumed only by migration-file.ts banner · 2026-09-05T23:19Z · ratified: pending_

Settles task 1.1's `[design]` question — how a kind learns that the owner of the node it is emitting for was just adopted — and the shape of the table's own change on adoption.

D-1, mechanism: option A. `KindChange` gains one optional field, `transition?: "adopted"`, present on every change the engine emits for a node whose owner-or-self went from existing to managed in this run, and absent otherwise (a handover, an unchanged managed owner, a new table). The field is TypeScript-only (camelCase per D57), reaches no generated artifact, and is documented with a tsdoc sentence on the field and one sentence in `skills/hejbro/references/extension-interface.md` (the public `ObjectKind`/`KindChange` surface; that file joins task 1.5's files). `ObjectKind.diff` and `ObjectKind.emit` signatures are unchanged, so the two out-of-core implementations (supabase storage bucket kind, `examples/preset-smoke`) and `packages/core/test/exports.test.ts`'s six-field fixture are untouched. `KindChange.notes` stays banner text and carries no logic. Options B and C were rejected because they move the owner-transition judgement out of the engine's one place (`diff-engine.ts` already holds the authoritative owner node where it suppresses `kind.diff`) into every kind that needs it; option D leaks the table's child inventory into the engine, the direction `provider-preset.md` forbids. Who writes the field is not contract: a single writer (the engine stamping every change it emits for an adopted owner-or-self after `kind.diff` returns) is preferred so no kind can forget it, but the planner decides (631/R12).

D-2, the table's change on adoption: the table kind's transition guard keeps "either side existing → silent" and admits exactly one exception, adoption (previous existing, next managed). A handover stays silent in full, and so do the first declaration, the rename and the removal of an `existingTable()` (previous existing, next absent) — the earlier formulation "next side existing only" would have let a removed existing declaration fall through to `drop table`, which four existing witnesses caught (amended in place by the lead, 412/R34; ratification pending). An adoption flows through the alter path with the column diff suppressed (671/R2) and only the children — indexes, checks, foreign keys, primary key — rendered as creates in the plain ALTER-time forms the kind already owns. The alternative (operation `create` with `emitCreate` skipping `create table`) is rejected: it shares the new-table path and its goldens. Existing witnesses uo9 (handover silence) and uo10 (no column statements on adoption) stay green and are kept as the boundary's control rows.

<a id="r5"></a>
## R5 — task 1.3 design: adoption-creates names children from the table snapshot, one list per adopted table, before core warnings and counted in the summary

_lead · extension · basis 671/R1 (design Q3); 671/R3 (cli Diagnostic literal, Next in the rendered text); delta cli-commands enumeration order; measured: core index.ts exports TableSnapshot/ColumnSnapshot/ForeignKeySnapshot/SequenceSnapshot, contract/read-snapshot.ts and declare-emit/emit.ts precedent, generate-command.test.ts 726/738/750 summary assertions declare managed tables only · 2026-09-06T00:37Z · ratified: pending_

Settles task 1.3's `[design]` question — the text and wiring of `adoption-creates` — on the planner's final submission.

D-3-A, the source of the children's names: read them structurally from the adopted table's `KindChange.next` snapshot node (`indexes[].name`, `checks?.[].name`, `foreignKeys[].name`, `primaryKeyName`), the way `contract/read-snapshot.ts` and `declare-emit/emit.ts` already read a table snapshot in the CLI; `TableSnapshot`, `ColumnSnapshot`, `ForeignKeySnapshot` and `SequenceSnapshot` are public exports, so no core change and no new public surface. Sequences, row-level security and policies arrive as their own adopted changes (the engine stamps `transition` on every kind implementing `ownerTableIdentity`) and are named from their identities. `KindChange.notes` is never parsed: it is banner text.

D-3-B, the text: one diagnostic per adopted table, rendered through `renderDiagnostics` as
```
warning[adoption-creates]: <schema>.<table>
  adoption creates objects for a table hejbro did not create; apply fails if the database already holds any of them
  sequence "<schema>.<sequence>"
  row-level security
  policy "<name>"
  index "<name>"
  check "<name>"
  foreign key "<name>"
  primary key "<name>"
  Next: if the database already holds these, run "hejbro baseline" to record them instead of applying this migration.
```
Identity is the plain unquoted `schema.table` the other CLI diagnostics use. Object lines follow the delta's enumeration order (sequences, row-level security, policies, indexes, checks, foreign keys, primary key); when one run adopts several tables their blocks are ordered by table identity (`schema.table`, byte order), not by the order the changes happen to arrive in (added in place by the lead, 412/R34); a kind with nothing to create has no line; no counts are printed; `Next:` is the body's last line, not a `suggestions` entry. A handover and a new table print nothing under this code; the migration is written either way.

D-3-C, wiring: the `adoption-creates` blocks are rendered before the core warnings, and the stdout summary line counts them together with the core warnings (the summary must match the blocks below it). The three existing assertions on that summary line declare managed tables only and are unaffected, as measured.

<a id="r6"></a>
## R6 — adoption does not set the owning column's default; a default the database lacks is check's inventory

_lead · interpretation · basis 671/R2 (columns untouched on adoption); delta table-declaration (sequence altered to its declared type and ownership); #694 round trip keeps the column default because a handover drops nothing; tasks.md 1.4 witness · 2026-09-06T00:46Z · ratified: pending_

The planner asked, before task 1.4, whether adoption should also emit `alter column … set default nextval(…)` for the adopted table's `serial` column, since the brand-new-table path emits that deferred statement and the adoption path does not.

Ruling: it does not. The default is an attribute of the owning column, and 671/R2 fixes that adoption touches no column; the delta promises only that the sequence is created idempotently and altered to its declared type and ownership. In the handover-then-adoption round trip (#694) the column's default survives the handover because a handover drops nothing, so the live witness's "`check` reports no differences" is expected to hold; a table adopted from a database that never had the default is `check`'s inventory to report, and the user's `baseline` or fix, not adoption's business. If task 1.4's witness does show a `check` difference, the raw output comes to the lead before anything is changed — the test is not adjusted to pass, and the contract is not widened by the implementer.

<a id="r7"></a>
## R7 — task 1.4: the round-trip clause is narrowed to a sequence-only declaration; two live witnesses; the general round trip is #1009

_lead · interpretation · basis 671/R1 (children created on adoption); 671/R4 (plain ALTER-time children); J10 (a handover drops nothing); task 1.4 live witness 42P16 on postgres:17-alpine; #694; #1009 · 2026-09-06T01:59Z · ratified: pending_

Task 1.4's live witness (postgres:17-alpine) ran managed → handover → re-adoption with a declaration carrying a primary key, an index, row-level security and a policy, and the re-adoption failed at apply with `42P16` (duplicate primary key). The handover snapshot keeps only the existing declaration's columns, so re-adoption emits creates for every managed object, and the database — which a handover never touches — still holds them. The delta scenario's closing clause ("the same declaration handed back to `existingTable()` and adopted again applies cleanly on a database that kept the sequence") was written when the sequence was the only known obstacle (#694); with 671/R1's children and J10's policies it is true only for a declaration whose sole managed object is its serial sequence. Lead's artifact error.

Ruling: option (C). The contract is narrowed to what is true and the general round trip becomes its own change:
- The scenario clause becomes "— while a declaration whose only managed object is that sequence, handed back to `existingTable()` and adopted again, applies cleanly on a database that kept the sequence; a declaration with more (policies, indexes, constraints) is named by `adoption-creates` on re-adoption and `hejbro baseline` records what the database holds". Task 1.4 splits into two witnesses: (C-1) sequence-only round trip — `42P07` gone, apply succeeds, `check` reports no differences; (C-2) brownfield adoption of a bare table created by `psql` — `existingTable()` then `table()` with an index, a check, a foreign key and a primary key: the four children exist in the catalog afterwards and `check` reports no differences. Together they witness every sentence the scenario still makes.
- Options (A) idempotent children — `add constraint` has no `if not exists`, and `drop … if exists` before create would drop what adoption promises never to drop and silently replace a different definition; (B) a handover snapshot that remembers the children, and (D) widening this piece to do (B), are rejected here: (B) is the right design and is filed as #1009 (fix, medium, its own change with a design step).
- 671/R6 is unaffected: the witness reports what `check` says about the column default in both C-1 and C-2 before anything is adjusted.

<a id="r8"></a>
## R8 — review B1: adoption-creates names the missing-column risk and check --url; no generate-time refusal (a partial existing declaration is by design); N4 fixed in the piece; B2 N3 N1 wording

_lead · extension · basis 671/R2; 671/R3 R5; constructor review round 1 B1 with controls p6/p7/p9 and the A/B against fd92e4bb (B1 and N4 are this piece's); owner rule #220 (detect + options + commands, no prevention on incomplete information); lead's first ruling withdrawn · 2026-09-06T04:05Z · ratified: pending_

The constructor-mode review (round 1, B1) adopted a table while adding a column in the same edit — `existingTable()` carrying `{id, name}` replaced by `table()` carrying `{id, name, email}` with an index, a check or a foreign key on `email` — and the child was emitted against a column the database does not have: `migrate` fails with `42703` and the whole migration, primary key included, rolls back. The delta's "every index, check, foreign key and primary key the declaration carries is created" read as universal, and the piece's tests never built the crossing cell (partial-column cells carried no children; child cells matched columns exactly). The review then measured the control p7 — the column present in the database but absent from the `existingTable()` list — applying cleanly, and confirmed by an A/B against `fd92e4bb` that both the failure and the stray `not-null-without-default` warning (N4) are this piece's: before it, adoption emitted nothing.

Ruling, revised once. The lead first ruled a generate-time refusal keyed on the existing declaration's columns; the review showed that `generate` cannot tell p6 (column missing in the database) from p7 (column present, merely unlisted) — the declarations and the snapshot are identical, only the database differs — and that `existingTable()` is by design a partial claim, so the refusal would have turned a common, working shape into a refusal. That ruling is withdrawn. B1 is settled the way the owner's rule for platform-inherited failure modes settles it (detect, options, commands — never a prevention feature on incomplete information): the migration is still written and fails loudly at apply, and the user is told beforehand where to look.
- `adoption-creates` gains a second risk sentence after its first line: "apply also fails if the database lacks a column one of these objects needs — `hejbro check --url <url>` names such a column before you migrate", and its `Next:` becomes "if the database already holds these, run `hejbro baseline` to record them instead of applying this migration; if it lacks a column, add the column in a following edit and adopt with the columns the database has". The block stays a warning; nothing about exit codes or file writing changes.
- The `table-declaration` scenario's THEN gains the clause "a child on a column the database lacks fails at apply time, and `check --url` names the column beforehand"; the `cli-commands` requirement text carries the second risk sentence.
- N4 is fixed in this piece: on an adoption no column-level warning is raised for the adopted table (`not-null-without-default` fires for a column adoption never adds — the review's A/B shows the base emitted no warning), because adoption emits no column statement (671/R2); the managed path is unchanged.
- B2 — the ADDED requirement and its scenario say "one diagnostic per adopted table that the migration creates anything for; a table with nothing to create is adopted silently". N3 — the delta's round-trip parenthesis drops "policies" and reads "(indexes, checks, foreign keys, a primary key)": the review measured a declaration with row-level security, a policy and a sequence round-tripping cleanly. N1 — the reference's not-created list gets its column sentence back ("adoption never adds, changes or drops a column; a column the managed declaration adds and the database lacks is `check`'s `check-object-missing`, and the way to add it is a following edit").
- The input table gains the crossing cell in both directions: {index, check, foreign key} × {column carried by the existing declaration → created; column absent → still created, the notice carries the second sentence}, the p7 and p9 controls as live witnesses (p7 applies cleanly; p9 — adopt with the database's columns, then add the column and its objects in a following edit — applies and `check` reports no differences), and p6 as the live witness that the apply fails with `42703` and `check --url` names the column first.

<a id="r9"></a>
## R9 — the primary key is created on adoption whatever the existing side listed (D106 R1 B1)

_lead · interpretation · basis 671/R1, 671/R2 · 2026-09-07T14:29Z · ratified: pending_

D106 round 1 (evaluation.md B1) measured that a primary key the existing declaration already listed is named by `adoption-creates` but never created: the migration skips it because the existing side's snapshot recorded it, while the foreign-key cell with the same shape is created. The delta's sentence is universal ("every index, check, foreign key and primary key the declaration carries is created"), and the notice already derives its lines from the managed declaration, so the migration follows the sentence: on the existing → managed transition the primary key is created like the other children, the existing side never suppressing a create. Consequence accepted: a table whose only child is a primary key present on both sides, adopted silently before, now creates it and is named by the notice — the delta's own silent cell is "nothing to create", and a declared primary key is something to create. Interpretation of R1/R2 (adoption creates the declared children; never drops, never touches a column).

<a id="r10"></a>
## R10 — the Next: first branch must run on the database it describes; measured fork (D106 R1 B2)

_lead · extension · basis 671/R3, 671/R8 · 2026-09-07T14:29Z · ratified: pending_

D106 round 1 (evaluation.md B2) measured that the notice's first branch, `hejbro baseline`, cannot run after any adoption: adoption needs a previous snapshot, which only a previous generate or baseline writes, so migrations/ is never empty and `baseline-not-first` always refuses; the delta's scenario sentence "hejbro baseline records what the database already holds" was never true of the shipped command, and the reference states both the way through and its refusal two paragraphs apart. Ruling: a `Next:` names only a path that runs on the database it describes. Which path is settled by one measurement the piece makes first: whether `hejbro migrate` registers a mid-chain migration carrying the baseline marker without running it (migration-apply, "A baseline is registered rather than run", whose requirement text covers any migration carrying the marker while its scenario shows the first). If it does, the first branch names that path and the reference documents it as the way to record already-held objects mid-chain. If it does not, the first branch says to keep the table handed over (restore the two files this run wrote) or to drop the held objects and apply, the scenario sentence says exactly that, and a follow-up under #995 asks for a mid-chain registration path. The lead confirms the branch on the measured answer before text is written. Extension: the delta's contract sentence changes either way; owner ratification queued.

<a id="r11"></a>
## R11 — branch (b) of R10 confirmed on measurement: the Next: names the two paths that run today

_lead · interpretation · basis 671/R10 · 2026-09-08T14:54Z · ratified: pending_

Branch (b) of R10 is confirmed on the piece's measurements (har1-researcher, two independent reproductions, logs under /private/tmp/har1-research/logs/): (A) `hejbro migrate` does register a mid-chain migration carrying the baseline marker without running it (`registered` origin, `check` no differences, `verify` passing); (B) nothing but `hejbro baseline` writes that marker, `generate` has no flag for it, the skill documents no insertion, and `migration-format` states the marker appears on a baseline migration only with a scenario pinning that a `generate`-written migration parses as marker-absent — so the only path today is a hand edit of a generated file, which is not a contract; (C) the revert path needs the migration, the snapshot and the declaration restored (two files alone leave `verify` at `snapshot-stale`), and the drop path completes only when the sequence is kept (dropping it leaves `check-object-differs` with no `generate` recovery; the first failure becomes `42P16` once the primary key is created). The `Next:` first branch therefore names those two paths, the delta and the reference say the same, and the mid-chain registration surface is #1037 (a D28-class decision for the owner). The ledger row for the drop path is `applied`, never `registered`, which is the ledger-side proof of the branch.

<a id="r12"></a>
## R12 — the banner names the primary key on every adoption that creates one (D106 R1 F3, NB-3)

_lead · interpretation · basis 671/R9 · 2026-09-08T14:54Z · ratified: pending_

D106 R1 review F3 found that a PK-only adoption printed a banner with no note list at all. The first repair added the note only when the adoption had no other field diff, on the reasoning that other notes already expose the change; the reviewer's twelve-cell measurement then showed adoptions that create a primary key beside an index, a check or a foreign key named the PK in only three of eleven cells — a rule no reader could predict. Ruling (reversing the lead's first "by design"): on the adoption path the banner names the primary key whenever the migration creates one, since no other adoption-path note reports it, so this is not double exposure; managed-to-managed banners (where `column … changed` already reports the PK membership) and new-table banners (PK inline in `create table`) are unchanged and are the regression face (mutation removing the `isAdoption` barrier reddens 58 core tests and 10 goldens). A `column "id" changed` note beside `primary key … added` on an adoption whose existing side lacked the PK is the #1001 family, not this piece's.

Recorded as work entry W5 (its basis field names R9, the rule this ruling interprets); the core generate test cites this ruling.

