# Work — quickstart-now/hejbro#765

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Skill set-operation section aligned with the query-type-inference requirement

_2026-09-05T05:14Z_

Two corrections in skills/hejbro/references/query-layer.md (## Set operations): the mismatched-key refusal is attributed to TypeScript's name-keyed row type, with the measured fact that Postgres accepts differently-named branches by position; and a new paragraph documents the core-built `execute()` arm (left branch only, object projection widened with null) that packages/query/src/db/db.ts ~200-211 and the query-type-inference scenario "A core-built set operation executed on a handle reads back as its left branch" already state. #738 tracks widening that arm.

