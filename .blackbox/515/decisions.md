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

<a id="r3"></a>
## R3 — the five exports: a new core exports pin, five barrel-absence lines, engine placement, values only, tsdoc rewrite, two-stage red

_lead · interpretation · basis R1 · 2026-09-05T19:06Z · ratified: pending_

(A) `packages/core/test/exports.test.ts` is a new file: core has no pin today that an `index` name resolves (its nearest test imports module paths), so the file imports the five from `../src/index` and proves each is a live binding -- `exprChildren` of a comparison yields `[left, right]`, `replaceExprChildren` with identical children returns the same object, each guard throws `invalid-kind-change` for the missing side. (B) The `hejbro` barrel's compile-time absence is one `@ts-expect-error` value use per name, five lines, because the delta's "any of the five" is a universal claim and D110 wants the table; runtime absence stays with the existing `leaked` set and the `HEJBRO_RUNTIME_EXPORTS` equality. (C) `core-surface.ts`: insertions only, alphabetical inside their group -- `exprChildren` and `replaceExprChildren` under "Expression traversal and rewriting", the three guards under "Kinds, registry and presets"; no existing line moves, so the concurrent sf piece cannot collide. (D) `index.ts` gains two export lines in module-path order; values only -- `ExprChildTraversal`, `dispatchEmit` and `EmitOperationHandlers` stay private, because a preset receives nodes and walks or rebuilds them and never mints per-kind entries; the registry tsdoc states in one sentence why this differs from `ClauseTraversal`'s exported type. (E) tsdoc: the registry keeps its mapped-type constraint and replaces the "deliberately not exported / two copies" paragraph with the exported-surface sentence (the table itself stays core's to change, the two functions are the surface); `exprChildren`'s own tsdoc states that `exists`/`selectExpr` do not treat their `query` as a child; `replaceExprChildren` keeps its invariants and gains the surface sentence; `emit-helpers.ts` is not edited (outside 1.1's files, not contradicted; the user-facing guard text is 1.4's reference). (F) Red in two stages so the causal record survives: the new core pin red → two index lines green; then cli's "classifies every runtime export exactly once" red with the five names unclassified → five ENGINE lines green; then the five `@ts-expect-error` lines and `leaked`. Repo-wide `check-types` and `packages/cli/test/exports.test.ts` run right after green.

