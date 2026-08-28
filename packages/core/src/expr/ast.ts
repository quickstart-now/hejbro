import type { TypeNode } from "../types/type-node";
import type { FamilyOfTypeNode, SqlTypeFamily } from "./type-family";
import { familyOfTypeNode } from "./type-family";

/**
 * A literal value captured at build time, already narrowed to a renderable
 * shape. `bigint`/`interval`/`array` (harden-query-layer #322, mutation
 * write values only — see `query/column-value.ts`'s `liftColumnValue`, the
 * one function that ever constructs these three) all carry a plain `text`
 * string, never a raw `bigint`/structured `IntervalValue`/JS array: the
 * snapshot/codec boundary (`JsonValue`, `snapshot/stable-json.ts`) is JSON
 * values only, and text is JSON-safe by construction, mirroring the
 * existing `timestamp`/`isoValue` precedent (a `Date` is never carried
 * raw either) — this is also why these three kinds need no special-cased
 * `codec.ts` encode/decode at all, unlike an earlier attempt that carried
 * `bigint` raw and needed a `toString()`/`BigInt(...)` round trip.
 * `liftLiteral` (this file's sibling, `expr/literal.ts`) never constructs
 * any of these three — it's the *declaration*-path lifter (`.default()`,
 * comparison operators), unchanged since before #322, and structurally
 * cannot produce them.
 */
export type LiteralNode = {
	readonly nodeKind: "literal";
	readonly literal:
		| { readonly literalKind: "string"; readonly value: string }
		| { readonly literalKind: "number"; readonly value: number }
		| { readonly literalKind: "boolean"; readonly value: boolean }
		| { readonly literalKind: "null" }
		| { readonly literalKind: "timestamp"; readonly isoValue: string }
		| { readonly literalKind: "bigint"; readonly text: string }
		| { readonly literalKind: "interval"; readonly text: string }
		| { readonly literalKind: "array"; readonly text: string }
		/**
		 * A written `json`/`jsonb` value, already serialized (#425). Carries
		 * WHICH of the two it was declared as: rendering a `json` column's
		 * value with a `::jsonb` cast would silently apply jsonb's own key
		 * reordering and duplicate-stripping to a column whose whole point
		 * is that it does not do that.
		 */
		| {
				readonly literalKind: "json";
				readonly text: string;
				readonly typeName: "json" | "jsonb";
		  }
		/** A written `bytea` value as Postgres hex format (`\x…`) (#425). */
		| { readonly literalKind: "bytea"; readonly text: string };
};

export type ColumnRefNode = {
	readonly nodeKind: "columnRef";
	readonly schemaName: string;
	readonly tableName: string;
	readonly columnName: string;
};

/**
 * A plpgsql-local reference — NEW/OLD row fields, function args, and
 * declared locals — rendered dot-joined and unquoted (dual quoting policy,
 * spec §5.3 / decision A3). Invisible to `collectColumnRefs` scope
 * validation: it never names a declared table.
 */
export type PlpgsqlRefNode = {
	readonly nodeKind: "plpgsqlRef";
	readonly path: ReadonlyArray<string>;
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

/**
 * A select statement embedded as a scalar expression (add-relational-reads,
 * D102) — the nested-read primitive. `mode` picks the aggregation:
 * `jsonArray` renders `(select coalesce(json_agg("agg"), '[]'::json)
 * from (…) as "agg")`, `jsonObject` renders `(select row_to_json("agg")
 * from (…) as "agg")`. Unlike {@link ExistsNode}, the embedded query's
 * projection is the point and is never rewritten.
 */
export type SelectExprNode = {
	readonly nodeKind: "selectExpr";
	readonly mode: "jsonArray" | "jsonObject";
	readonly query: SelectNode;
};

export type ExprNode =
	| LiteralNode
	| ColumnRefNode
	| PlpgsqlRefNode
	| ComparisonNode
	| LogicalNode
	| NotNode
	| NullTestNode
	| InListNode
	| BetweenNode
	| FunctionCallNode
	| SqlTemplateNode
	| RawSqlNode
	| ExistsNode
	| SelectExprNode;

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
				/** The caller's verbatim projection key (#339) — the key the query layer keys converted result rows by. TS-side only: `alias` (snake, per medium) is what rendering emits and what the expression codec stores, so this field never reaches SQL text or a snapshot; absent on a codec-decoded node (a stored view query), where no runtime row is ever converted. */
				readonly resultKey?: string;
				readonly expr: ExprNode;
			}>;
	  }
	| { readonly projectionKind: "constantOne" };

export const joinKinds = ["inner", "left"] as const;
export type JoinKind = (typeof joinKinds)[number];

export type JoinNode = {
	readonly joinKind: JoinKind;
	readonly table: TableRefNode;
	readonly on: ExprNode;
};

export type OrderByTerm = {
	readonly expr: ExprNode;
	readonly direction: "asc" | "desc";
};

/**
 * `select distinct` / `select distinct on (...)` (#437). `on` is
 * Postgres-only and has no portable equivalent — the idiomatic way to
 * take one row per group — so it is first-class here rather than pushed
 * to the `sql` escape hatch.
 */
export type DistinctNode =
	| { readonly distinctKind: "all" }
	| {
			readonly distinctKind: "on";
			readonly columns: ReadonlyArray<ExprNode>;
	  };

export type SelectNode = {
	readonly queryKind: "select";
	readonly projection: ProjectionNode;
	readonly from: TableRefNode;
	readonly joins: ReadonlyArray<JoinNode>;
	readonly where: ExprNode | null;
	readonly groupBy: ReadonlyArray<ExprNode>;
	/** `having` filters GROUPS, after aggregation — `where` filters rows before it. Postgres rejects a `having` without a `group by` only when the expression isn't aggregate-shaped, so this node allows the pair independently and lets the server decide. */
	readonly having: ExprNode | null;
	readonly orderBy: ReadonlyArray<OrderByTerm>;
	readonly limit: number | null;
	readonly offset: number | null;
	readonly distinct: DistinctNode | null;
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
				/** Same contract as `ProjectionNode`'s own `resultKey` (#339). */
				readonly resultKey?: string;
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

/**
 * A set-operation statement (add-set-operations, D103) — `union`/
 * `intersect`/`except` over two branches, each a select or (recursively)
 * another set operation, so `(a union b) except c` is the node shape
 * itself. `orderBy`/`limit` here govern the WHOLE set — SQL's own
 * placement — never a branch (a branch carries its own).
 */
export type SetOpNode = {
	readonly queryKind: "setOp";
	readonly operator: "union" | "intersect" | "except";
	readonly all: boolean;
	readonly left: SelectNode | SetOpNode;
	readonly right: SelectNode | SetOpNode;
	readonly orderBy: ReadonlyArray<OrderByTerm>;
	readonly limit: number | null;
	readonly offset: number | null;
};

export type QueryNode =
	| SelectNode
	| InsertNode
	| UpdateNode
	| DeleteNode
	| SetOpNode;

// --- the user-facing wrapper ---

/** A typed SQL expression: an AST node plus its phantom-but-runtime type family (D17). */
export type Expr<TFamily extends SqlTypeFamily = SqlTypeFamily> = {
	readonly family: TFamily;
	readonly exprNode: ExprNode;
};

/**
 * What every condition position accepts. `sql` templates produce
 * `Expr<"unknown">` because a template's family cannot be narrowed at
 * compile time, so a position that admitted only `Expr<"boolean">` would
 * shut the escape hatch out of it. `check()` (D50), partial-index
 * `.where()` (D51) and RLS policies (#113) each adopted this union; the
 * query-side condition positions are its fourth application, not a new
 * design (#386).
 */
export type Condition = Expr<"boolean"> | Expr<"unknown">;

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

export const columnRef = <TNode extends TypeNode>(
	schemaName: string,
	tableName: string,
	columnName: string,
	typeNode: TNode,
): ColumnRef<FamilyOfTypeNode<TNode>> => ({
	family: familyOfTypeNode(typeNode) as FamilyOfTypeNode<TNode>,
	exprNode: { nodeKind: "columnRef", schemaName, tableName, columnName },
	typeNode,
	sqlName: columnName,
});

export const isExpr = (value: unknown): value is Expr =>
	typeof value === "object" && value !== null && "exprNode" in value;
