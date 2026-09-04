# Decisions — quickstart-now/hejbro#679

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Function argument names get D36 at declaration time

_lead · interpretation · basis D36 · 2026-09-03T00:00Z · ratified: pending_

Ledger R5.

#679: D36 (SQL-name rules) applies to function argument names at declaration time, with the same `invalid-sql-name` wording as columns. The alternative of quoting names in DDL was rejected: names are an explicit design surface, and quoting would spread escaping into function bodies. The cli-smoke `my-arg` fixture moves to a quoted column key.

<a id="r2"></a>
## R2 — Argument-name errors reuse assertSqlName's wording with a function context

_lead · interpretation · basis D36 · 2026-09-03T07:50Z · ratified: pending_

Ledger R17.

#679's error context reuses the existing `assertSqlName` wording with the context `argument "<key>" of function <schema>.<name>`; `identifier-rules.ts` is not modified.

<a id="r3"></a>
## R3 — A __proto__ args literal is refused; the body-rejection sentence is corrected; emit.ts stays with cl

_lead · extension · 2026-09-03T12:05Z · ratified: pending_

Ledger R33.

fd review round 1: (1) an `args: { __proto__: … }` literal was dropped silently — an args object whose prototype is not Object.prototype or null is refused. (2) "Postgres rejects such a body when created" was wrong; corrected to rejection at call time (delta and changeset). (3) the `__proto__` column key lost by the emitter is #697, being fixed in cl — fd does not touch emit.ts and cross-references in the PR body.

Reinforcement (21:10 KST): B1 gets a new code `args-prototype-key` (a literal `__proto__:` key detected as prototype setting), with the scenario split (computed key → `invalid-sql-name`, literal → the new code). B3: fd rebases after cl's PR merges and the reviewer re-observes. N2 is one sentence in skills; N3 (`found` missing from reserved local names) becomes a Bug issue; brownfield candidates join cl's corpus issue. Merge order: cl → fd (rebased); qc independent.

