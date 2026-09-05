# Decisions — quickstart-now/hejbro#742

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The corpus lives beside the surface it exercises; the two uncovered rows are added, the rest are mapped

_lead · interpretation · basis 412/D24, D25, 412/R32; D110 (inputs beside their scenario); the fixtures #739/#740/#697 added after this issue was filed · 2026-09-05T08:55Z · ratified: pending_

Rows 1-5 of the issue already exist as tests: row 1 (`__proto__` column in a hand-written schema.json) = `packages/cli/test/contract-emit.test.ts` "buildSchemaTextWithColumnKey" (#697 R2-N2); row 2 (contract corpus with `__proto__`/controls and integer-like columns) = the same file's key-name and physical-order tables (#740/D4); rows 3-5 (init input matrix, init twice without hejbro resolvable, init --config off-root) = `packages/cli/test/init.test.ts` and `loader.test.ts` (#846 D5, #741). A second copy under examples/brownfield would drift from the tests that already pin them. Added here: row 7 (function argument keys `a"b`, newline, `${danger}`, `__proto__`, `constructor`) as a table in contract-emit.test.ts; row 6 (a view projecting from two joined tables with overlapping column names) as examples/postgres step 10 `app.task_projects`, walked by the chain test, the built-CLI test and the round trip. Ratification: owner on return.

