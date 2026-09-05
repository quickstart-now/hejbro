# Decisions — quickstart-now/hejbro#515

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Core exports its expression traversal registry and kind-change guards as extension surface; the four copies fold

_lead · extension · basis 412/D24, 412/D25; .claude/rules/provider-preset.md (a preset needing a core special case means the interface is wrong); the SELECT_CLAUSE_TRAVERSALS precedent; #444's four hand-written traversal sites · 2026-09-05T05:44Z · ratified: pending_

Design (design.md Q1-Q3): five names exported from @hejbro/core as engine surface (never the hejbro barrel), the query lifter and the supabase validator walk through exprChildren/replaceExprChildren, the two kinds use requireNext/requirePrevious/requireBoth; codec's NODE_KIND_TO_SNAPSHOT and reachable-kinds stay separate ledgers (naming.md). package-surface: one ADDED requirement. Ratification: owner on return.

<a id="r2"></a>
## R2 — folded guards name the kind token; expr-children.ts joins task 1.1; the lifter keeps three branches

_lead · interpretation · basis R1 · 2026-09-05T18:55Z · ratified: pending_

(1) A guard folded into core's exported helpers names the change by its kind token (`supabase-storage-bucket … change is missing its next snapshot`, `smoke-schema-note …`), as core's own kinds already do (`function create change …`, `view alter change …`); the display labels the inline guards used disappear with them. The two string pins in `packages/supabase/test/storage-bucket-kind.test.ts` (lines 385, 399) move to the new wording. Keeping the labels would need a label parameter on the helpers -- a core signature change outside this piece -- and not folding defeats the piece. The delta gains one sentence under the guards scenario: "A guard folded into the exported helpers names the change by its kind token, as core's own kinds do; the refusal code is unchanged."

(2) `packages/core/src/expr/expr-children.ts` joins task 1.1's files: its `EXPR_CHILD_TRAVERSALS` tsdoc states the table is deliberately not exported and names the two copies this piece folds -- a constraint this piece reverses, and a comment states constraints only, so it is rewritten to describe the exported registry as extension surface in the same commit that exports it.

(3) After the fold `liftExprNode` keeps three branches by design: `literal` (the node itself becomes `$n`), `exists`/`selectExpr` (descend into the `SelectNode` through `liftSelectNode`, since the registry deliberately does not treat a query as an expression child), and everything else through `exprChildren`/`replaceExprChildren`; the per-kind child-position table (16 rows) is deleted. Task 1.2's green target is that shape; its falsifying mutations are dropping the last child and swapping two children inside the `replaceExprChildren` call, each named with the rows it must redden.

