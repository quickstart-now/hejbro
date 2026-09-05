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

