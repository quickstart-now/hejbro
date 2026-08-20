# Phase 2 — Expression & Query Builder Foundation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the typed expression AST, the `select`/`insert`/`update`/
`delete` query builders, and injection-safe SQL rendering that every
downstream phase (column defaults now; RLS, views, function bodies later)
consumes.

**Architecture:** A single tagged-union AST (`nodeKind`-discriminated, like
every existing union in this codebase) covers expressions *and* query
statements; one pure render module turns AST nodes into SQL text using the
existing `quoteIdentifier`/`quoteStringLiteral` primitives. User-facing
builders (drizzle-style free functions + type-state chainers) construct AST
nodes and carry a phantom Postgres *type family* (`Expr<"uuid">`) for shallow
compile-time checking. `table()` is rebuilt to expose column references as
top-level properties (metadata moves behind a symbol), and `ColumnDefault` is
replaced outright by the AST (snapshot v1 → v2).

**Tech Stack:** TypeScript strict, vitest, Biome (tabs, double quotes), pure
`@hejbro/core` only — no new packages, no runtime dependencies.

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` — §5 (DSL surface), §7
(error principles), decision log D15–D19 (Phase 2 brainstorm outcomes).
Tracking issue: #3.

## Global Constraints

- `@hejbro/core` is **pure**: no fs, no DB, zero runtime deps (spec §4).
  Tests may use `node:fs` (existing golden harness does).
- Our own TS source: no `any`, no `let`/`var`, no `for`/`while`, no ternary
  (owner's `typescript-rules`). Generated SQL output is exempt.
- Errors follow spec §7: machine-readable code + "why it failed AND what to
  do" message, via the existing `hejbroError`/`throwHejbroError`.
- All tagged unions get an `assertNever` default branch (existing pattern).
- Conventional commits, lower-case subject, ≤ 72 chars.
- Gates before claiming done: `pnpm check`, `pnpm check-types`, `pnpm test`.
- Every new public symbol is re-exported from `packages/core/src/index.ts`
  in the task that creates it (Biome organizes the ordering).

## Owner-review checkpoint: exact v1 clause list (D19 expanded scope)

The owner chose the expanded standard-clause set and asked for the exact
list. This plan builds:

| Builder | Clauses in v1 |
|---------|---------------|
| `select` | projection (whole table / object of expressions / `select 1` inside `exists`), `innerJoin`, `where`, `orderBy` (asc/desc), `limit` |
| `insert` | `values` (single row or array), `onConflictDoNothing`, `onConflictDoUpdate` (set map), `returning` |
| `update` | `set`, `where`, `returning` |
| `delete` | `where`, `returning` |
| operators | `eq ne gt gte lt lte`, `isNull isNotNull`, `and or not`, `inArray notInArray`, `like ilike notLike notIlike`, `between notBetween`, `exists notExists` |
| functions | `now()`, `genRandomUuid()`, `coalesce()` — everything else via `` sql`…` `` |

Explicitly **not** in v1 (deferred, no corpus/spec evidence): `distinct`,
`offset`, `groupBy`/`having`, outer joins, scalar subqueries outside
`exists`, `in (select …)`. If Phase 3/4 needs one, it lands there as a
sub-issue.

## File structure

```
packages/core/src/expr/
  type-family.ts    # SqlTypeFamily, familyOfTypeNode, LiftableFor
  ast.ts            # every ExprNode + query node type, Expr<TF>, columnRef, isExpr
  literal.ts        # liftLiteral (JS value → LiteralNode), renderLiteral
  render-sql.ts     # renderExpr + renderSelect/Insert/Update/Delete (one module — no cycles)
  operators.ts      # eq…notBetween, and/or/not, isNull…, inArray…, now, genRandomUuid, coalesce
  sql-template.ts   # sql tagged template + sql.raw
packages/core/src/query/
  select.ts         # type-state select builder + exists/notExists
  mutate.ts         # insert / update / delete builders
packages/core/src/dsl/table.ts        # rebuilt surface (Task 7)
packages/core/src/dsl/index-builder.ts # index() chainable builder (spec §5.1)
packages/core/src/types/column-builder.ts # generified; ColumnDefault removed (Tasks 6, 10)
```

Corresponding tests live under `packages/core/test/expr/`,
`packages/core/test/query/`, plus updates to existing test files.

---

### Task 1: Type families and the AST module

**Files:**
- Create: `packages/core/src/expr/type-family.ts`
- Create: `packages/core/src/expr/ast.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/expr/type-family.test.ts`

**Interfaces:**
- Consumes: `TypeNode` from `../types/type-node`.
- Produces (later tasks depend on these exact names):
  - `sqlTypeFamilies`, `SqlTypeFamily`, `familyOfTypeNode(node: TypeNode): SqlTypeFamily`, `LiftableFor<TFamily>`
  - `Expr<TFamily extends SqlTypeFamily = SqlTypeFamily>` =
    `{ readonly family: TFamily; readonly exprNode: ExprNode }`
  - `ColumnRef<TFamily>` = `Expr<TFamily> & { readonly exprNode: ColumnRefNode; readonly typeNode: TypeNode; readonly sqlName: string }`
  - `columnRef(schemaName, tableName, columnName, typeNode): ColumnRef` (runtime factory; family derived via `familyOfTypeNode`)
  - `isExpr(value: unknown): value is Expr` (guard: non-null object with an `exprNode` property)
  - every node type listed in Step 3 below

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/expr/type-family.test.ts
import { describe, expect, it } from "vitest";
import { columnRef, familyOfTypeNode, isExpr } from "../../src/index";

describe("familyOfTypeNode", () => {
	it("maps every structural type to its family", () => {
		expect(familyOfTypeNode({ typeName: "uuid" })).toBe("uuid");
		expect(familyOfTypeNode({ typeName: "text" })).toBe("text");
		expect(familyOfTypeNode({ typeName: "varchar", length: 12 })).toBe("text");
		expect(
			familyOfTypeNode({ typeName: "enum", enumSchema: "s", enumName: "e" }),
		).toBe("text");
		expect(familyOfTypeNode({ typeName: "bigint" })).toBe("numeric");
		expect(
			familyOfTypeNode({ typeName: "numeric", precision: null, scale: null }),
		).toBe("numeric");
		expect(familyOfTypeNode({ typeName: "boolean" })).toBe("boolean");
		expect(familyOfTypeNode({ typeName: "timestamptz" })).toBe("datetime");
		expect(familyOfTypeNode({ typeName: "interval" })).toBe("interval");
		expect(familyOfTypeNode({ typeName: "jsonb" })).toBe("json");
		expect(familyOfTypeNode({ typeName: "bytea" })).toBe("bytea");
		expect(familyOfTypeNode({ typeName: "inet" })).toBe("net");
		expect(
			familyOfTypeNode({ typeName: "array", element: { typeName: "text" } }),
		).toBe("array");
	});
});

describe("columnRef", () => {
	it("builds a ref carrying family, node, and sql name", () => {
		const ref = columnRef("app", "posts", "published_at", {
			typeName: "timestamptz",
		});
		expect(ref.family).toBe("datetime");
		expect(ref.sqlName).toBe("published_at");
		expect(ref.exprNode).toEqual({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "published_at",
		});
		expect(isExpr(ref)).toBe(true);
		expect(isExpr("published_at")).toBe(false);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hejbro/core test -- expr/type-family`
Expected: FAIL — module `expr/type-family` does not exist.

- [x] **Step 3: Write the implementation**

`type-family.ts`:

```ts
import { assertNever } from "../error";
import type { TypeNode } from "../types/type-node";

/** Coarse Postgres type families used for shallow compile-time expression checks (D17). */
export const sqlTypeFamilies = [
	"uuid",
	"text",
	"numeric",
	"boolean",
	"datetime",
	"interval",
	"json",
	"bytea",
	"net",
	"array",
	"unknown",
] as const;

/** @see sqlTypeFamilies */
export type SqlTypeFamily = (typeof sqlTypeFamilies)[number];

/** The JS values that auto-lift into a literal for a given family (D19 sub-decision: string/number/boolean/Date only; json/array/etc. need explicit helpers). */
export type LiftableFor<TFamily extends SqlTypeFamily> = TFamily extends
	| "text"
	| "uuid"
	? string
	: TFamily extends "numeric"
		? number
		: TFamily extends "boolean"
			? boolean
			: TFamily extends "datetime"
				? Date | string
				: never;
```

`familyOfTypeNode` is a single exhaustive `switch (node.typeName)` over the
same cases `renderTypeNode` handles (see `types/type-node.ts:88-129`), with
`assertNever` in the default branch:
uuid → `"uuid"`; text/varchar/char/enum → `"text"`;
smallint/integer/bigint/real/"double precision"/numeric/serial/smallserial/
bigserial → `"numeric"`; boolean → `"boolean"`;
date/time/timetz/timestamp/timestamptz → `"datetime"`; interval →
`"interval"`; json/jsonb → `"json"`; bytea → `"bytea"`; inet/cidr/macaddr →
`"net"`; array → `"array"`.

`ast.ts` — the complete node union (expression *and* query nodes live in one
module to avoid import cycles; `renderExpr` needs `exists`, which needs
`SelectNode`):

```ts
import type { TypeNode } from "../types/type-node";
import type { SqlTypeFamily } from "./type-family";
import { familyOfTypeNode } from "./type-family";

/** A literal value captured at build time, already narrowed to a renderable shape. */
export type LiteralNode = {
	readonly nodeKind: "literal";
	readonly literal:
		| { readonly literalKind: "string"; readonly value: string }
		| { readonly literalKind: "number"; readonly value: number }
		| { readonly literalKind: "boolean"; readonly value: boolean }
		| { readonly literalKind: "null" }
		| { readonly literalKind: "timestamp"; readonly isoValue: string };
};

export type ColumnRefNode = {
	readonly nodeKind: "columnRef";
	readonly schemaName: string;
	readonly tableName: string;
	readonly columnName: string;
};

export const comparisonOperators = [
	"=",
	"<>",
	">",
	">=",
	"<",
	"<=",
	"like",
	"ilike",
	"not like",
	"not ilike",
] as const;
export type ComparisonOperator = (typeof comparisonOperators)[number];

export type ComparisonNode = {
	readonly nodeKind: "comparison";
	readonly operator: ComparisonOperator;
	readonly left: ExprNode;
	readonly right: ExprNode;
};

export type LogicalNode = {
	readonly nodeKind: "logical";
	readonly operator: "and" | "or";
	readonly operands: ReadonlyArray<ExprNode>;
};

export type NotNode = { readonly nodeKind: "not"; readonly operand: ExprNode };

export type NullTestNode = {
	readonly nodeKind: "nullTest";
	readonly negated: boolean;
	readonly operand: ExprNode;
};

export type InListNode = {
	readonly nodeKind: "inList";
	readonly negated: boolean;
	readonly operand: ExprNode;
	readonly values: ReadonlyArray<ExprNode>;
};

export type BetweenNode = {
	readonly nodeKind: "between";
	readonly negated: boolean;
	readonly operand: ExprNode;
	readonly lowerBound: ExprNode;
	readonly upperBound: ExprNode;
};

/** A (possibly schema-qualified) function call — `now()`, `gen_random_uuid()`, later `auth.uid()` from presets. */
export type FunctionCallNode = {
	readonly nodeKind: "functionCall";
	readonly schemaName: string | null;
	readonly functionName: string;
	readonly args: ReadonlyArray<ExprNode>;
};

export type SqlTemplateChunk =
	| { readonly chunkKind: "text"; readonly text: string }
	| { readonly chunkKind: "expr"; readonly expr: ExprNode };

export type SqlTemplateNode = {
	readonly nodeKind: "sqlTemplate";
	readonly chunks: ReadonlyArray<SqlTemplateChunk>;
};

/** Raw, unescaped SQL — only ever constructed by `sql.raw()` (D18). */
export type RawSqlNode = { readonly nodeKind: "rawSql"; readonly sql: string };

export type ExistsNode = {
	readonly nodeKind: "exists";
	readonly negated: boolean;
	readonly query: SelectNode;
};

export type ExprNode =
	| LiteralNode
	| ColumnRefNode
	| ComparisonNode
	| LogicalNode
	| NotNode
	| NullTestNode
	| InListNode
	| BetweenNode
	| FunctionCallNode
	| SqlTemplateNode
	| RawSqlNode
	| ExistsNode;

// --- query statement nodes ---

export type TableRefNode = {
	readonly schemaName: string;
	readonly tableName: string;
};

export type ProjectionNode =
	| {
			readonly projectionKind: "allColumns";
			readonly columnNames: ReadonlyArray<string>;
	  }
	| {
			readonly projectionKind: "columns";
			readonly columns: ReadonlyArray<{
				readonly alias: string;
				readonly expr: ExprNode;
			}>;
	  }
	| { readonly projectionKind: "constantOne" };

export type JoinNode = {
	readonly joinKind: "inner";
	readonly table: TableRefNode;
	readonly on: ExprNode;
};

export type OrderByTerm = {
	readonly expr: ExprNode;
	readonly direction: "asc" | "desc";
};

export type SelectNode = {
	readonly queryKind: "select";
	readonly projection: ProjectionNode;
	readonly from: TableRefNode;
	readonly joins: ReadonlyArray<JoinNode>;
	readonly where: ExprNode | null;
	readonly orderBy: ReadonlyArray<OrderByTerm>;
	readonly limit: number | null;
};

export type ReturningNode =
	| {
			readonly returningKind: "allColumns";
			readonly columnNames: ReadonlyArray<string>;
	  }
	| {
			readonly returningKind: "columns";
			readonly columns: ReadonlyArray<{
				readonly alias: string;
				readonly expr: ExprNode;
			}>;
	  };

export type OnConflictNode = {
	readonly targetColumns: ReadonlyArray<string>;
	readonly action:
		| { readonly actionKind: "nothing" }
		| {
				readonly actionKind: "update";
				readonly set: ReadonlyArray<{
					readonly columnName: string;
					readonly value: ExprNode;
				}>;
		  };
};

export type InsertNode = {
	readonly queryKind: "insert";
	readonly table: TableRefNode;
	readonly columnNames: ReadonlyArray<string>;
	readonly rows: ReadonlyArray<ReadonlyArray<ExprNode>>;
	readonly onConflict: OnConflictNode | null;
	readonly returning: ReturningNode | null;
};

export type UpdateNode = {
	readonly queryKind: "update";
	readonly table: TableRefNode;
	readonly set: ReadonlyArray<{
		readonly columnName: string;
		readonly value: ExprNode;
	}>;
	readonly where: ExprNode | null;
	readonly returning: ReturningNode | null;
};

export type DeleteNode = {
	readonly queryKind: "delete";
	readonly table: TableRefNode;
	readonly where: ExprNode | null;
	readonly returning: ReturningNode | null;
};

export type QueryNode = SelectNode | InsertNode | UpdateNode | DeleteNode;

// --- the user-facing wrapper ---

/** A typed SQL expression: an AST node plus its phantom-but-runtime type family (D17). */
export type Expr<TFamily extends SqlTypeFamily = SqlTypeFamily> = {
	readonly family: TFamily;
	readonly exprNode: ExprNode;
};

/** A reference to one declared column — the leaf every expression starts from. */
export type ColumnRef<TFamily extends SqlTypeFamily = SqlTypeFamily> =
	Expr<TFamily> & {
		readonly exprNode: ColumnRefNode;
		readonly typeNode: TypeNode;
		readonly sqlName: string;
	};

export const expr = <TFamily extends SqlTypeFamily>(
	family: TFamily,
	exprNode: ExprNode,
): Expr<TFamily> => ({ family, exprNode });

export const columnRef = (
	schemaName: string,
	tableName: string,
	columnName: string,
	typeNode: TypeNode,
): ColumnRef => ({
	family: familyOfTypeNode(typeNode),
	exprNode: { nodeKind: "columnRef", schemaName, tableName, columnName },
	typeNode,
	sqlName: columnName,
});

export const isExpr = (value: unknown): value is Expr =>
	typeof value === "object" && value !== null && "exprNode" in value;
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hejbro/core test -- expr/type-family`
Expected: PASS.

- [x] **Step 5: Export from index.ts, run gates, commit**

Add to `packages/core/src/index.ts` (Biome will sort): types
`SqlTypeFamily`, `LiftableFor`, `Expr`, `ColumnRef`, `ExprNode`,
`ColumnRefNode`, `LiteralNode`, `ComparisonNode`, `ComparisonOperator`,
`LogicalNode`, `NotNode`, `NullTestNode`, `InListNode`, `BetweenNode`,
`FunctionCallNode`, `SqlTemplateNode`, `SqlTemplateChunk`, `RawSqlNode`,
`ExistsNode`, `TableRefNode`, `ProjectionNode`, `JoinNode`, `OrderByTerm`,
`SelectNode`, `ReturningNode`, `OnConflictNode`, `InsertNode`, `UpdateNode`,
`DeleteNode`, `QueryNode`; values `sqlTypeFamilies`, `comparisonOperators`,
`familyOfTypeNode`, `expr`, `columnRef`, `isExpr`.

```bash
pnpm check && pnpm check-types && pnpm --filter @hejbro/core test
git add packages/core && git commit -m "feat(core): expression ast node types and type families"
```

---

### Task 2: Literal lifting and injection-safe literal rendering

**Files:**
- Create: `packages/core/src/expr/literal.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/expr/literal.test.ts`

**Interfaces:**
- Consumes: `LiteralNode`, `Expr`, `isExpr` from `./ast`; `SqlTypeFamily`
  from `./type-family`; `quoteStringLiteral` from `../sql/literal`;
  `throwHejbroError`, `assertNever` from `../error`.
- Produces:
  - `liftLiteral(value: unknown, family: SqlTypeFamily): LiteralNode` —
    validates and narrows a JS value.
  - `liftOperand(value: unknown, family: SqlTypeFamily): ExprNode` — returns
    `value.exprNode` when `isExpr(value)`, otherwise `liftLiteral`.
  - `renderLiteral(node: LiteralNode): string`.

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/expr/literal.test.ts
import { describe, expect, it } from "vitest";
import { liftLiteral, renderLiteral } from "../../src/index";

const render = (value: unknown) => renderLiteral(liftLiteral(value, "text"));

describe("liftLiteral + renderLiteral", () => {
	it("quotes strings and doubles embedded quotes (injection corpus)", () => {
		expect(render("hello")).toBe("'hello'");
		expect(render("it's")).toBe("'it''s'");
		expect(render("'; drop table users; --")).toBe(
			"'''; drop table users; --'",
		);
	});
	it("renders numbers, booleans, null", () => {
		expect(renderLiteral(liftLiteral(42, "numeric"))).toBe("42");
		expect(renderLiteral(liftLiteral(true, "boolean"))).toBe("true");
		expect(renderLiteral(liftLiteral(null, "text"))).toBe("null");
	});
	it("renders Date as an explicit timestamptz literal", () => {
		const value = new Date("2026-08-19T00:00:00.000Z");
		expect(renderLiteral(liftLiteral(value, "datetime"))).toBe(
			"'2026-08-19T00:00:00.000Z'::timestamptz",
		);
	});
	it("rejects non-finite numbers with an actionable error", () => {
		expect(() => liftLiteral(Number.NaN, "numeric")).toThrowError(
			/invalid-literal|not a finite number/,
		);
	});
	it("rejects arrays and plain objects (ambiguous-literal)", () => {
		expect(() => liftLiteral(["a", "b"], "array")).toThrowError(
			/ambiguous-literal/,
		);
		expect(() => liftLiteral({ a: 1 }, "json")).toThrowError(
			/ambiguous-literal/,
		);
	});
});
```

Note: `hejbroError` objects are not `Error` instances (issue #25 tracks
that); match the existing tests' assertion style for thrown hejbro errors —
check `packages/core/test/column-builder.test.ts` and mirror it (e.g.
`expect(fn).toThrowError(expect.objectContaining({ code: "ambiguous-literal" }))`
or try/catch on the thrown object).

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hejbro/core test -- expr/literal`
Expected: FAIL — `liftLiteral` not exported.

- [x] **Step 3: Write the implementation**

Rules (each branch is real code, no placeholders):
- `string` → `{ literalKind: "string", value }`
- `number` → reject `!Number.isFinite(value)` with code `invalid-literal`,
  message: `` `${value} is not a finite number — SQL numeric literals must be finite; compute the value before declaring it.` ``
- `boolean` → boolean literal node
- `null` → null literal node
- `value instanceof Date` → reject `Number.isNaN(value.getTime())` (code
  `invalid-literal`), else `{ literalKind: "timestamp", isoValue: value.toISOString() }`
- `Array.isArray(value)` or remaining objects → code `ambiguous-literal`,
  message: `` `got a plain ${kind} — hejbro cannot infer whether this is a Postgres array or jsonb; wrap it explicitly (e.g. sql\`…\`) or pass a scalar.` ``
- anything else (undefined, function, symbol, bigint) → code
  `invalid-literal` with the received `typeof`.

`renderLiteral` is an exhaustive switch on `literalKind`:
string → `quoteStringLiteral(value)`; number → `String(value)`; boolean →
`"true"`/`"false"` (if/return, no ternary); null → `"null"`; timestamp →
`` `${quoteStringLiteral(isoValue)}::timestamptz` ``; default →
`assertNever`.

`liftOperand`: if `isExpr(value)` return `value.exprNode`; otherwise return
`liftLiteral(value, family)`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hejbro/core test -- expr/literal`
Expected: PASS.

- [x] **Step 5: Export, run gates, commit**

```bash
pnpm check && pnpm check-types && pnpm --filter @hejbro/core test
git add packages/core && git commit -m "feat(core): literal lifting with injection-safe rendering"
```

---

### Task 3: Expression rendering (`renderExpr`)

**Files:**
- Create: `packages/core/src/expr/render-sql.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/expr/render-sql.test.ts`

**Interfaces:**
- Consumes: all node types from `./ast`; `renderLiteral` from `./literal`;
  `quoteIdentifier`, `qualifyName` from `../sql/identifier`.
- Produces:
  `renderExpr(node: ExprNode, outerScope?: ReadonlyArray<TableRefNode>): string`.
  `outerScope` names the tables whose columns the expression may reference
  beyond its own subqueries — Task 8 threads it into `exists` rendering so
  **correlated subqueries** work (an RLS `using` on `comments` renders with
  `outerScope = [comments]`, letting
  `exists (select 1 from posts where posts.id = comments.post_id)` pass
  scope validation). In this task the parameter is accepted and ignored by
  every case except `exists`; leave the `exists` case throwing
  `throwHejbroError("not-implemented-yet", "exists rendering lands with the select builder (Task 8).")`
  for now — Task 8 replaces it.

**Parenthesization rule (deterministic over clever):** leaf nodes
(`literal`, `columnRef`, `functionCall`, `rawSql`, `sqlTemplate`, `exists`)
render bare; every composite operand (`comparison`, `logical`, `not`,
`nullTest`, `inList`, `between`) is wrapped in parentheses when it appears
as an operand of another node. Implement via a private
`renderOperand(node)` that parenthesizes exactly those composite kinds.
Golden files stay stable and precedence bugs are impossible.

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/expr/render-sql.test.ts
import { describe, expect, it } from "vitest";
import type { ExprNode } from "../../src/index";
import { renderExpr } from "../../src/index";

const publishedAt: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "posts",
	columnName: "published_at",
};
const status: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "posts",
	columnName: "status",
};
const lit = (value: string): ExprNode => ({
	nodeKind: "literal",
	literal: { literalKind: "string", value },
});

describe("renderExpr", () => {
	it("renders column refs schema-qualified and quoted", () => {
		expect(renderExpr(publishedAt)).toBe('"app"."posts"."published_at"');
	});
	it("renders comparisons", () => {
		expect(
			renderExpr({
				nodeKind: "comparison",
				operator: "=",
				left: status,
				right: lit("published"),
			}),
		).toBe('"app"."posts"."status" = \'published\'');
	});
	it("parenthesizes nested logical operands deterministically", () => {
		const isPublished: ExprNode = {
			nodeKind: "comparison",
			operator: "=",
			left: status,
			right: lit("published"),
		};
		const notDeleted: ExprNode = {
			nodeKind: "nullTest",
			negated: false,
			operand: publishedAt,
		};
		expect(
			renderExpr({
				nodeKind: "logical",
				operator: "or",
				operands: [
					{
						nodeKind: "logical",
						operator: "and",
						operands: [isPublished, notDeleted],
					},
					isPublished,
				],
			}),
		).toBe(
			"((\"app\".\"posts\".\"status\" = 'published') and (\"app\".\"posts\".\"published_at\" is null)) or (\"app\".\"posts\".\"status\" = 'published')",
		);
	});
	it("renders null tests, in lists, between, not", () => {
		expect(
			renderExpr({ nodeKind: "nullTest", negated: true, operand: publishedAt }),
		).toBe('"app"."posts"."published_at" is not null');
		expect(
			renderExpr({
				nodeKind: "inList",
				negated: false,
				operand: status,
				values: [lit("a"), lit("b")],
			}),
		).toBe("\"app\".\"posts\".\"status\" in ('a', 'b')");
	});
	it("renders function calls, schema-qualified when set", () => {
		expect(
			renderExpr({
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "now",
				args: [],
			}),
		).toBe("now()");
		expect(
			renderExpr({
				nodeKind: "functionCall",
				schemaName: "auth",
				functionName: "uid",
				args: [],
			}),
		).toBe("auth.uid()");
	});
	it("renders sql templates and raw sql verbatim where designed", () => {
		expect(
			renderExpr({
				nodeKind: "sqlTemplate",
				chunks: [
					{ chunkKind: "text", text: "char_length(" },
					{ chunkKind: "expr", expr: status },
					{ chunkKind: "text", text: ") > 3" },
				],
			}),
		).toBe('char_length("app"."posts"."status") > 3');
		expect(renderExpr({ nodeKind: "rawSql", sql: "1 = 1" })).toBe("1 = 1");
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hejbro/core test -- expr/render-sql`
Expected: FAIL — `renderExpr` not exported.

- [x] **Step 3: Write the implementation**

Exhaustive `switch (node.nodeKind)` with `assertNever` default:
- `literal` → `renderLiteral(node.literal)`
- `columnRef` → `` `${qualifyName(node.schemaName, node.tableName)}.${quoteIdentifier(node.columnName)}` ``
- `comparison` → `` `${renderOperand(left)} ${operator} ${renderOperand(right)}` ``
- `logical` → operands mapped through `renderOperand`, joined by
  `` ` ${operator} ` ``. Guard: empty `operands` →
  `throwHejbroError("empty-logical-expression", "and()/or() need at least one operand — pass at least one boolean expression.")`
- `not` → `` `not ${renderOperand(operand)}` ``
- `nullTest` → `is null` / `is not null` suffix on `renderOperand(operand)`
- `inList` → `in (…)` / `not in (…)`, values joined `", "`. Guard: empty
  `values` → `throwHejbroError("empty-in-list", "inArray() received an empty array — an empty in-list is always false in SQL; drop the condition or supply values.")`
- `between` → `` `${renderOperand(operand)} between ${renderOperand(lower)} and ${renderOperand(upper)}` `` (+ `not`)
- `functionCall` → name is `functionName` or
  `` `${schemaName}.${functionName}` `` (function names come from hejbro
  helpers, not user input — no identifier quoting; args via `renderExpr`,
  joined `", "`)
- `sqlTemplate` → chunks concatenated: text verbatim, expr via
  `renderExpr`
- `rawSql` → `node.sql` verbatim (D18: only `sql.raw` builds this)
- `exists` → temporary `not-implemented-yet` error (replaced in Task 8)

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hejbro/core test -- expr/render-sql`
Expected: PASS.

- [x] **Step 5: Export, run gates, commit**

```bash
pnpm check && pnpm check-types && pnpm --filter @hejbro/core test
git add packages/core && git commit -m "feat(core): deterministic expression sql rendering"
```

---

### Task 4: Operator and function builders

**Files:**
- Create: `packages/core/src/expr/operators.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/expr/operators.test.ts`

**Interfaces:**
- Consumes: `Expr`, `expr`, `isExpr` from `./ast`; `liftOperand` from
  `./literal`; `LiftableFor`, `SqlTypeFamily` from `./type-family`.
- Produces (exact signatures — every later task and Phase 3/4 use these):

```ts
type Operand<TFamily extends SqlTypeFamily> =
	| Expr<TFamily>
	| Expr<"unknown">
	| LiftableFor<TFamily>;

export const eq: <TFamily extends SqlTypeFamily>(
	left: Expr<TFamily>,
	right: Operand<TFamily>,
) => Expr<"boolean">;
// ne, gt, gte, lt, lte: same signature (operators "<>", ">", ">=", "<", "<=")
// like, ilike, notLike, notIlike: (left: Expr<"text">, pattern: Operand<"text">) => Expr<"boolean">
export const isNull: (operand: Expr) => Expr<"boolean">;
export const isNotNull: (operand: Expr) => Expr<"boolean">;
export const and: (...conditions: ReadonlyArray<Expr<"boolean">>) => Expr<"boolean">;
export const or: (...conditions: ReadonlyArray<Expr<"boolean">>) => Expr<"boolean">;
export const not: (condition: Expr<"boolean">) => Expr<"boolean">;
export const inArray: <TFamily extends SqlTypeFamily>(
	operand: Expr<TFamily>,
	values: ReadonlyArray<Operand<TFamily>>,
) => Expr<"boolean">;
// notInArray: same, negated
export const between: <TFamily extends SqlTypeFamily>(
	operand: Expr<TFamily>,
	lowerBound: Operand<TFamily>,
	upperBound: Operand<TFamily>,
) => Expr<"boolean">;
// notBetween: same, negated
export const now: () => Expr<"datetime">;
export const genRandomUuid: () => Expr<"uuid">;
export const coalesce: <TFamily extends SqlTypeFamily>(
	first: Expr<TFamily>,
	...rest: ReadonlyArray<Operand<TFamily>>
) => Expr<TFamily>;
```

Note `eq(x, null)` is rejected at the type level (`LiftableFor` never maps
to null) — add a runtime guard too: if the lifted right operand is `null`,
throw code `null-comparison`, message:
`"eq()/ne() with null always yields SQL null, never true — use isNull()/isNotNull() instead."`

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/expr/operators.test.ts
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Expr } from "../../src/index";
import {
	and,
	between,
	columnRef,
	eq,
	inArray,
	isNotNull,
	like,
	ne,
	not,
	now,
	or,
	renderExpr,
} from "../../src/index";

const status = columnRef("app", "posts", "status", { typeName: "text" });
const publishedAt = columnRef("app", "posts", "published_at", {
	typeName: "timestamptz",
});
const postId = columnRef("app", "posts", "id", { typeName: "uuid" });

describe("operators", () => {
	it("builds comparisons with auto-lifted literals", () => {
		expect(renderExpr(eq(status, "published").exprNode)).toBe(
			"\"app\".\"posts\".\"status\" = 'published'",
		);
	});
	it("composes boolean expressions", () => {
		const composed = or(
			and(eq(status, "published"), isNotNull(publishedAt)),
			not(ne(status, "draft")),
		);
		expect(renderExpr(composed.exprNode)).toContain(" or ");
		expectTypeOf(composed).toEqualTypeOf<Expr<"boolean">>();
	});
	it("builds inArray / between / like / now", () => {
		expect(renderExpr(inArray(status, ["a", "b"]).exprNode)).toBe(
			"\"app\".\"posts\".\"status\" in ('a', 'b')",
		);
		expect(renderExpr(like(status, "post-%").exprNode)).toBe(
			"\"app\".\"posts\".\"status\" like 'post-%'",
		);
		expect(renderExpr(now().exprNode)).toBe("now()");
		expect(
			renderExpr(between(publishedAt, now(), now()).exprNode),
		).toBe("\"app\".\"posts\".\"published_at\" between now() and now()");
	});
	it("rejects family mismatches at the type level", () => {
		// @ts-expect-error uuid column compared against a number
		eq(postId, 42);
		// @ts-expect-error boolean combinator fed a non-boolean expression
		and(status);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hejbro/core test -- expr/operators`
Expected: FAIL — operators not exported.

- [x] **Step 3: Write the implementation**

Every comparison shares one private factory:

```ts
const comparison =
	(operator: ComparisonOperator) =>
	<TFamily extends SqlTypeFamily>(
		left: Expr<TFamily>,
		right: Operand<TFamily>,
	): Expr<"boolean"> =>
		expr("boolean", {
			nodeKind: "comparison",
			operator,
			left: left.exprNode,
			right: liftOperandOrRejectNull(right, left.family),
		});

export const eq = comparison("=");
export const ne = comparison("<>");
// gt gte lt lte like ilike notLike notIlike follow identically
```

`and`/`or` reject zero args at runtime (code
`empty-logical-expression`, same message as Task 3) and build a
`LogicalNode` from `conditions.map((c) => c.exprNode)`. `now`/
`genRandomUuid` build `FunctionCallNode` with `schemaName: null` and
function names `"now"` / `"gen_random_uuid"`. `coalesce` lifts `rest`
against `first.family` and keeps `first.family` as the result family.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hejbro/core test -- expr/operators`
Expected: PASS (including the `@ts-expect-error` lines — if those stop
erroring, `check-types` fails, which is the point).

- [x] **Step 5: Export, run gates, commit**

```bash
pnpm check && pnpm check-types && pnpm --filter @hejbro/core test
git add packages/core && git commit -m "feat(core): typed expression operators and pg function helpers"
```

---

### Task 5: `sql` tagged template and `sql.raw`

**Files:**
- Create: `packages/core/src/expr/sql-template.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/expr/sql-template.test.ts`

**Interfaces:**
- Consumes: `Expr`, `expr`, `isExpr`, `SqlTemplateChunk` from `./ast`;
  `liftLiteral` from `./literal`.
- Produces:

```ts
export type SqlInterpolation = Expr | string | number | boolean | Date | null;
type SqlTag = {
	(strings: TemplateStringsArray, ...values: ReadonlyArray<SqlInterpolation>): Expr<"unknown">;
	raw(rawSql: string): Expr<"unknown">;
};
export const sql: SqlTag;
```

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/expr/sql-template.test.ts
import { describe, expect, it } from "vitest";
import { columnRef, renderExpr, sql } from "../../src/index";

const slug = columnRef("app", "posts", "slug", { typeName: "text" });

describe("sql tagged template", () => {
	it("splices expressions and quotes plain values — never raw", () => {
		const guard = sql`char_length(${slug}) > ${3}`;
		expect(renderExpr(guard.exprNode)).toBe(
			'char_length("app"."posts"."slug") > 3',
		);
	});
	it("treats interpolated strings as quoted literals (injection corpus)", () => {
		const attempted = sql`name = ${"x'; drop table posts; --"}`;
		expect(renderExpr(attempted.exprNode)).toBe(
			"name = 'x''; drop table posts; --'",
		);
	});
	it("sql.raw passes text through verbatim", () => {
		expect(renderExpr(sql.raw("1 = 1").exprNode)).toBe("1 = 1");
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hejbro/core test -- expr/sql-template`
Expected: FAIL — `sql` not exported.

- [x] **Step 3: Write the implementation**

Zip `strings` and `values` into `SqlTemplateChunk[]`: each string part is a
`text` chunk; each value becomes an `expr` chunk — `value.exprNode` when
`isExpr(value)`, else `{ nodeKind: "literal", literal: liftLiteral(value, "unknown") }`.
(`liftLiteral` already rejects arrays/objects with `ambiguous-literal`.)
`sql.raw` returns `expr("unknown", { nodeKind: "rawSql", sql: rawSql })`.
Implement the tag as a `const sqlTag = (…) => …` plus
`export const sql: SqlTag = Object.assign(sqlTag, { raw: … })`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hejbro/core test -- expr/sql-template`
Expected: PASS.

- [x] **Step 5: Export, run gates, commit**

```bash
pnpm check && pnpm check-types && pnpm --filter @hejbro/core test
git add packages/core && git commit -m "feat(core): sql tagged template with quoted interpolation and sql.raw"
```

---

### Task 6: Generify `ColumnBuilder` with the type family

**Files:**
- Modify: `packages/core/src/types/column-builder.ts`
- Modify: `packages/core/src/types/column-builder-factories.ts`
- Modify: `packages/core/src/dsl/pg-enum.ts`
- Modify: `packages/core/src/index.ts` (if type exports change shape)
- Test: extend `packages/core/test/column-builder.test.ts`

**Interfaces:**
- Produces: `ColumnBuilder<TFamily extends SqlTypeFamily = SqlTypeFamily>`
  — same shape as today, every chainable method returns
  `ColumnBuilder<TFamily>`; new helper type
  `BuilderFamily<TBuilder> = TBuilder extends ColumnBuilder<infer TFamily> ? TFamily : never`
  (exported from `types/column-builder.ts`). Factories return their family:
  `uuid(): ColumnBuilder<"uuid">`, `text/varchar/char(): ColumnBuilder<"text">`,
  numeric-family factories → `ColumnBuilder<"numeric">`, date/time factories
  → `ColumnBuilder<"datetime">`, `boolean(): ColumnBuilder<"boolean">`,
  `interval(): ColumnBuilder<"interval">`, `json/jsonb(): ColumnBuilder<"json">`,
  `bytea(): ColumnBuilder<"bytea">`, `inet/cidr/macaddr(): ColumnBuilder<"net">`,
  `EnumDeclaration.column(): ColumnBuilder<"text">`,
  `.array(): ColumnBuilder<"array">`.
- **Do not change `ColumnDefault` or `.default()` here** — that is Task 10.
  This task is type-plumbing only; `createColumnBuilder` gains a
  `<TFamily>` parameter whose runtime body is unchanged.

- [x] **Step 1: Write the failing type-level test**

Append to `packages/core/test/column-builder.test.ts`:

```ts
import { expectTypeOf } from "vitest";
import type { ColumnBuilder } from "../src/index";
import { text, timestamptz, uuid } from "../src/index";

it("factories carry their postgres type family", () => {
	expectTypeOf(uuid()).toEqualTypeOf<ColumnBuilder<"uuid">>();
	expectTypeOf(text().notNull()).toEqualTypeOf<ColumnBuilder<"text">>();
	expectTypeOf(timestamptz()).toEqualTypeOf<ColumnBuilder<"datetime">>();
	expectTypeOf(uuid().array()).toEqualTypeOf<ColumnBuilder<"array">>();
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hejbro/core test -- column-builder` and
`pnpm check-types`
Expected: FAIL — `ColumnBuilder` takes no type argument.

- [x] **Step 3: Implement**

`createColumnBuilder<TFamily extends SqlTypeFamily>(columnState): ColumnBuilder<TFamily>`
— body identical, except `array()` returns
`createColumnBuilder<"array">({ …, typeNode: { typeName: "array", element: columnState.typeNode } })`.
Each factory in `column-builder-factories.ts` passes its family explicitly:
`initialColumnBuilder<TFamily>(typeName, family)` or per-factory literal
generic (`createColumnBuilder<"uuid">…`). `pg-enum.ts` `column()` returns
`ColumnBuilder<"text">`. Existing call sites (`dsl/table.ts` constraint
`Record<string, ColumnBuilder>`) keep working because the parameter
defaults to the full union.

- [x] **Step 4: Run tests + typecheck**

Run: `pnpm check-types && pnpm --filter @hejbro/core test`
Expected: PASS across the whole suite (pure type change).

- [x] **Step 5: Commit**

```bash
pnpm check && git add packages/core && git commit -m "refactor(core): carry postgres type family through column builders"
```

---

### Task 7: Rebuild the `table()` surface (D15)

**Files:**
- Modify: `packages/core/src/dsl/table.ts` (substantial rewrite)
- Create: `packages/core/src/dsl/index-builder.ts`
- Modify: `packages/core/src/engine/generate.ts` (accept table objects)
- Modify: `packages/core/src/kind/object-kind.ts` (input union)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/dsl.test.ts` (rewrite affected cases),
  `packages/core/test/golden/cases/app-posts/declarations.ts` and
  `steps.ts` (migrate to the new surface),
  new `packages/core/test/table-surface.test.ts`

**Interfaces:**
- Consumes: `ColumnRef`, `columnRef` from `../expr/ast`; `BuilderFamily`
  from `../types/column-builder`; `toSnakeCase` (unchanged).
- Produces (everything downstream — query builders, Phase 3/4 — relies on
  these):

```ts
export const tableMeta: unique symbol; // Symbol("hejbro:table-meta")

export type TableColumns<TColumns extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TColumns]: ColumnRef<BuilderFamily<TColumns[K]>>;
};

export type Table<
	TColumns extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
> = TableColumns<TColumns> & { readonly [tableMeta]: TableDeclaration };

export const getTableMeta: (tableObject: Table) => TableDeclaration;
export const isTable: (value: unknown) => value is Table;

// index() builder (spec §5.1: index().on(t.publishedAt))
export type IndexBuilder = {
	unique(): IndexBuilder;
	on(...columns: ReadonlyArray<ColumnRef>): IndexDeclaration;
};
export const index: (indexName?: string) => IndexBuilder;

// extras callback now receives the column refs (spec §5.1 `t.publishedAt`);
// IndexDeclaration keeps its Phase 1 shape (snake_cased string columns) —
// index().on() and foreignKey inputs resolve ColumnRef → sqlName.
export type TableExtras = {
	readonly indexes?: ReadonlyArray<IndexDeclaration>;
	readonly foreignKeys?: ReadonlyArray<ForeignKeyInput>;
};
export type ForeignKeyInput = {
	readonly columns: ReadonlyArray<ColumnRef>;
	readonly references: {
		readonly table: Table;
		readonly columns: ReadonlyArray<ColumnRef>;
	};
	readonly onDelete?: ForeignKeyAction;
};

export const table: <TColumns extends Record<string, ColumnBuilder>>(
	owner: SchemaDeclaration,
	tableName: string,
	columns: TColumns,
	extras?: (t: TableColumns<TColumns>) => TableExtras,
) => Table<TColumns>;
```

- `TableExtrasHelpers` and its `column()` helper are **deleted** (replaced
  by direct refs). `TableDeclaration` itself (internal model) is unchanged
  except `ForeignKeyDeclaration.references.table` stays a
  `TableDeclaration` — `table()` unwraps `ForeignKeyInput.references.table`
  via `getTableMeta` at declaration time.
- `generateMigration` (and the golden harness `StepsModule` type) accept
  `HejbroInput = HejbroDeclaration | Table`; normalize at the entry:
  `const normalized = declarations.map(resolveDeclaration)` where
  `resolveDeclaration` returns `getTableMeta(input)` when `isTable(input)`,
  else the input. Add `HejbroInput` to `kind/object-kind.ts` or
  `engine/generate.ts` (implementer's choice; export it).

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/table-surface.test.ts
import { describe, expect, it } from "vitest";
import {
	getTableMeta,
	index,
	isTable,
	schema,
	table,
	text,
	timestamptz,
	uuid,
} from "../src/index";

const app = schema("app");

describe("table() surface (D15)", () => {
	it("exposes columns as top-level ColumnRef properties", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			publishedAt: timestamptz(),
		});
		expect(posts.id.family).toBe("uuid");
		expect(posts.publishedAt.sqlName).toBe("published_at");
		expect(posts.publishedAt.exprNode).toEqual({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "published_at",
		});
	});
	it("hides declaration metadata behind the symbol", () => {
		const posts = table(app, "posts", { id: uuid() });
		expect(isTable(posts)).toBe(true);
		const meta = getTableMeta(posts);
		expect(meta.tableName).toBe("posts");
		expect(meta.columns[0]?.columnName).toBe("id");
		expect(Object.keys(posts)).toEqual(["id"]);
	});
	it("passes column refs to extras and resolves index()/fk inputs", () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), publishedAt: timestamptz() },
			(t) => ({ indexes: [index().on(t.publishedAt)] }),
		);
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual(["published_at"]);
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid().notNull() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
						onDelete: "cascade",
					},
				],
			}),
		);
		const fk = getTableMeta(comments).foreignKeys[0];
		expect(fk?.columns).toEqual(["post_id"]);
		expect(fk?.references.table.tableName).toBe("posts");
	});
	it("keeps rejecting duplicate snake_cased column names", () => {
		expect(() =>
			table(app, "posts", { postId: uuid(), post_id: uuid() }),
		).toThrowError(/duplicate-column|duplicate column/);
	});
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hejbro/core test -- table-surface`
Expected: FAIL — `getTableMeta`/`index`/`isTable` not exported; `table()`
returns the old shape.

- [x] **Step 3: Implement**

In `table()`: build `columnEntries` as today; build the refs object with
`Object.fromEntries(columnEntries.map((entry) => [entry.columnKey, columnRef(owner.schemaName, tableName, entry.columnName, entry.columnState.typeNode)]))`;
call `extras?.(refsObject)`; resolve `ForeignKeyInput` →
`ForeignKeyDeclaration` (map `ColumnRef.sqlName`, unwrap references.table
via `getTableMeta`, default `onDelete` to `null`); keep
`validateColumnRefs` (feed it the resolved snake names; also validate that
every `ColumnRef` passed for *this table's* columns actually belongs to it:
compare `ref.exprNode.tableName === tableName && ref.exprNode.schemaName === owner.schemaName`,
else `throwHejbroError("foreign-column-ref", …)` per the designer's message
draft: `` `table "${tableName}" received a column of "${ref.exprNode.schemaName}.${ref.exprNode.tableName}" — indexes and local fk columns must use this table's own columns.` ``);
assemble the return as
`Object.assign(refsObject, { [tableMeta]: declaration }) as Table<TColumns>`
— with a JSDoc note that the assertion is the one place the mapped type
meets the runtime object.

`index-builder.ts`: an immutable chainer:
`index(indexName)` holds `{ unique: false, indexName: indexName ?? null }`;
`.unique()` returns a new builder with `unique: true`; `.on(...columns)`
returns `{ columns: columns.map((column) => column.sqlName), unique, indexName }`.

Type-only casualty check: `TableDeclaration`'s type stays exported;
`TableExtrasHelpers` export is removed from `index.ts`. Update
`test/dsl.test.ts` cases that used `t.column("…")` or raw index objects,
and migrate `test/golden/cases/app-posts/declarations.ts` + `steps.ts`
to the new surface (`index().on(…)`, `ForeignKeyInput` with refs; steps
export type becomes `ReadonlyArray<ReadonlyArray<HejbroInput>>`; the golden
harness's `StepsModule` type in `golden.test.ts` follows). The emitted
SQL and snapshot goldens must NOT change in this task — only declaration
syntax migrates.

- [x] **Step 4: Run the full suite**

Run: `pnpm check-types && pnpm --filter @hejbro/core test`
Expected: PASS, golden files byte-identical (`git diff --stat` shows no
`expected/` changes).

- [x] **Step 5: Commit**

```bash
pnpm check && git add packages/core && git commit -m "feat(core)!: drizzle-style table objects with symbol-hidden metadata"
```

---

### Task 8: `select` builder, query rendering, `exists`

**Files:**
- Create: `packages/core/src/query/select.ts`
- Modify: `packages/core/src/expr/render-sql.ts` (add `renderSelect`,
  replace the Task 3 `exists` stub)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/query/select.test.ts`

**Interfaces:**
- Consumes: `Table`, `getTableMeta`, `isTable` from `../dsl/table`; node
  types from `../expr/ast`; operators for tests.
- Produces:

```ts
// type-state stages — each stage only exposes what may legally come next
export type SelectLimited = { readonly selectQuery: SelectNode };
export type SelectOrdered = SelectLimited & {
	limit(count: number): SelectLimited;
};
export type SelectFiltered = SelectOrdered & {
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SelectOrdered;
};
export type SelectJoinable = SelectFiltered & {
	innerJoin(joined: Table, on: Expr<"boolean">): SelectJoinable;
	where(condition: Expr<"boolean">): SelectFiltered;
};
export type OrderTermInput = Expr | { readonly by: Expr; readonly direction: "asc" | "desc" };

export type SelectProjection =
	| Table
	| Record<string, Expr>; // object projection: alias → expression

export const select: (projection: SelectProjection, from?: Table) => SelectJoinable;
// select(posts)                 → whole table (explicit column list, deterministic)
// select({ id: posts.id }, posts) → object projection; `from` required here
export const exists: (query: SelectLimited) => Expr<"boolean">;
export const notExists: (query: SelectLimited) => Expr<"boolean">;

// from render-sql.ts — outerScope: tables inherited from the enclosing
// query or statement context (correlated subqueries; see scope rule below)
export const renderSelect: (
	query: SelectNode,
	outerScope?: ReadonlyArray<TableRefNode>,
) => string;
```

Design notes locked here:
- `select(posts)` records `projectionKind: "allColumns"` with the table's
  snake_cased column names (NOT `*` — deterministic under later
  `add column`).
- `exists(…)` **replaces the query's projection with `constantOne`**
  (`select 1` idiom, matching every original production RLS policy) regardless of what
  was selected, and renders `exists (…)` / `not exists (…)`.
- Object projection requires the explicit `from` table; omitting it throws
  code `missing-from-table`, message:
  `"select() with an object projection can't infer the from table — pass it as the second argument: select({ … }, posts)."`
- `limit` validates `Number.isInteger(count) && count >= 0`, else code
  `invalid-limit` with message
  `` `limit(${count}) must be a non-negative integer.` ``
- `orderBy` accepts a bare `Expr` (direction defaults to `"asc"`) or the
  `{ by, direction }` object form.
- **Scope rule (correlated subqueries are first-class — real RLS depends on
  them):** each `renderSelect` call computes
  `scope = [from, …joins, …outerScope]`. Every `columnRef` inside
  `where`/`on`/projection must belong to a table in `scope` — walk the AST
  (a small `collectColumnRefs(node): ReadonlyArray<ColumnRefNode>` helper
  in `render-sql.ts` that does NOT descend into `exists` nodes). When
  rendering an `exists` node, pass the current `scope` down as the
  subquery's `outerScope` — so
  `exists (select 1 from posts where posts.id = comments.post_id)` inside a
  select from `comments` validates: the subquery's scope is
  `[posts, comments]`. Phase 4 will render standalone RLS expressions with
  `renderExpr(node, [policyTable])` the same way. On a violation, throw
  code `foreign-column-ref`, message:
  `` `select from "${schema}.${table}" references column "${refSchema}.${refTable}.${column}" — join that table, or reference it from an enclosing query via exists().` ``
- Rendered clause order: `select … from … [inner join … on …]* [where …] [order by …] [limit …]`, single spaces, no trailing semicolon (statement-level callers add it).

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/query/select.test.ts
import { describe, expect, it } from "vitest";
import {
	and,
	eq,
	exists,
	isNotNull,
	renderExpr,
	renderSelect,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

describe("select builder", () => {
	it("renders a whole-table select with explicit columns", () => {
		expect(renderSelect(select(posts).selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts"',
		);
	});
	it("renders where / order by / limit in type-state order", () => {
		const query = select(posts)
			.where(eq(posts.status, "published"))
			.orderBy({ by: posts.publishedAt, direction: "desc" })
			.limit(10);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'published\' order by "app"."posts"."published_at" desc limit 10',
		);
	});
	it("renders the app schema's rls shape: exists + inner join", () => {
		const guard = exists(
			select(comments)
				.innerJoin(posts, eq(comments.postId, posts.id))
				.where(isNotNull(posts.publishedAt)),
		);
		expect(renderSelect(select(comments).where(guard).selectQuery)).toContain(
			'exists (select 1 from "app"."comments" inner join "app"."posts" on',
		);
	});
	it("renders a correlated subquery referencing the outer table", () => {
		// the canonical rls form: comment is visible iff its post is published
		const guard = exists(
			select(posts).where(
				and(eq(posts.id, comments.postId), isNotNull(posts.publishedAt)),
			),
		);
		expect(renderSelect(select(comments).where(guard).selectQuery)).toBe(
			'select "id", "post_id" from "app"."comments" where exists (select 1 from "app"."posts" where ("app"."posts"."id" = "app"."comments"."post_id") and ("app"."posts"."published_at" is not null))',
		);
	});
	it("renders a standalone correlated expression given an outer scope", () => {
		// how phase 4 renders an rls using-expression for a policy on comments
		const guard = exists(
			select(posts).where(eq(posts.id, comments.postId)),
		);
		expect(
			renderExpr(guard.exprNode, [
				{ schemaName: "app", tableName: "comments" },
			]),
		).toContain('= "app"."comments"."post_id"');
	});
	it("rejects column refs from tables in no enclosing scope", () => {
		const query = select(posts).where(isNotNull(comments.postId));
		expect(() => renderSelect(query.selectQuery)).toThrowError(
			/foreign-column-ref|join that table/,
		);
	});
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hejbro/core test -- query/select`
Expected: FAIL — `select` not exported.

- [x] **Step 3: Implement**

Builder: one private `makeStages(query: SelectNode)` returning the full
stage object; each chainer builds a new `SelectNode` and re-invokes
`makeStages` (the returned type narrows per stage — same immutable pattern
as `createColumnBuilder`). `select()` resolves its projection: `isTable`
→ allColumns from `getTableMeta`; otherwise object → `columns` with
`Object.entries` mapped to `{ alias: toSnakeCase(key), expr: value.exprNode }`.
`renderSelect` + `collectColumnRefs` land in `render-sql.ts`; the Task 3
`exists` stub is replaced with
`` `exists (${renderSelect(node.query)})` `` (+ `not `). Note: table-ref
rendering shares a helper `renderTableRef(node) = qualifyName(schemaName, tableName)`.

- [x] **Step 4: Run to verify it passes**

Run: `pnpm check-types && pnpm --filter @hejbro/core test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm check && git add packages/core && git commit -m "feat(core): type-state select builder with exists and join rendering"
```

---

### Task 9: `insert` / `update` / `delete` builders

**Files:**
- Create: `packages/core/src/query/mutate.ts`
- Modify: `packages/core/src/expr/render-sql.ts` (add
  `renderInsert`/`renderUpdate`/`renderDelete` and a shared
  `renderQuery(node: QueryNode): string` dispatcher)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/query/mutate.test.ts`

**Interfaces:**
- Consumes: `Table`, `getTableMeta` from `../dsl/table`; `liftOperand`
  from `../expr/literal`; `BuilderFamily` for row typing.
- Produces:

```ts
export type MutationValue<TFamily extends SqlTypeFamily> =
	| Expr<TFamily>
	| Expr<"unknown">
	| LiftableFor<TFamily>
	| null;

export type MutationRow<TTable extends Table> = TTable extends Table<infer TColumns>
	? { readonly [K in keyof TColumns]?: MutationValue<BuilderFamily<TColumns[K]>> }
	: never;

// insert — type-state: values → onConflict? → returning?
export const insert: <TTable extends Table>(target: TTable) => {
	values(rows: MutationRow<TTable> | ReadonlyArray<MutationRow<TTable>>): InsertConflictable<TTable>;
};
export type InsertConflictable<TTable extends Table> = InsertReturnable & {
	onConflictDoNothing(...targetColumns: ReadonlyArray<ColumnRef>): InsertReturnable;
	onConflictDoUpdate(config: {
		readonly target: ReadonlyArray<ColumnRef>;
		readonly set: MutationRow<TTable>;
	}): InsertReturnable;
};
export type InsertReturnable = InsertFinal & {
	returning(): InsertFinal; // no-arg = all columns (spec §5.2)
};
export type InsertFinal = { readonly insertQuery: InsertNode };

// update — type-state: set → where? → returning?
export const update: <TTable extends Table>(target: TTable) => {
	set(values: MutationRow<TTable>): UpdateFilterable;
};
export type UpdateFilterable = UpdateReturnable & {
	where(condition: Expr<"boolean">): UpdateReturnable;
};
export type UpdateReturnable = UpdateFinal & { returning(): UpdateFinal };
export type UpdateFinal = { readonly updateQuery: UpdateNode };

// delete — deleteFrom (`delete` is a reserved word)
export const deleteFrom: (target: Table) => DeleteFilterable;
export type DeleteFilterable = DeleteReturnable & {
	where(condition: Expr<"boolean">): DeleteReturnable;
};
export type DeleteReturnable = DeleteFinal & { returning(): DeleteFinal };
export type DeleteFinal = { readonly deleteQuery: DeleteNode };

// outerScope threads through exactly like renderSelect's (Task 8 scope
// rule): a mutation's where-scope is [target table, …outerScope], and
// exists subqueries inherit it — Phase 3 function bodies rely on this.
export const renderQuery: (
	node: QueryNode,
	outerScope?: ReadonlyArray<TableRefNode>,
) => string;
```

Design notes locked here:
- Row keys are the TS column keys; unknown keys throw code
  `unknown-column`, message
  `` `insert()/update() on "${schema}.${table}" received unknown column key "${key}" — check the table declaration.` ``
  `null` values lift to a null literal (allowed here, unlike comparisons).
- Multi-row insert: the column set is the union of keys across rows in
  first-appearance order; a row missing a key renders SQL `default` in that
  position (Postgres inserts the column default) — this keeps
  `columnNames` well-defined without inventing per-row column lists.
- `returning()` with no args records `returningKind: "allColumns"` with the
  table's snake_cased names (explicit, deterministic). Column-list
  returning is NOT in v1 (single YAGNI cut from the designer's option — the
  spec only shows bare `.returning()`; revisit when Phase 3 needs
  narrowing).
- `update().set({})` / empty insert rows throw code `empty-set`, message
  `"set()/values() received no columns — declare at least one column to write."`
- Rendered shapes (no trailing semicolons):
  - `insert into "s"."t" ("a", "b") values (1, 'x'), (2, default)`
  - `… on conflict ("id") do nothing` / `… on conflict ("id") do update set "a" = 1`
  - `update "s"."t" set "a" = 1, "b" = 'x' where … returning "id", "a", "b"`
  - `delete from "s"."t" where … returning …`

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/query/mutate.test.ts
import { describe, expect, it } from "vitest";
import {
	deleteFrom,
	eq,
	insert,
	now,
	renderQuery,
	schema,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	slug: text().notNull(),
	publishedAt: timestamptz(),
});

describe("mutation builders", () => {
	it("renders the spec §5.2 update shape", () => {
		const query = update(posts)
			.set({ publishedAt: now() })
			.where(eq(posts.slug, "hello"))
			.returning();
		expect(renderQuery(query.updateQuery)).toBe(
			"update \"app\".\"posts\" set \"published_at\" = now() where \"app\".\"posts\".\"slug\" = 'hello' returning \"id\", \"slug\", \"published_at\"",
		);
	});
	it("renders insert with on conflict do nothing", () => {
		const query = insert(posts)
			.values({ slug: "hello" })
			.onConflictDoNothing(posts.slug);
		expect(renderQuery(query.insertQuery)).toBe(
			'insert into "app"."posts" ("slug") values (\'hello\') on conflict ("slug") do nothing',
		);
	});
	it("fills missing multi-row keys with sql default", () => {
		const query = insert(posts).values([
			{ slug: "a", publishedAt: now() },
			{ slug: "b" },
		]);
		expect(renderQuery(query.insertQuery)).toBe(
			"insert into \"app\".\"posts\" (\"slug\", \"published_at\") values ('a', now()), ('b', default)",
		);
	});
	it("renders delete with where and returning", () => {
		const query = deleteFrom(posts).where(eq(posts.slug, "old")).returning();
		expect(renderQuery(query.deleteQuery)).toBe(
			"delete from \"app\".\"posts\" where \"app\".\"posts\".\"slug\" = 'old' returning \"id\", \"slug\", \"published_at\"",
		);
	});
	it("rejects unknown column keys with an actionable error", () => {
		expect(() =>
			insert(posts).values({ nope: "x" } as never),
		).toThrowError(/unknown-column|unknown column key/);
	});
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hejbro/core test -- query/mutate`
Expected: FAIL — builders not exported.

- [x] **Step 3: Implement**

`mutate.ts` resolves TS keys → snake names through `getTableMeta` (build a
`Map` from a private helper shared with `select.ts` if natural — otherwise
duplicate the three lines; do not force a premature abstraction). Values
lift via `liftOperand(value, familyOfTypeNode(column.typeNode))` with an
explicit null branch (null → null literal). The multi-row `default` filler
is represented in the AST as `{ nodeKind: "rawSql", sql: "default" }`
constructed internally (acceptable: internal constant, not user input —
add a code comment saying so). Renderers in `render-sql.ts` +
`renderQuery` dispatching on `queryKind` with `assertNever`.

- [x] **Step 4: Run to verify it passes**

Run: `pnpm check-types && pnpm --filter @hejbro/core test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm check && git add packages/core && git commit -m "feat(core): insert, update, delete builders with on conflict and returning"
```

---

### Task 10: Replace `ColumnDefault` with the expression AST (D16, snapshot v2)

**Files:**
- Modify: `packages/core/src/types/column-builder.ts` (delete
  `ColumnDefault`; `ColumnState.defaultValue: ExprNode | null`; `.default()`
  signature)
- Modify: `packages/core/src/kinds/table-snapshot.ts`
  (`ColumnSnapshot.default: string | null` — rendered SQL)
- Modify: `packages/core/src/kinds/table-kind.ts` (serialize renders the
  default via `renderExpr`)
- Modify: `packages/core/src/kinds/table-kind-emit-sql.ts` (delete
  `renderColumnDefault` + `renderLiteralValue`; `defaultClause` emits the
  stored string)
- Modify: `packages/core/src/kinds/table-kind-emit.ts` (`set default
  ${entry.next.default}` uses the string directly)
- Modify: `packages/core/src/snapshot/snapshot.ts`
  (`HEJBRO_SNAPSHOT_VERSION = 2`)
- Modify: `packages/core/src/index.ts` (drop `ColumnDefault` export)
- Test: `packages/core/test/column-builder.test.ts`,
  `packages/core/test/table-kind-emit.test.ts`,
  `packages/core/test/snapshot.test.ts`, golden fixtures under
  `packages/core/test/golden/cases/app-posts/expected/`

**Interfaces:**
- Consumes: `Expr`, `isExpr`, `ExprNode` from `../expr/ast`; `liftLiteral`
  from `../expr/literal`; `renderExpr` from `../expr/render-sql`;
  `familyOfTypeNode`.
- Produces:

```ts
// on ColumnBuilder<TFamily>
default(value: LiftableFor<TFamily> | Expr<TFamily> | Expr<"unknown">): ColumnBuilder<TFamily>;
// defaultRandom(): sugar for functionCall gen_random_uuid (uuid guard unchanged)
// defaultNow(): sugar for functionCall now (time-like guard unchanged)
```

- The old `raw` default shape is covered by `` .default(sql`…`) ``.
- Snapshot: `ColumnSnapshot.default` is the **rendered SQL string** (e.g.
  `"gen_random_uuid()"`, `"'hello'"`, `"now()"`) — diffing stays
  `sameJson` (string compare), `defaultAlterStatements` interpolates the
  string directly.
- `HEJBRO_SNAPSHOT_VERSION` bumps to `2`. The existing version-mismatch
  hard error in `parseSnapshot` (snapshot.ts:145-149) is the entire
  migration story — pre-publication, no compatibility shim (D16).

- [x] **Step 1: Update the failing tests first**

In `column-builder.test.ts`: assert `uuid().defaultRandom()` yields
`columnState.defaultValue` equal to
`{ nodeKind: "functionCall", schemaName: null, functionName: "gen_random_uuid", args: [] }`;
`text().default("hi")` yields a string literal node;
`timestamptz().default(sql\`now() + interval '1 day'\`)` yields a
`sqlTemplate` node. Keep the existing wrong-type guard tests
(`defaultRandom` on text still throws `invalid-column-default`).
In `table-kind-emit.test.ts`/`snapshot.test.ts`: defaults now appear as
rendered strings.

- [x] **Step 2: Run to verify failures**

Run: `pnpm --filter @hejbro/core test`
Expected: FAIL across default-related assertions.

- [x] **Step 3: Implement**

`.default(value)`: if `isExpr(value)` store `value.exprNode`; else store
`{ nodeKind: "literal", literal: liftLiteral(value, familyOfTypeNode(columnState.typeNode)) }`.
`table-kind.ts` serialize: default column field =
`renderExpr(columnState.defaultValue)` when non-null. Delete dead code
(`renderColumnDefault`, `renderLiteralValue`, the `ColumnDefault` type and
its import sites). Bump the snapshot version constant and its JSDoc.

- [x] **Step 4: Regenerate golden fixtures and verify**

```bash
UPDATE_GOLDEN=1 pnpm --filter @hejbro/core test
git diff packages/core/test/golden   # review: defaults become strings, version becomes 2 — nothing else
pnpm check-types && pnpm --filter @hejbro/core test
```

Expected: the only fixture changes are `"defaultKind": …` object → SQL
string (`"default": "gen_random_uuid()"`) and the snapshot `version` field
1 → 2. Emitted `.sql` goldens are byte-identical (the rendered SQL for
`gen_random_uuid()`/`now()` is unchanged).

- [x] **Step 5: Commit**

```bash
pnpm check && git add packages/core && git commit -m "feat(core)!: expression-based column defaults and snapshot v2"
```

---

### Task 11: Golden expression corpus (issue #3 acceptance)

**Files:**
- Create: `packages/core/test/expr/corpus.test.ts`
- Create: `packages/core/test/expr/corpus.expected.txt` (generated then
  committed)

**Interfaces:**
- Consumes: the full public surface from Tasks 1–10 via `../../src/index`.

**Corpus contents (one labeled entry per line: `label => sql`):** every
operator from Task 4 at least once; literal edge cases (embedded quotes,
the injection strings from Tasks 2/5, negative and fractional numbers,
Date); `sql` template + `sql.raw`; the app schema's RLS shapes — (a)
`using`-style: `eq(status, "published")`-family with and/or grouping, (b)
`exists` + inner join ("reaction's comment's post is published", mirroring
the `reactions` policy), (c) **correlated** `exists` rendered standalone
with an outer scope, exactly how Phase 4 will render a policy on
`comments`:
`renderExpr(exists(select(posts).where(and(eq(posts.id, comments.postId), isNotNull(posts.publishedAt)))).exprNode, [commentsTableRef])`,
(d) **`with check`-shaped** expressions (D19): the same correlated guard in
write-position reasoning ("you may only insert a comment whose post is
published") — same AST, labeled as with-check in the corpus;
the spec §5.2 function-body queries (`select(posts).where(eq(posts.id, …))`
and `update(posts).set({ publishedAt: now() }).where(…).returning()`);
insert with multi-row + `on conflict do nothing` and `do update set`;
`deleteFrom` with returning; `orderBy` + `limit`.

- [x] **Step 1: Write the harness (failing: no expected file)**

```ts
// packages/core/test/expr/corpus.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// …import the whole DSL surface, declare the app posts/comments tables
// exactly as in query tests, then:

type CorpusEntry = { readonly label: string; readonly sql: string };
const corpus: ReadonlyArray<CorpusEntry> = [
	{ label: "eq lifted string", sql: renderExpr(eq(posts.status, "published").exprNode) },
	// … every entry listed above, one per line …
];

const expectedPath = join(import.meta.dirname, "corpus.expected.txt");
const actual = corpus
	.map((entry) => `${entry.label} => ${entry.sql}`)
	.join("\n");

describe("expression corpus golden", () => {
	it("matches the committed corpus", () => {
		if (process.env.UPDATE_GOLDEN === "1") {
			writeFileSync(expectedPath, `${actual}\n`);
		}
		expect(existsSync(expectedPath)).toBe(true);
		expect(`${actual}\n`).toBe(readFileSync(expectedPath, "utf8"));
	});
	it("is deterministic across two renders", () => {
		const second = corpus
			.map((entry) => `${entry.label} => ${entry.sql}`)
			.join("\n");
		expect(second).toBe(actual);
	});
});
```

(Reuses the existing golden harness's `UPDATE_GOLDEN=1` convention —
golden.test.ts:36-47.)

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hejbro/core test -- expr/corpus`
Expected: FAIL — missing `corpus.expected.txt`.

- [x] **Step 3: Generate, review, commit the corpus**

```bash
UPDATE_GOLDEN=1 pnpm --filter @hejbro/core test -- expr/corpus
```

**Review the generated file line by line** — this is the security review
surface: check every quoted literal, every identifier, the injection
entries. Then:

- [x] **Step 4: Run to verify it passes**

Run: `pnpm --filter @hejbro/core test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm check && git add packages/core/test/expr && git commit -m "test(core): golden expression corpus for phase 2 acceptance"
```

---

### Task 12: Docs, roadmap frontier, final gates

**Files:**
- Modify: `docs/plans/2026-08-19-roadmap.md` (mark Phase 2 ✅ with a landed
  summary, matching the Phase 1 entry's format)
- Modify: this plan (check off completed tasks)

- [x] **Step 1: Update the roadmap** — Phase 2 heading gets `✅` and a
  short "Landed: …" paragraph naming the expression AST, builders, table
  surface change (D15), snapshot v2 (D16), and the corpus location.
- [x] **Step 2: Run all gates and capture output**

```bash
pnpm check && pnpm check-types && pnpm test && pnpm build
```

Expected: all green, including `@hejbro/core` build via tsdown.

- [x] **Step 3: Commit**

```bash
git add docs && git commit -m "docs: mark phase 2 landed in roadmap"
```

- [x] **Step 4: Prepare the PR** — push the branch to `upstream`, verify
  with `git ls-remote --heads upstream <branch>`, open the PR against
  `dev` with the squash-commit list and `Closes` reference to the Phase 2
  work-item sub-issue (planner files these; see below), body first line:
  `> 📮 Filed from \`quickstart-now/hejbro\` — Claude Code (agent). Part of #3.`

---

## Sub-issue mapping (issue-first; planner files before implementation)

Following the Phase 1 pattern (#13–#19), file these as sub-issues of #3 via
GraphQL `addSubIssue`, each `enhancement` + assignee `hello-pooh`:

1. `expression ast, type families, and literal rendering` — Tasks 1–3
2. `typed operators, sql template, and column builder families` — Tasks 4–6
3. `drizzle-style table objects with column references` — Task 7
4. `select, insert, update, delete builders and query rendering` — Tasks 8–9
5. `expression-based column defaults and snapshot v2` — Task 10
6. `golden expression corpus and phase 2 close-out` — Tasks 11–12

PR boundaries: one PR per sub-issue is the default; adjacent sub-issues may
merge into one PR when the diff stays reviewable (< ~600 lines). Every PR
lists its squash commits and `Closes #<sub-issue>`.

## Reviewer focus (handed to reviewer with each PR)

1. **Quoting/escaping is the security surface**: every identifier through
   `quoteIdentifier`, every literal through `renderLiteral`/
   `quoteStringLiteral`; `rawSql` reachable only from `sql.raw` and the
   internal insert-`default` filler.
2. Tagged-union exhaustiveness: every `switch` on `nodeKind`/`literalKind`/
   `queryKind` ends in `assertNever`.
3. Core purity: no fs/DB imports under `packages/core/src`.
4. Error messages: code + why + what-to-do (spec §7).
5. Golden diffs reviewed line-by-line, especially Task 10's fixture change
   and Task 11's corpus.
6. Correlated-subquery scope: `exists` must inherit the enclosing scope
   (Task 8 scope rule); any test that "fixes" a `foreign-column-ref` by
   comparing a column to itself is masking a scope bug — reject it.

**Test-only convention (agreed 2026-08-19):** `as never` / `as unknown as T`
casts are permitted in test files ONLY, and ONLY to force a runtime
negative-case past the compiler (e.g. Task 9's unknown-column-key test).
They stay banned in `src/`. Reviewer applies this line, not the general
typescript-rules `as` restriction, to such test lines.
