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

