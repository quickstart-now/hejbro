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

