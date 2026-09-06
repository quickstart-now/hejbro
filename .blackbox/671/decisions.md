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
Identity is the plain unquoted `schema.table` the other CLI diagnostics use. Object lines follow the delta's enumeration order (sequences, row-level security, policies, indexes, checks, foreign keys, primary key); a kind with nothing to create has no line; no counts are printed; `Next:` is the body's last line, not a `suggestions` entry. A handover and a new table print nothing under this code; the migration is written either way.

D-3-C, wiring: the `adoption-creates` blocks are rendered before the core warnings, and the stdout summary line counts them together with the core warnings (the summary must match the blocks below it). The three existing assertions on that summary line declare managed tables only and are unaffected, as measured.

