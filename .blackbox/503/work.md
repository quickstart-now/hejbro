# Work — quickstart-now/hejbro#503

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — the r6 ruling gains a third paragraph after the measurement

_2026-09-05T18:08Z · per R6_

R6 gained a third paragraph after the measurement: two sentences of the requirement that predate it -- the `42804`-only refusal code and the implicit-cast unification sentence -- are corrected under the same reading, and the delta edits land with it.

<a id="w2"></a>
## W2 — the family fold's compile cost measured against the pre-rule baseline

_2026-09-05T18:50Z · per R4_

Measured on `packages/core` with `tsc --noEmit --extendedDiagnostics`, three conditions: the rule with its 11x11 matrix test (252096 instantiations, check 4.18s), the rule without the matrix test (242575, 4.14s), and the pre-rule baseline (229899, 4.06s); the consumer leg `packages/query` moves 303819 -> 311367 (+2.5%) against a baseline built without the rule. The family fold itself costs about 5.5% of core's instantiations and the exhaustive matrix test about 3.9% -- +9.7% instantiations and +3.0% check time in total. The 2.54x wall-clock reading that stopped H-2 earlier was host load, not the rule: the ra and lc pieces' full gates ran concurrently on this host and that run reported 322% cpu.

Measured once more with the lead's own isolation, `select.ts` swapped back to a2219196 while the matrix test stays in place: 238046 instantiations, check 3.98s. Against that, the fold alone costs 1.059x instantiations -- the pre-rule baseline above (229899) removes the matrix test as well, so this is the number the 2x regression threshold applies to. The `packages/query` baseline reproduced to the digit across two runs (303819).

<a id="w3"></a>
## W3 — the family rule landed on three surfaces with its measured table

_2026-09-05T19:35Z · per R1, R4, R5, R7, R9, R10_

Group 1 (the whole change) landed the type-family rule on all three set-operation surfaces this repository has: core's combinators, a recursive CTE's anchor/recursive-term pair, and the chain's own combinators. The rule's input is a measured table, not an assumption -- on postgres:17, the ten concrete type families' ordered pairs (100 cells), each family against an untyped literal (20 cells), and a 25-type homogeneity sweep (250 cells) were probed with `union all` and `pg_typeof`; every cross-family pair is refused (84 x `42804`, 6 x `42846`), no cross-family pair unifies, and the untyped literal matches every family. The vendored table (`setOpUnifiableFamilies` in `packages/core/src/query/select.ts`) lists, per family, the families it unifies with -- today each family lists only itself. `SetOpResult` folds a new `SetOpFamiliesRefused<TLeft, TRight>` verdict over the shared key set on top of its existing key-set check, refusing a pair only when both sides are a single literal family the table marks refused; a wide `Expr` union, a `Table` projection's symbol-keyed `tableMeta`, and `"unknown"` on either side all stay accepted (never stricter than the database, R1/R4).

The chain surface could not reuse `SetOpResult` directly: its combinators are typed by the resolved row (`SelectResult<...>`), which carries no family and cannot be inverted, and folding `SetOpResult`'s own key-set check there would refuse a `Table` projection against an object projection the server accepts (a false refusal). So the chain stage now carries its own projection as an optional phantom brand (`chainProjectionBrand`, `packages/query/src/db/chain-projection.ts`, the `leftJoinedBrand` precedent, R7/R9) and the chain's six combinators apply `SetOpFamiliesRefused` alone, exported as one type-only symbol from core's own barrel (R9/R10) -- key and shape stay the existing row-based `CompatibleBranch`'s job. A branch carrying no brand (a `related()` terminal) infers no projection and is accepted, fail-open (R9 decision 4). The barrel-export premise for the brand itself was measured false: rolldown's dts bundler names the symbol from its own module path because the public stage types reference it structurally, so no barrel export, no `core-surface.ts` touch, and no pin churn were needed (R9 amendment).

Each task carries its own mutation evidence. 1.1: deleting a family's row from `sqlTypeFamilies` without adding a matching entry to `setOpUnifiableFamilies` fails the enumeration test, naming the family. 1.2a: removing `net` from its own list in the vendored table (`net: []`) reddens exactly one cell of the exhaustive 11x11 type-matrix assertion, naming the pair `["net", "net"]`, and nothing else. 1.2b: removing `& ChainProjectionBrand<TProjection>` from `SelectChainLimited` reddens only the brand-existence row (extracted with `infer`, never by comparing whole stage types -- that passes vacuously). 1.2c: `SelectChainSetOp` and `SetOpChainCombinators` each declare their own six combinators (a pre-existing duplication, not introduced here -- flagged for a possible follow-up, not resolved in this change); removing `CompatibleChainProjection` from the first's own `union` reddens only the plain-refusal row, and removing it from the second's own `union` reddens only the row that chains a second combinator onto a combined stage -- two mutations, each pinning exactly one row.

A repo-wide `check-types --continue` after 1.2a's own implementation found exactly one regression outside this piece's own files: `packages/core/test/query/select.test.ts:1058` incidentally unioned a `text` column with a `uuid` column while testing an unrelated order-by output-column guard; the pair is now refused by design, and the guard's column was swapped to a same-family one so its own coverage survives (R8). A 2.54x wall-clock reading that briefly stopped 1.2a turned out to be host load (concurrent pieces' own gates), not the rule: four isolated `tsc --extendedDiagnostics` conditions showed the family fold costs about 5.9% more instantiations than a pre-rule baseline, and the chain's own consumption of it costs about 2.5% more, both reproducible to the digit.

