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
		| { readonly literalKind: "array"; readonly text: string };
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
