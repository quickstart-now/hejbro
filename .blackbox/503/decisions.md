# Decisions — quickstart-now/hejbro#503

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Cross-family set-operation branches are refused at build time by a measured pair table; unknown is a wildcard; #489 stays separate

_lead · extension · basis 412/D24, D25; the 42804 measurement in #503; hejbro never stricter than Postgres (plpgsql-function-bodies precedent); #489's within-family scope · 2026-09-05T11:00Z · ratified: pending_

Design (design.md Q1-Q4): "unknown" matches every family; the refused pairs are measured on postgres:17 and vendored as the type test's input table (a family without a row fails the enumeration); the rule lives in SetOpResult so core, chain and recursive terms share it; within-family divergence is stated as not covered. query-type-inference ADDED only (no MODIFIED, so it lands in either order with widen-set-op-execute). Ratification: owner on return.

<a id="r2"></a>
## R2 — #966 folds into this change: the recursive anchor/term pair is the third surface

_lead · extension · basis R1 · 2026-09-05T17:38Z · ratified: pending_

The D106 round-1 review of harden-recursive-nullability (archived in #968) filed #966: an anchor `name: nodes.name` (text) against a recursive term `name: nodes.id` (integer) type-checks and the server refuses it with 42804. That is exactly the third surface R1 already names -- the recursive anchor/term pair consumes SetOpResult's compatibility test -- so #966 folds into harden-set-op-families under 412/R2 (several issues, one change, one PR) instead of opening as its own change. Consequences: the PR closes #503 and #966; task 1.2's recursive-term rows include #966's own input (text anchor, integer term, one shared key) as a named row, red first; the ADDED requirement keeps #966's neighbour reading in mind -- the same-family requirement's framing must not read as though a family-level check existed before this change, because this change is that check. The measured pair table (task 1.1) is the only source of which pairs are refused; #966's text/integer pair is one measurement in it, not an assumption.

<a id="r3"></a>
## R3 — the measurement protocol: 42804 alone means refused, union all, one representative per family plus a homogeneity sweep

_lead · interpretation · basis R1 · 2026-09-05T17:47Z · ratified: pending_

Task 1.1 measures which family pairs Postgres refuses to unify. Protocol: (1) Only SQLSTATE `42804` counts as refused. A value-level error after type resolution (`22P02` invalid input syntax and its kin) means the types unified and the literal was bad, so it records as unified; the probe uses a literal valid in the target type where one exists and `null` otherwise, and design.md states this distinction in one line. (2) Every probe is `union all`, not `union`: `union` needs an equality operator on the unified type and `json` has none (`42883 could not identify an equality operator`), which would read as a refusal that has nothing to do with type unification; `union all` exercises exactly the unification step and nothing else. (3) The vendored table is the 10 x 10 matrix over one representative per concrete family plus each family against an untyped literal, as tasks.md says; representatives: numeric -> `numeric`, datetime -> `timestamptz`, net -> `inet`, array -> `text[]`, json -> `jsonb`, the rest their own name. (4) A homogeneity sweep runs once in the same container over every concrete type name in `TYPE_NAME_TO_FAMILY` (the `serial` shorthands measured as `integer`/`smallint`/`bigint`, `json` measured beside `jsonb`) to confirm each family answers alike; the sweep's result is one summary line in design.md and does not grow the vendored table. If any family answers differently for two of its own types, the task stops and reports -- that is a family-design question, not a row. Server version and the reproduction SQL land in design.md.

<a id="r4"></a>
## R4 — never only for two single-literal families the table refuses; every other shape is accepted; core's type-test naming

_lead · interpretation · basis R1 · 2026-09-05T17:47Z · ratified: pending_

`SetOpResult` folds to `never` for a key exactly when both branches' `family` for that key is a single literal member of `sqlTypeFamilies` and the vendored table marks that ordered pair refused. Every other shape is accepted: a union-typed family (a wide `Expr`), a key with no `family` at all (a `Table` projection's `tableMeta` symbol key), and `"unknown"` on either side -- the direct consequence of R1's "never stricter than the database": the type layer refuses only what it can prove the server refuses. The check is written so the conditional does not distribute over a union family (a wide `Expr` must not be refused because one of its members would be). Task 1.2's table carries the falsifying rows for each clause -- a wide `Expr` against a concrete family accepted; a symbol-keyed projection accepted -- together with the mutation that reddens the table-driven rows: deleting one refused pair from the vendored table must turn exactly that pair's `@ts-expect-error` rows red on all three surfaces and nothing else. Naming: this repository's `*.types.test.ts` suffix means a tsc-spawning suite in the `test:types` phase, which `packages/core` does not have; the new files follow core's own convention (`set-op-family-types.test.ts`, beside `select-join-types.test.ts`), and tasks.md's Files-edited glob is corrected to that form in the same commit. The red judge for these files is `pnpm check-types` (tsc), so red is reported as tsc diagnostics; the enumeration test's runtime half runs under vitest.

<a id="r5"></a>
## R5 — 42846 is a refusal too; the four same-family refusals are a gap not a false refusal; the table is a per-family record

_lead · interpretation · basis R3 · 2026-09-05T18:00Z · ratified: pending_

Measured on PostgreSQL 17.11: every one of the 90 cross-family cells is refused (84 x `42804`, 6 x `42846`); the 250-cell homogeneity sweep shows every concrete type answers like its family toward every other family; the untyped literal unifies with all ten families and takes the other side's type. Rulings. (1) `42846` joins `42804` as "refused": both are failures of type resolution before any row is read -- Postgres answers `42804` when the two types' `typcategory` differ and `42846` when they share a category but no cast unifies them -- and no cell produced a value-level error, so R3's protocol stands with two codes instead of one; design.md states the two codes and why they split in one line. (2) The stop condition of R3 is lifted: the four same-family divergences (enum <-> text `42804`; time, timetz <-> timestamptz `42846`; json <-> jsonb `42846`; macaddr <-> inet `42804`) sit only in same-family cells, where R4's rule never fires, so they can produce a missed refusal, never a false one -- "never stricter than the database" holds. They are the within-family gap the requirement already declares, wider than its `int`/`bigint` example, and are tracked as #977 (a concrete-type test would need the expression to carry the concrete type name, which only `ColumnRef` does today); splitting families would change core vocabulary across files outside this piece and is not taken. (3) The vendored table is a `readonly` record keyed by family whose value is the list of families the server unifies it with -- today each family lists itself alone; a right-hand family absent from the left's list is refused. This matches tasks.md's record wording and the enumeration scenario, and a future measured unification adds one entry. The mutation that must redden task 1.2's table-driven rows becomes: removing a family from its own list turns exactly that family's same-family acceptance rows red on all three surfaces and nothing else.

<a id="r6"></a>
## R6 — the unified-pair scenario names the pairs that exist; the within-family paragraph names the four refusals

_lead · interpretation · basis R1 · 2026-09-05T18:00Z · ratified: pending_

Scenario *A pair the server unifies stays accepted* has no cross-family instance on postgres:17, and a scenario without an input contradicts D110. It is rewritten to name the pairs that exist:
```
#### Scenario: A pair the server unifies stays accepted
- **WHEN** the two branches' families for a key are the same, or either side's family is `"unknown"` -- the only pairs the server unifies (measured: no cross-family pair unifies on postgres:17)
- **THEN** the combinator accepts the branches and the key's result type is unchanged
```
The within-family paragraph of the requirement gains one sentence after its `int`/`bigint` example: "The same granularity also lets through four same-family pairs the server refuses -- `json` against `jsonb`, `time` or `timetz` against `timestamptz`, `macaddr` against `inet`, an enum against `text` -- tracked as #977; this requirement states the gap and does not close it." design.md records the reproduction SQL, the server version, the two SQLSTATEs, the sweep summary and the four names.

Two more sentences predate the measurement and are corrected with the same reading. The requirement's opening names `42804` alone as the refusal; the server has two type-resolution refusals and the table holds both, so the opening and the first scenario's THEN name `42804` or `42846`. The opening's 'A pair the server unifies through an implicit cast SHALL stay accepted' has no cross-family instance; it is replaced by the sentence that states which pairs unify.

