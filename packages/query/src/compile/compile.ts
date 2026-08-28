import type {
	DeleteNode,
	ExprNode,
	InsertNode,
	QueryNode,
	SelectNode,
	UpdateNode,
} from "@hejbro/core";
import { renderExpr } from "@hejbro/core";
import { compileDelete, compileInsert, compileUpdate } from "./mutation";
import { liftExprNode } from "./params";
import { compileSelect, compileSetOp } from "./select";

/**
 * `compile()`'s input: any stage of a `select`/`insert`/`update`/
 * `deleteFrom` builder chain from `@hejbro/core` — every stage exposes its
 * `*Query` field — a bare `QueryNode` directly — or a `sql` escape-hatch
 * result compiled as a whole statement (its `statementExpr`, task 2.6;
 * owner-settled contract, 2026-08-26, see
 * `openspec/changes/add-query-layer/design.md`).
 */
export type CompileInput =
	| { readonly selectQuery: SelectNode }
	| { readonly insertQuery: InsertNode }
	| { readonly updateQuery: UpdateNode }
	| { readonly deleteQuery: DeleteNode }
	| { readonly statementExpr: ExprNode }
	| QueryNode;

/**
 * Discriminates a {@link CompileResult} — mirrors `QueryNode["queryKind"]`
 * for the four builder-driven kinds; `"sql"` is the `sql` escape hatch's
 * own kind (owner-settled, 2026-08-26): an honest "uncategorized tagged-
 * template statement" marker, not a misclassification — `` sql`select 1` ``
 * is `"sql"`, never guessed at as `"select"` by parsing its text.
 */
export type CompileKind =
	| "select"
	| "insert"
	| "update"
	| "delete"
	| "setOp"
	| "sql";

/**
 * Pure compile result: rendered SQL text plus its ordered bind parameters.
 * `params[i]` corresponds to the `i`-th `$`-placeholder in `sql`, in the
 * order each was encountered while rendering (no deduplication).
 */
export type CompileResult = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
	readonly kind: CompileKind;
};

const wrapperKeys = [
	"selectQuery",
	"insertQuery",
	"updateQuery",
	"deleteQuery",
] as const;

type WrapperKey = (typeof wrapperKeys)[number];

/**
 * Unwraps a builder stage's `*Query` field, or passes a bare `QueryNode`
 * through unchanged. The parameter type already excludes the `statementExpr`
 * branch (its caller, {@link compile}, checks for and returns on that shape
 * first) — forgetting that check is a `tsc` error at the call site below,
 * not a silent miscast here. Both casts are safe because, within that
 * narrowed type, `CompileInput` is exactly "one of the four `*Query`
 * wrappers, or a bare `QueryNode`": once none of `wrapperKeys` is present,
 * the only remaining possibility is `QueryNode` itself, and once one is
 * present, its value is that wrapper's `QueryNode` by the same union
 * (mirrors `mutate.ts`'s `asRecord`, same reasoning).
 */
const unwrapQueryNode = (
	statement: Exclude<CompileInput, { readonly statementExpr: ExprNode }>,
): QueryNode => {
	const wrapperKey = wrapperKeys.find((key) => key in statement);
	if (wrapperKey === undefined) {
		return statement as QueryNode;
	}
	return (statement as Record<WrapperKey, QueryNode>)[wrapperKey];
};

type RenderedQuery = Pick<CompileResult, "sql" | "params">;

const throwQueryError = (code: string, message: string): never => {
	const error = new Error(message);
	throw Object.assign(error, { code });
};

/**
 * Compiles a `sql` escape-hatch result used as a whole statement: its
 * literals lift to `$n` bind parameters exactly like any other expression
 * (the same `liftExprNode` a `where`/projection/`set` value goes through —
 * no separate path), then core's `renderExpr` renders the substituted
 * node. A statement that renders to no SQL text at all (e.g. a blank
 * `` sql`` `` used as a statement, not embedded as a fragment) throws
 * `empty-sql-statement` — a plain, enriched `Error` (D57 style: new
 * packages don't extend `HejbroError`), not silently compiled to nothing.
 */
const compileSqlStatement = (node: ExprNode): RenderedQuery => {
	const lifted = liftExprNode(node, 1);
	const renderedSql = renderExpr(lifted.node);
	if (renderedSql.trim().length === 0) {
		throwQueryError(
			"empty-sql-statement",
			"compile() received a blank sql`` statement. Next: give the template at least one character of SQL text.",
		);
	}
	return { sql: renderedSql, params: lifted.params };
};

/**
 * One handler per {@link QueryNode} `queryKind` — a mapped type over the
 * full union, same technique as core's `renderQueryHandlers`, so every
 * kind must be covered.
 */
const compileHandlers: {
	readonly [K in QueryNode["queryKind"]]: (
		node: Extract<QueryNode, { readonly queryKind: K }>,
	) => RenderedQuery;
} = {
	select: compileSelect,
	insert: compileInsert,
	update: compileUpdate,
	delete: compileDelete,
	setOp: compileSetOp,
};

/**
 * Compiles a built statement to SQL text plus an ordered parameter list —
 * no I/O, no connection; identical input compiles byte-identically every
 * time. Checks for the `sql` escape-hatch's `statementExpr` shape before
 * unwrapping a builder-stage `QueryNode`, so the two forms can never be
 * confused: {@link unwrapQueryNode}'s own parameter type structurally
 * excludes `statementExpr`, so skipping this check is a `tsc` error, not a
 * runtime one.
 */
export const compile = (statement: CompileInput): CompileResult => {
	if ("statementExpr" in statement) {
		const { sql, params } = compileSqlStatement(statement.statementExpr);
		return { sql, params, kind: "sql" };
	}
	const queryNode = unwrapQueryNode(statement);
	const handler = compileHandlers[queryNode.queryKind] as (
		node: QueryNode,
	) => RenderedQuery;
	const { sql, params } = handler(queryNode);
	return { sql, params, kind: queryNode.queryKind };
};
