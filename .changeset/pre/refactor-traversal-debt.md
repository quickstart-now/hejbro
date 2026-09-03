---
"@hejbro/core": patch
---

Internal refactor, no observable behavior change: `packages/core/src/kind/emit-helpers.ts` gains `requireNext`/`requirePrevious`/`requireBoth`, absorbing 31 byte-identical `invalid-kind-change` guards across the ten built-in kinds (#472); `packages/core/src/expr/expr-children.ts` (internal, not exported) gives a single child-position registry for `ExprNode`, replacing four separate handler tables in `walk.ts`, `render-sql.ts`, and `retarget.ts` that restated the same positions (#473). Every guard's existing message text, style, and check order is preserved exactly, including the two combined-message and two opposite-order sites; every `ExprNode` walker's traversal order (window's `fn`/`partitionBy`/`orderBy` included) is unchanged.
