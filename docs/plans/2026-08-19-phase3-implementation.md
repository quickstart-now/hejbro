# Phase 3 Implementation Plan — function/trigger builder DSL + plpgsql compiler

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `defineFunction`/`defineTrigger` record a typed body AST at build time (executed twice, hard error on divergence) and compile it to deterministic plpgsql, closing with a golden-file port of the original production schema's `comments-single-depth` trigger.

**Architecture:** A new `plpgsqlRef` expression node lets bodies reference NEW/OLD fields, function args, and locals without touching the Phase 2 `columnRef` invariants. A recording `BodyContext` (`ctx.if`/`ctx.row`/`ctx.rowOrNull`/`ctx.raise`/`ctx.return`) builds a JSON-safe `FunctionBody` tree; the body callback runs twice and the two trees must be `stableJson`-identical. Two new `ObjectKind`s (`function`, `trigger`) plug into the existing registry/diff/emit pipeline; functions diff on structured signature + body hash (`create or replace` vs drop+create), triggers always recreate.

**Tech Stack:** TypeScript strict (repo rules: no `any`/`let`/`for`/`while`/ternary), vitest, existing golden-file harness. `@hejbro/core` stays pure — no fs, no DB, zero runtime deps.

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` (§5.2, §5.3, §6, §7; decision log D1–D19). Roadmap: `docs/plans/2026-08-19-roadmap.md` §Phase 3. Tracking issue: quickstart-now/hejbro#4.

## Global Constraints

- `@hejbro/core` is **PURE**: no fs, no DB, no runtime dependencies (AGENTS.md hard rule).
- Own-source style: no `any`, no `let`/`var`, no `for`/`while`, no ternary; exhaustive `switch` + `assertNever` for every tagged union.
- All GitHub-facing text in English; conventional commits `<type>(core): <subject>` ≤ 72 chars lower-case.
- Every task lands as its own PR to `upstream/dev` (squash merge, `Closes #<sub-issue>`), branch pushed to `upstream` (org repo), verified with `git ls-remote --heads upstream <branch>`.
- Before claiming any task done: `pnpm check`, `pnpm check-types`, `pnpm test` all pass — show output.
- Snapshot version stays **2** (new kinds are additive keys in `Snapshot.objects`; no shape change to existing entries).

## Approved phase decisions (2026-08-19, owner-approved via main — record; do not re-litigate)

| # | Decision |
|---|----------|
| A1 | New `ExprNode` variant `plpgsqlRef` (`{ nodeKind: "plpgsqlRef", path: string[] }`) represents NEW/OLD fields, function args, and locals. `columnRef` unchanged. |
| A2 | Row reads declare **one scalar local per projected column**, never a `record` variable. Name = `${rowName}_${snake(projectionKey)}`; `rowName` from the optional second arg of `ctx.row`/`ctx.rowOrNull`, else deterministic counter `row_1`, `row_2`, …. Strictness is in the method name: `ctx.row` → `select … into strict`; `ctx.rowOrNull` → `select … into` (fields NULL on no row). |
| A3 | **Dual quoting policy**: DB object identifiers always quoted (existing `quoteIdentifier`); plpgsql local identifiers (locals, arg names, `new`/`old` and their fields) rendered **unquoted**, guarded by a reserved-word blocklist that raises `reserved-local-name` at declaration time. |
| A4 | Determinism guard compares the two recorded trees **structurally** via `stableJson`, at `defineFunction`/`defineTrigger` call time. Real-JS-`if` detection stays impossible at runtime (proxy truthiness); the `Expr<"boolean">` parameter type on `ctx.if` is the compile-time defence; ESLint plugin remains v1.x. |
| A5 | Function snapshot stores structured signature (arg names+types in order, returns, security, language) + body hash. `create or replace` **only when the signature JSON is identical** and only the body hash differs; any signature difference emits drop+create. |
| A6 | Acceptance = golden-file text + human semantic-equivalence review (real-PG round-trip is Phase 7). Generated SQL is **not** byte-identical to the hand-written original: no FROM alias (columns render fully qualified), default function name `${triggerName}_fn`. |
| A7 | `defineTrigger` config gains optional `functionName` (default `${name}_fn`). |
| A8 | Errors always carry the object identity; `declaredAt` is filled best-effort by parsing `new Error().stack` at the `defineFunction`/`defineTrigger` call site (identity-only when parsing fails). |
| A9 | Loops (`ctx.forEach`) are **out of this plan**; tracked as a separate late-phase sub-issue. |
| A10 | `ctx.raise` = message string literal + variadic args, always `raise exception`, `%` placeholder count validated against arg count (`%%` is a literal). `ctx.return` accepts only a trigger row (`new`/`old`) or a `.returning()`-final query. `ctx.if` returns an `IfChain` (`elseIf`/`else`) fixed now. |
| A11 | **(owner-approved 2026-08-19)** Function snapshot node additionally stores the rendered `bodySql` next to `bodyHash`, because `ObjectKind.emit` renders from snapshot nodes only (Phase 1 contract, `kind/object-kind.ts:47`) and cannot reach the declaration. Hash remains the change-detection key per §6.4. Task 5 updates the §6.4 wording and adds the decision-log entry (rationale: emit must reproduce from the snapshot alone; drizzle-kit stores full SQL in snapshots as precedent). |

**Planner scope rulings (not owner-level):** the Phase-2 core extensions (plpgsqlRef node, select stage metadata, `renderSelectInto`) land inside Task 1, not as a separate pre-phase PR. `defineFunction`'s `grants` config key from §5.2 is **deferred to Phase 4** (grants kind doesn't exist yet). Body statements render single-line per statement (consistent with Phase 2 renderers), one tab of indentation inside `begin`/`end` and `declare`; `if` bodies indent one extra tab. Fixed dollar-quote tag `$function$` with a `body-contains-dollar-tag` compile error if the rendered body contains it. No validation that a body ends in `return` (Postgres reports it at runtime; revisit with real-PG CI in Phase 7).

## File structure

```
packages/core/src/
  expr/ast.ts                 (modify: PlpgsqlRefNode + union)
  expr/render-sql.ts          (modify: plpgsqlRef case, renderSelectInto)
  query/select.ts             (modify: stage metadata + generics)
  error.ts                    (modify: optional declaredAt on throw helper)
  declaration-site.ts         (create: captureDeclarationSite)
  plpgsql/reserved.ts         (create: reserved-word blocklist + assert)
  plpgsql/body-ast.ts         (create: FunctionBody statement nodes)
  plpgsql/body-context.ts     (create: recording BodyContext + proxies)
  plpgsql/body-hash.ts        (create: fnv1a hex hash)
  plpgsql/render-body.ts      (create: plpgsql emitter)
  dsl/define-function.ts      (create: defineFunction + double-run guard)
  dsl/define-trigger.ts       (create: defineTrigger + double-run guard)
  kinds/function-kind.ts      (create: ObjectKind)
  kinds/trigger-kind.ts       (create: ObjectKind)
  kind/registry.ts            (modify: register both)
  engine/generate.ts          (modify: expand trigger input into two declarations)
  index.ts                    (modify: exports)
packages/core/test/
  expr/plpgsql-ref.test.ts    (create)
  query/select-into.test.ts   (create)
  plpgsql/body-context.test.ts(create)
  plpgsql/render-body.test.ts (create)
  plpgsql/guard.test.ts       (create)
  function-kind.test.ts       (create)
  trigger-kind.test.ts        (create)
  golden/cases/comments-single-depth/  (create: declarations.ts, steps.ts, expected/)
```

---

### Task 1: plpgsql reference AST node and select-into rendering foundation

Sub-issue: "feat(core): plpgsql reference AST node and select-into rendering foundation". Branch `feat/phase3-plpgsql-ref`.

**Files:**
- Modify: `packages/core/src/expr/ast.ts`
- Modify: `packages/core/src/expr/render-sql.ts`
- Modify: `packages/core/src/query/select.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/expr/plpgsql-ref.test.ts`, `packages/core/test/query/select-into.test.ts`

**Interfaces:**
- Consumes: existing `ExprNode`, `renderExpr`, `renderSelect`, `SelectProjection`, `Table`.
- Produces (later tasks rely on these exact shapes):
  - `type PlpgsqlRefNode = { readonly nodeKind: "plpgsqlRef"; readonly path: ReadonlyArray<string> }` — member of `ExprNode`; renders as `path.join(".")` (unquoted, A3); `collectColumnRefs` returns `[]` for it; not in `compositeNodeKinds`.
  - `select()` stages carry runtime metadata and a phantom projection: `SelectLimited<TProjection extends SelectProjection = SelectProjection> = { readonly selectQuery: SelectNode; readonly fromTable: Table; readonly projectionInput: TProjection }`; `SelectOrdered<TProjection>`, `SelectFiltered<TProjection>`, `SelectJoinable<TProjection>` follow; `select<TProjection extends SelectProjection>(projection: TProjection, from?: Table): SelectJoinable<TProjection>`.
  - `renderSelectInto(query: SelectNode, intoVariables: ReadonlyArray<string>, options: { readonly strict: boolean }, outerScope?: ReadonlyArray<TableRefNode>): string` exported from `render-sql.ts` — same clause order as `renderSelect` with `into [strict ]a, b` inserted directly after the projection clause.

- [ ] **Step 1: Failing tests for the node + rendering**

```ts
// test/expr/plpgsql-ref.test.ts
import { describe, expect, it } from "vitest";
import { collectColumnRefs, expr, renderExpr } from "../../src/index";
import { eq, isNull } from "../../src/index";

const newParentId = expr("uuid", {
	nodeKind: "plpgsqlRef",
	path: ["new", "parent_id"],
});

describe("plpgsqlRef", () => {
	it("renders dot-joined and unquoted", () => {
		expect(renderExpr(newParentId.exprNode)).toBe("new.parent_id");
	});
	it("renders single-segment locals", () => {
		expect(
			renderExpr({ nodeKind: "plpgsqlRef", path: ["parent_post_id"] }),
		).toBe("parent_post_id");
	});
	it("composes with operators without parenthesization", () => {
		expect(renderExpr(isNull(newParentId).exprNode)).toBe(
			"new.parent_id is null",
		);
	});
	it("is invisible to column scope validation", () => {
		expect(collectColumnRefs(newParentId.exprNode)).toEqual([]);
	});
});
```

```ts
// test/query/select-into.test.ts
import { describe, expect, it } from "vitest";
import { renderSelectInto, schema, select, table, uuid } from "../../src/index";
import { eq, expr } from "../../src/index";

const app = schema("app");
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	parentId: uuid(),
});
const refNewParent = expr("uuid", {
	nodeKind: "plpgsqlRef",
	path: ["new", "parent_id"],
});

describe("renderSelectInto", () => {
	const query = select(
		{ postId: comments.postId, parentId: comments.parentId },
		comments,
	).where(eq(comments.id, refNewParent));

	it("inserts into after the projection (non-strict)", () => {
		expect(
			renderSelectInto(query.selectQuery, ["parent_post_id", "parent_parent_id"], {
				strict: false,
			}),
		).toBe(
			'select "app"."comments"."post_id" as "post_id", "app"."comments"."parent_id" as "parent_id" into parent_post_id, parent_parent_id from "app"."comments" where "app"."comments"."id" = new.parent_id',
		);
	});
	it("renders strict", () => {
		expect(
			renderSelectInto(query.selectQuery, ["v"], { strict: true }),
		).toContain("into strict v from");
	});
});

describe("select stage metadata", () => {
	it("keeps fromTable and projectionInput through the chain", () => {
		const staged = select(comments).where(eq(comments.id, refNewParent));
		expect(staged.fromTable).toBe(comments);
		expect(staged.projectionInput).toBe(comments);
	});
});
```

Note: `eq(comments.id, refNewParent)` — Phase 2 operators accept `Expr` right-hand sides of the same family; a plain `Expr<"uuid">` built from a `plpgsqlRef` node needs no operator change.

- [ ] **Step 2: Run tests, verify failure** — `pnpm --filter @hejbro/core test -- plpgsql-ref select-into` — expected: type error / "plpgsqlRef" not assignable, `renderSelectInto` not exported.

- [ ] **Step 3: Implement**
  - `ast.ts`: add `PlpgsqlRefNode` after `ColumnRefNode`; add to `ExprNode` union; export the type.
  - `render-sql.ts`: `case "plpgsqlRef": return node.path.join(".");` in `renderExpr`; `case "plpgsqlRef": return [];` in `collectColumnRefs`; do **not** add to `compositeNodeKinds`. Add `renderSelectInto`: copy `renderSelect`'s scope/validation body, build clauses as `[selectClause, intoClause, fromClause, joinsSql, whereClause, orderByClause, limitClause]` where `intoClause` is `into ${vars.join(", ")}` or `into strict ${vars.join(", ")}`; reject empty `intoVariables` with `throwHejbroError("empty-into-list", "renderSelectInto() received no target variables — pass at least one local name.")`. Refactor shared clause assembly out of `renderSelect` only if the duplication is exact ("A+C" rule from Phase 1).
  - `select.ts`: add `fromTable`/`projectionInput` to the object literal in `makeStages` (thread both through every stage rebuild), generify the four stage types with `TProjection extends SelectProjection = SelectProjection` and `select` itself. `resolveProjection` already returns `fromTable`.
  - `index.ts`: export `PlpgsqlRefNode` type and `renderSelectInto`.

- [ ] **Step 4: Run full gate** — `pnpm check && pnpm check-types && pnpm test` — all pass (existing Phase 2 tests prove backward compatibility of the select generics).

- [ ] **Step 5: Commit** — `feat(core): plpgsql reference ast node and select-into rendering`

---

### Task 2: defineFunction/defineTrigger surface and recording body context

Sub-issue: "feat(core): defineFunction/defineTrigger surface and body recording context". Branch `feat/phase3-define-surface`.

**Files:**
- Create: `packages/core/src/plpgsql/reserved.ts`, `packages/core/src/plpgsql/body-ast.ts`, `packages/core/src/plpgsql/body-context.ts`, `packages/core/src/dsl/define-function.ts`, `packages/core/src/dsl/define-trigger.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/plpgsql/body-context.test.ts`

**Interfaces:**
- Consumes: `PlpgsqlRefNode`, `SelectLimited<TProjection>` (Task 1), `Expr`, `ColumnRef`, `Table`, `getTableMeta`, `toSnakeCase`, `TypeNode`, `liftOperand`, `InsertFinal`/`UpdateFinal`/`DeleteFinal`.
- Produces (Tasks 3–5 rely on these exact shapes):

```ts
// body-ast.ts — all JSON-safe (stableJson-serializable)
export type PlpgsqlVarDeclaration = {
	readonly name: string;
	readonly typeNode: TypeNode;
};
export type IfBranch = {
	readonly condition: ExprNode;
	readonly statements: ReadonlyArray<BodyStatement>;
};
export type BodyStatement =
	| {
			readonly stmtKind: "selectInto";
			readonly query: SelectNode;
			readonly strict: boolean;
			readonly intoVariables: ReadonlyArray<string>;
	  }
	| {
			readonly stmtKind: "if";
			readonly branches: ReadonlyArray<IfBranch>; // [if, ...elsif]
			readonly elseStatements: ReadonlyArray<BodyStatement> | null;
	  }
	| {
			readonly stmtKind: "raise";
			readonly message: string;
			readonly args: ReadonlyArray<ExprNode>;
	  }
	| { readonly stmtKind: "returnRef"; readonly refName: string } // "new" | "old"
	| { readonly stmtKind: "returnQuery"; readonly query: QueryNode };
export type FunctionBody = {
	readonly declarations: ReadonlyArray<PlpgsqlVarDeclaration>;
	readonly statements: ReadonlyArray<BodyStatement>;
};
```

```ts
// body-context.ts
export type RaiseArg = Expr | string | number | boolean | Date | null;
export type RowProjection = Table | Record<string, ColumnRef>;
export type RowColumns<TProjection extends RowProjection> = /* mapped Expr fields, see step 3 */;
export type IfChain = {
	readonly elseIf: (condition: Expr<"boolean">, branch: () => void) => IfChain;
	readonly else: (branch: () => void) => void;
};
export type TriggerRow<TTable extends Table> = {
	readonly [K in keyof TTable as TTable[K] extends ColumnRef ? K : never]:
		TTable[K] extends ColumnRef<infer TFamily> ? Expr<TFamily> : never;
} & { readonly [triggerRowMeta]: "new" | "old" };
export type ReturnableQuery = SelectLimited | InsertFinal | UpdateFinal | DeleteFinal;
export type BodyContext = {
	readonly row: <TProjection extends RowProjection>(
		query: SelectLimited<TProjection>, name?: string) => RowColumns<TProjection>;
	readonly rowOrNull: <TProjection extends RowProjection>(
		query: SelectLimited<TProjection>, name?: string) => RowColumns<TProjection>;
	readonly if: (condition: Expr<"boolean">, thenBranch: () => void) => IfChain;
	readonly raise: (message: string, ...args: ReadonlyArray<RaiseArg>) => void;
	readonly return: (value: TriggerRow<Table> | ReturnableQuery) => void;
};
// internal factory, also used by Task 3's guard:
export const createRecordingContext = (identity: string, declaredAt: string | null):
	{ readonly ctx: BodyContext; readonly finish: () => FunctionBody };
```

```ts
// define-function.ts / define-trigger.ts (declarations consumed by Task 4 kinds)
export type FunctionReturns = Table | { readonly returnsKind: "trigger" } | TypeNode;
export type FunctionDeclaration = {
	readonly declarationKind: "function";
	readonly schemaName: string;
	readonly functionName: string;
	readonly args: ReadonlyArray<{ readonly argName: string; readonly typeNode: TypeNode }>;
	readonly returns:
		| { readonly returnsKind: "trigger" }
		| { readonly returnsKind: "setofTable"; readonly schemaName: string; readonly tableName: string }
		| { readonly returnsKind: "scalar"; readonly typeNode: TypeNode };
	readonly security: "invoker" | "definer";
	readonly body: FunctionBody;
	readonly declaredAt: string | null;
};
export const defineFunction = <TArgs extends Record<string, ColumnBuilder>>(
	schemaName: string,
	functionName: string,
	config: { readonly args?: TArgs; readonly returns?: Table | TypeNode; readonly security?: "invoker" | "definer" },
	body: (ctx: BodyContext, args: ArgRefs<TArgs>) => void,
): FunctionDeclaration;

export type TriggerEventInput = "insert" | "update" | "delete" | { readonly update: ReadonlyArray<string> };
export type TriggerDeclaration = {
	readonly declarationKind: "trigger";
	readonly schemaName: string;
	readonly tableName: string;
	readonly triggerName: string;
	readonly timing: "before" | "after";
	readonly events: ReadonlyArray<
		| { readonly event: "insert" }
		| { readonly event: "delete" }
		| { readonly event: "update"; readonly columns: ReadonlyArray<string> | null }
	>;
	readonly forEach: "row" | "statement";
	readonly functionName: string;
	readonly functionDeclaration: FunctionDeclaration; // expanded by generate.ts in Task 4
	readonly declaredAt: string | null;
};
export const defineTrigger = <TTable extends Table>(
	target: TTable,
	config: {
		readonly name: string;
		readonly timing: "before" | "after";
		readonly events: ReadonlyArray<TriggerEventInput>;
		readonly forEach: "row" | "statement";
		readonly functionName?: string;
	},
	body: (ctx: BodyContext, rows: { readonly new: TriggerRow<TTable>; readonly old: TriggerRow<TTable> }) => void,
): TriggerDeclaration;
```

(For this task, `defineFunction`/`defineTrigger` run the body **once**; Task 3 adds the second run + comparison inside the same call.)

- [ ] **Step 1: Failing tests** — `test/plpgsql/body-context.test.ts` covering, with the `app.comments` table from Task 1's test:

```ts
// abridged — write all of these as real cases:
it("records rowOrNull as non-strict selectInto with derived scalar names", () => {
	const declaration = defineTrigger(comments, config, (ctx, { new: row }) => {
		const parent = ctx.rowOrNull(
			select({ postId: comments.postId, parentId: comments.parentId }, comments)
				.where(eq(comments.id, row.parentId)),
			"parent",
		);
		ctx.if(isNull(parent.postId), () => {
			ctx.raise("parent missing (parent_id=%)", row.parentId);
		});
		ctx.return(row);
	});
	expect(declaration.functionDeclaration.body.declarations).toEqual([
		{ name: "parent_post_id", typeNode: { typeName: "uuid" } },
		{ name: "parent_parent_id", typeNode: { typeName: "uuid" } },
	]);
	const [selectInto, ifStmt, returnStmt] = declaration.functionDeclaration.body.statements;
	expect(selectInto).toMatchObject({ stmtKind: "selectInto", strict: false,
		intoVariables: ["parent_post_id", "parent_parent_id"] });
	expect(returnStmt).toEqual({ stmtKind: "returnRef", refName: "new" });
});
it("auto-names unnamed rows deterministically (row_1, row_2)", …);
it("ctx.row records strict: true", …);
it("new/old proxies record plpgsqlRef paths with snake_cased fields", () => {
	// row.parentId.exprNode === { nodeKind: "plpgsqlRef", path: ["new", "parent_id"] }
});
it("elseIf/else chain records ordered branches", …);
it("raise placeholder/arg mismatch throws raise-arg-count-mismatch (%% is literal)", …);
it("duplicate row name throws duplicate-local-name", …);
it("reserved local name throws reserved-local-name", () => {
	// ctx.rowOrNull(select(comments).where(...), "user") → composed names fine,
	// but defineFunction arg key `when` → "when" is reserved → error
});
it("derived-expression projection throws row-projection-not-column", …);
it("ctx.return of a RowColumns object throws unsupported-return-value", …);
it("unknown update-of column throws unknown-trigger-column", …);
it("defineFunction args become ArgRefs with plpgsqlRef paths and snake_cased names", …);
```

- [ ] **Step 2: Run, verify failure** — modules don't exist.

- [ ] **Step 3: Implement**
  - `reserved.ts`: `export const reservedPlpgsqlNames: ReadonlySet<string>` — the PL/pgSQL + SQL reserved words that break unquoted locals: `all, and, any, array, as, asc, asymmetric, begin, between, both, by, case, cast, check, collate, column, constraint, create, current_date, current_role, current_time, current_timestamp, current_user, declare, default, deferrable, desc, distinct, do, else, end, exception, execute, exists, false, fetch, for, foreach, foreign, from, get, grant, group, having, if, in, initially, intersect, into, leading, limit, localtime, localtimestamp, loop, new, not, null, offset, old, on, only, or, order, perform, placing, primary, raise, references, return, returning, select, session_user, some, strict, symmetric, table, then, to, trailing, true, union, unique, user, using, variadic, when, where, while, window, with`. Export `assertValidLocalName(name: string, identity: string, declaredAt: string | null): void` throwing `reserved-local-name` — message: `` `local name "${name}" in ${identity} collides with a plpgsql/SQL reserved word — rename it (reserved words cannot be used unquoted in a function body).` ``
  - `body-ast.ts`: the types above, nothing else.
  - `body-context.ts`: `createRecordingContext` holds a mutable frame stack (`Array<Array<BodyStatement>>` inside the closure — allowed, it's `const` bindings over mutating arrays via `push`), a `Set<string>` of declared local names, and a row counter. `ctx.if` pushes a frame, invokes the branch, pops, appends an `if` statement, and returns an `IfChain` whose `elseIf`/`else` mutate that just-appended statement's `branches`/`elseStatements` (locate it by reference). Row methods: resolve projection entries via `projectionInput` — for a `Table`, use `getTableMeta(...).columns` paired with the table's column keys; for an object, require each value `isColumnRef` (has `typeNode`), else `row-projection-not-column`. Compose names, `assertValidLocalName` each, record `selectInto`, and return the mapped `Expr` object (each field `expr(family, { nodeKind: "plpgsqlRef", path: [varName] })`). `ctx.raise`: count `%` minus `%%` occurrences (`message.replaceAll("%%", "").split("%").length - 1`), compare to `args.length`, lift args via `liftOperand`. `ctx.return`: `triggerRowMeta in value` → `returnRef`; `"selectQuery" in value` → `returnQuery` with `value.selectQuery` (same for `insertQuery`/`updateQuery`/`deleteQuery`); anything else → `unsupported-return-value` (message per designer copy: "…isn't a trigger row (new/old) or a query with .returning() — pass one of those").
  - `define-function.ts`: normalize config (default `security: "invoker"`), snake_case + validate arg names, build `ArgRefs` (`Expr` per arg with `path: [snakeArgName]`), capture `declaredAt` (Task 3 wires the real capture; stub `null` here), create context, run body once, `finish()`.
  - `define-trigger.ts`: validate `update`-event columns against `getTableMeta(target)` column names after snake_casing (`unknown-trigger-column`, designer copy), build `new`/`old` proxies (plain objects, not JS `Proxy` — map every column key eagerly), compose the inner `FunctionDeclaration` (`returns: { returnsKind: "trigger" }`, same schema as the table, `functionName ?? `${config.name}_fn``).
  - `index.ts`: export everything public above.

- [ ] **Step 4: Run full gate** — `pnpm check && pnpm check-types && pnpm test`.

- [ ] **Step 5: Commit** — `feat(core): defineFunction/defineTrigger surface and recording body context`

---

### Task 3: double-execution determinism guard and declaration-site errors

Sub-issue: "feat(core): double-execution determinism guard and declaration-site errors". Branch `feat/phase3-determinism-guard`.

**Files:**
- Create: `packages/core/src/declaration-site.ts`
- Modify: `packages/core/src/error.ts`, `packages/core/src/dsl/define-function.ts`, `packages/core/src/dsl/define-trigger.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/plpgsql/guard.test.ts`

**Interfaces:**
- Consumes: `createRecordingContext`, `stableJson`, `FunctionBody`.
- Produces:
  - `error.ts`: `throwHejbroError(code: string, message: string, declaredAt?: string | null): never` and `hejbroError(code, message, declaredAt?)` — optional third param defaulting to `null`; all existing call sites compile unchanged.
  - `declaration-site.ts`: `captureDeclarationSite(): string | null` — reads `new Error().stack`, returns the first `file:line:col` whose path is outside `packages/core/src` (and outside `node_modules`), `null` if unavailable. Pure (no fs — string parsing only).
  - `define-function.ts`/`define-trigger.ts` now run the body callback **twice** with fresh contexts and compare `stableJson(firstBody) === stableJson(secondBody)`; on mismatch throw `nondeterministic-body` with the designer-approved message (below), `declaredAt` attached.

- [ ] **Step 1: Failing tests**

```ts
// test/plpgsql/guard.test.ts
it("accepts a deterministic body (runs it exactly twice)", () => {
	const runs: Array<number> = [];
	defineTrigger(comments, config, (ctx, { new: row }) => {
		runs.push(1);
		ctx.return(row);
	});
	expect(runs).toHaveLength(2);
});
it("throws nondeterministic-body when the two trees differ", () => {
	const flips: Array<number> = [];
	expect(() =>
		defineTrigger(comments, config, (ctx, { new: row }) => {
			flips.push(1);
			if (flips.length === 1) {
				ctx.raise("only on the first run");
			}
			ctx.return(row);
		}),
	).toThrowError(/produced two different recorded ASTs/);
});
it("attaches identity and best-effort declaredAt to the error", () => {
	// catch the HejbroError, expect error.declaredAt to be a string containing
	// "guard.test.ts" (or null on stack-less runtimes — assert the field exists)
});
```

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Implement.** Guard message (exact copy): `` `function "${identity}" produced two different recorded ASTs when its body ran twice at build time — the body must be pure and deterministic (no real if/for/while, Date.now(), Math.random(), or reads of mutable outer state). Replace real branching with ctx.if(), and non-deterministic values with the DSL's own now()/genRandomUuid() helpers.` `` Wire `captureDeclarationSite()` into both define entry points; pass `declaredAt` down into `createRecordingContext` so every recording-time error (`raise-arg-count-mismatch`, `duplicate-local-name`, …) also carries it.

- [ ] **Step 4: Full gate.** — `pnpm check && pnpm check-types && pnpm test`

- [ ] **Step 5: Commit** — `feat(core): double-execution determinism guard with declaration-site errors`

---

### Task 4: plpgsql emitter and function/trigger object kinds

Sub-issue: "feat(core): plpgsql emitter and function/trigger object kinds" (#48). Branch `feat/phase3-emitter-kinds`. A11 approved: function snapshot stores `bodySql` alongside `bodyHash`.

**Files:**
- Create: `packages/core/src/plpgsql/render-body.ts`, `packages/core/src/plpgsql/body-hash.ts`, `packages/core/src/kinds/function-kind.ts`, `packages/core/src/kinds/trigger-kind.ts`
- Modify: `packages/core/src/kind/registry.ts`, `packages/core/src/engine/generate.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/plpgsql/render-body.test.ts`, `packages/core/test/function-kind.test.ts`, `packages/core/test/trigger-kind.test.ts`

**Interfaces:**
- Consumes: `FunctionBody`, `FunctionDeclaration`, `TriggerDeclaration`, `renderSelectInto`, `renderExpr`, `renderQuery`, `renderTypeNode`, `quoteStringLiteral`, `qualifyName`, `statement`, `stableJson`.
- Produces:
  - `body-hash.ts`: `export const fnv1aHex = (text: string): string` — 32-bit FNV-1a, 8-char lower hex, no deps.
  - `render-body.ts`: `renderFunctionSql(declaration: FunctionDeclaration): string` — full `create or replace function …;` text; `renderTriggerSql(t: TriggerSnapshotShape): ReadonlyArray<string>` — `[dropTriggerIfExists, createTrigger]`.
  - Function snapshot node: `{ schema, name, args: [{ name, type }], returns: string, security, language: "plpgsql", bodyHash, bodySql }` where `returns` is the rendered clause (`"trigger"`, `` `setof ${qualifyName(schema, table)}` ``, or `renderTypeNode(t)`), `type` is `renderTypeNode(argType)`, `bodySql` the full statement text, `bodyHash = fnv1aHex(bodySql)`. Identity: `` `${schema}.${name}` ``.
  - Trigger snapshot node: `{ schema, table, name, timing, events: [{ event, columns }], forEach, functionName }`. Identity: `` `${schema}.${table}.${name}` ``.
  - `functionKind: ObjectKind<FunctionDeclaration>` — `kind: "function"`, `dependsOn: ["schema", "enum", "table"]`. Diff: create/drop as enum-kind; both present → equal signature JSON (everything except `bodyHash`/`bodySql`) and equal `bodyHash` → no change; equal signature, different hash → single `alter` change, note `"body changed"`, emit `create or replace` from `next.bodySql`; different signature → **single `alter` change** (note `"signature changed; recreating"`) whose emit returns the SQL pair in order: `drop function ${qualifyName}(${argTypes.join(", ")});` from `previous`, then the create from `next.bodySql`. *(Amended after #55/PR #56: recreates must never be two separate KindChanges — the engine's global create-before-drop ordering would split the pair.)*
  - `triggerKind: ObjectKind<TriggerDeclaration>` — `kind: "trigger"`, `dependsOn: ["function", "table"]`. Any field difference → **single `alter` change** (note `"trigger changed; recreating"`) whose emit returns both statements from `renderTriggerSql` (drop-if-exists then create — idempotent recreate per §6.5, same amendment as above). `emit` on create returns the same pair; on drop returns only the `drop trigger if exists`.
  - `generate.ts`: `resolveDeclaration` expands a `TriggerDeclaration` input into `[declaration.functionDeclaration, declaration]` (make it `resolveDeclarations` returning an array and `flatMap` at the call site).
  - `registry.ts`: `createDefaultRegistry` additionally registers `functionKind` then `triggerKind`.

**plpgsql text format (deterministic, tab-indented, exact):**

```sql
create or replace function "app"."comments_single_depth_fn"()
returns trigger
language plpgsql
as $function$
declare
	parent_post_id uuid;
	parent_parent_id uuid;
begin
	if new.parent_id is null then
		return new;
	end if;
	select "app"."comments"."post_id" as "post_id", "app"."comments"."parent_id" as "parent_id" into parent_post_id, parent_parent_id from "app"."comments" where "app"."comments"."id" = new.parent_id;
	if parent_post_id is null then
		raise exception '부모 댓글을 찾을 수 없다 (parent_id=%)', new.parent_id;
	end if;
	return new;
end;
$function$;
```

Rules: header lines unindented; `security definer` line inserted between `returns` and `language` only when definer; `declare` section omitted entirely when no locals; each statement single-line at its nesting depth (base depth 1 tab, `if` bodies +1); `elsif`/`else` lines at the `if`'s depth; args in the signature as `${argName} ${renderTypeNode(type)}` comma-joined (unquoted names, A3); raise via `quoteStringLiteral(message)` then comma-joined rendered args. Guard: if the assembled body text contains `$function$`, throw `body-contains-dollar-tag` (`` `the function body's rendered SQL for ${identity} contains the literal $function$, which collides with the dollar-quote tag — remove or rephrase that string.` `` — identity in the message body per A8, amended at Task 4 review). Trigger text:

```sql
drop trigger if exists "comments_single_depth" on "app"."comments";
create trigger "comments_single_depth"
	before insert or update of "parent_id", "post_id" on "app"."comments"
	for each row execute function "app"."comments_single_depth_fn"();
```

Events render in **declaration order**, ` or `-joined; `update` with columns renders `update of ${quoted, comma-joined}`; timing/forEach lower-case as declared.

- [ ] **Step 1: Failing render tests** (`render-body.test.ts`): full-text assertions for (a) the exact function SQL above built from a real `defineTrigger` declaration, (b) a definer + args function via `defineFunction("app", "publish_post", { args: { postId: uuid() }, returns: posts, security: "definer" }, …)` asserting the `create or replace function "app"."publish_post"(post_id uuid)` / `returns setof "app"."posts"` / `security definer` lines and a `return query update … returning …;` statement, (c) the trigger pair above, (d) `body-contains-dollar-tag`.
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement `render-body.ts` + `body-hash.ts`** until render tests pass.
- [ ] **Step 4: Failing kind tests** (`function-kind.test.ts`, `trigger-kind.test.ts`): serialize shape; identify; diff matrix — create, drop, no-change, body-only change (`alter` + note `body changed`), arg-type change (drop+create + note), trigger field change (drop+create); emit per operation; `createDefaultRegistry` registers both; `generateMigration` end-to-end with a trigger input expands the function first (assert SQL ordering: create function before create trigger — the diff engine's `dependsOn` topological order provides this).
- [ ] **Step 5: Run, verify failure, implement kinds + registry + generate expansion.**
- [ ] **Step 6: Full gate** — `pnpm check && pnpm check-types && pnpm test`.
- [ ] **Step 7: Commit** — `feat(core): plpgsql emitter and function/trigger object kinds`

---

### Task 5: comments-single-depth golden acceptance case + phase close-out

Sub-issue: "test(core): comments-single-depth golden acceptance case". Branch `feat/phase3-golden-acceptance`.

**Files:**
- Create: `packages/core/test/golden/cases/comments-single-depth/declarations.ts`, `…/steps.ts`, `…/expected/` (recorded via `UPDATE_GOLDEN=1`)
- Modify: `docs/plans/2026-08-19-roadmap.md` (Phase 3 section → landed summary), `docs/specs/2026-08-19-hejbro-design.md` (append new decisions D20+ to the decision log per owner instruction — additions only, never edits to D1–D19)

**Interfaces:** Consumes the full Task 1–4 surface; no new exports.

- [ ] **Step 1: Write `declarations.ts`** — the 1:1 port (this exact code is the acceptance artifact):

```ts
import { schema, table, uuid, text, timestamptz } from "../../../../src/index";
import {
	defineTrigger, select, eq, ne, isNull, isNotNull,
} from "../../../../src/index";

export const app = schema("app");
export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull().unique(),
	publishedAt: timestamptz(),
});
export const comments = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	postId: uuid().notNull(),
	parentId: uuid(),
	body: text().notNull(),
});

export const commentsSingleDepth = defineTrigger(comments, {
	name: "comments_single_depth",
	timing: "before",
	events: ["insert", { update: ["parentId", "postId"] }],
	forEach: "row",
	functionName: "comments_enforce_single_depth",
}, (ctx, { new: row }) => {
	ctx.if(isNull(row.parentId), () => {
		ctx.return(row);
	});
	const parent = ctx.rowOrNull(
		select({ postId: comments.postId, parentId: comments.parentId }, comments)
			.where(eq(comments.id, row.parentId)),
		"parent",
	);
	ctx.if(isNull(parent.postId), () => {
		ctx.raise("부모 댓글을 찾을 수 없다 (parent_id=%)", row.parentId);
	});
	ctx.if(isNotNull(parent.parentId), () => {
		ctx.raise("답글은 한 단계까지만 달 수 있다 (parent_id=%)", row.parentId);
	});
	ctx.if(ne(parent.postId, row.postId), () => {
		ctx.raise(
			"답글은 부모와 같은 글에 달아야 한다 (post_id=%, 부모의 post_id=%)",
			row.postId, parent.postId,
		);
	});
	ctx.return(row);
});
```

(Note: the FK from `comments.postId`/`parentId` is omitted here to keep the case focused; the raise messages stay Korean byte-for-byte — they are user data, not GitHub-facing text.)

- [ ] **Step 2: Write `steps.ts`** — step 0: `[app, posts, comments, commentsSingleDepth]` (from empty); step 1: same but the trigger body's first raise message changed (define a second trigger declaration inline) — proves body-only change emits `create or replace function` **without** touching the trigger; step 2: same as step 1 with `events: ["insert"]` — proves a trigger-def change emits drop+create of the trigger only.
- [ ] **Step 3: Record goldens** — `UPDATE_GOLDEN=1 pnpm --filter @hejbro/core test -- golden`, then **manually review** `expected/from-empty.sql` against the hand-written original (the original project's migrations, `20260815110756_smiling_whizzer.sql` lines 203–241) for semantic equivalence: same guard conditions, same raise messages/args, same trigger timing/events/granularity, `into` targets carry the same nullability behavior (non-strict). Document the intentional textual differences (no FROM alias; fully-qualified columns; single-line statements) in the PR body.
- [ ] **Step 4: Full gate + determinism check** — `pnpm check && pnpm check-types && pnpm test` (the golden harness's determinism describe block already re-runs the first step twice).
- [ ] **Step 5: Update roadmap + spec decision log** — roadmap Phase 3 section rewritten in the "Landed:" style of Phases 1–2, including brainstorm-resolution summary (A1–A11); append D20+ entries for: plpgsqlRef node + dual quoting (A1/A3), scalar-locals row reads (A2), structural double-run guard (A4), signature-identity replace rule (A5), bodySql-in-snapshot (A11, as answered). Mark `ctx.forEach` sub-issue as the remaining open item or explicitly carried over.
- [ ] **Step 6: Commit** — `test(core): comments-single-depth golden acceptance case and phase 3 close-out`

---

### Task 6: ctx.forEach loop construct (#50 — approved to land in-phase, 2026-08-19)

Sub-issue: "feat(core): ctx.forEach loop construct" (#50). Branch `feat/phase3-foreach` off fresh `upstream/dev` (post-#57).

**Files:**
- Modify: `packages/core/src/plpgsql/body-ast.ts`, `packages/core/src/plpgsql/body-context.ts`, `packages/core/src/plpgsql/render-body.ts`, `packages/core/src/index.ts` (only if new public types appear)
- Test: extend `packages/core/test/plpgsql/body-context.test.ts`, `packages/core/test/plpgsql/render-body.test.ts`, `packages/core/test/plpgsql/guard.test.ts`

**Design (planner brainstorm, small scope):**
- Unlike `ctx.row`'s scalar-per-column strategy (A2 — motivated by the unassigned-record trap on zero rows), a `for … in <query> loop` variable is a true plpgsql `record` assigned on every iteration, so **the loop variable is one record local**: declared `<name> record;`, fields accessed `<name>.<snake_column>`.
- Surface: `ctx.forEach<TProjection extends RowProjection>(query: SelectLimited<TProjection>, body: (row: RowColumns<TProjection>) => void, name?: string): void` — same projection constraints as `ctx.row` (`row-projection-not-column` applies), name validated by `assertValidLocalName` + `duplicate-local-name`, deterministic fallback counter `loop_1`, `loop_2`, … (separate counter from `row_N`).
- Row proxy fields record `plpgsqlRef` with `path: [loopName, snakeColumnName]` (two segments — record field access, not scalar locals).
- New statement node: `{ readonly stmtKind: "forEach"; readonly loopName: string; readonly query: SelectNode; readonly statements: ReadonlyArray<BodyStatement> }` — recorded via the existing frame stack (push, run body, pop), same as `if` branches.
- Emit: `for <loopName> in <renderSelect(query)> loop` at current depth, body statements at depth+1, `end loop;` — loop variable added to the `declare` block as `<loopName> record;`.
- Determinism guard needs no change (double-run covers loop bodies — they record once per run, not per iteration).

- [ ] **Step 1: Failing tests** — recording: forEach records the node with a record declaration, nested statements land inside, `loop_N` naming, duplicate/reserved name errors, derived-projection error; render: full-text `for r in select … loop` / indented body / `end loop;` plus `r record;` in declare; guard: a forEach body that records differently across runs throws `nondeterministic-body`.
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement** (body-ast node + context method + emitter case + declare-block extension).
- [ ] **Step 4: Full gate** — `pnpm check && pnpm check-types --force && pnpm test --force`.
- [ ] **Step 5: Commit** — `feat(core): ctx.forEach loop construct` (adjust casing for commitlint: `feat(core): ctx-foreach loop construct` if `subject-case` rejects the camelCase).

---

## Self-review notes (planner, pre-approval)

- Spec coverage: §5.2 surface (args/returns/security/body) → Tasks 2/4; `grants` key deferred to Phase 4 (grants kind lands there — flagged in plan header). §5.3 → Task 2. §6.2 guard → Task 3. §6.4 hash+signature → Task 4 (A11 pending). §6.5 function/trigger diff strategies → Task 4. §7 error pairs + declaration site → Tasks 2/3. Roadmap acceptance → Task 5.
- Loops (`ctx.forEach`), `ctx.while`: excluded (A9), separate sub-issue.
- Type-consistency: `SelectLimited<TProjection>` (T1) is what `ctx.row` consumes (T2); `FunctionBody` (T2) is what the guard compares (T3) and the emitter renders (T4); `TriggerDeclaration.functionDeclaration` (T2) is what `generate.ts` expands (T4).
- Known risks: (1) A11 pending — Task 4 blocked until answered, Tasks 1–3 proceed; (2) `IfChain.elseIf/else` mutating an already-appended statement needs care with readonly types — implementer may keep branches mutable inside the closure and freeze at `finish()`; (3) stack-parsing formats vary across runtimes — `captureDeclarationSite` must degrade to `null`, never throw.
- Carried review observations (Task 2 review, non-blocking — revisit in Task 4/5): (a) `IfChain` misuse guards — calling `.else()` twice overwrites, `.elseIf()` after `.else()` appends a branch rendered before the else; deterministic today, decide guard-vs-document at emitter time; (b) `FunctionBody`/body-ast types are package-internal while public `FunctionDeclaration.body` references them — decide whether to export them when the kinds land.
