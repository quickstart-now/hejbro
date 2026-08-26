import type {
	DeleteNode,
	InsertNode,
	QueryNode,
	SelectNode,
	UpdateNode,
} from "@hejbro/core";
import { compileDelete, compileInsert, compileUpdate } from "./mutation";
import { compileSelect } from "./select";

/**
 * `compile()`'s input: any stage of a `select`/`insert`/`update`/
 * `deleteFrom` builder chain from `@hejbro/core` — every stage exposes its
 * `*Query` field — or a bare `QueryNode` directly (owner-settled compiler
 * contract, 2026-08-26, see `openspec/changes/add-query-layer/design.md`).
 * The `sql` tagged-template statement form joins this union once task 2.6
 * settles its own shape.
 */
export type CompileInput =
	| { readonly selectQuery: SelectNode }
	| { readonly insertQuery: InsertNode }
	| { readonly updateQuery: UpdateNode }
	| { readonly deleteQuery: DeleteNode }
	| QueryNode;

/** Discriminates a {@link CompileResult} — mirrors `QueryNode["queryKind"]`. */
export type CompileKind = "select" | "insert" | "update" | "delete";

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
 * through unchanged. Both casts are safe because `CompileInput` is exactly
 * "one of the four `*Query` wrappers, or a bare `QueryNode`" — once none of
 * `wrapperKeys` is present, the only remaining possibility is `QueryNode`
 * itself, and once one is present, its value is that wrapper's `QueryNode`
 * by the same union (mirrors `mutate.ts`'s `asRecord`, same reasoning).
 */
const unwrapQueryNode = (statement: CompileInput): QueryNode => {
	const wrapperKey = wrapperKeys.find((key) => key in statement);
	if (wrapperKey === undefined) {
		return statement as QueryNode;
	}
	return (statement as Record<WrapperKey, QueryNode>)[wrapperKey];
};

type RenderedQuery = Pick<CompileResult, "sql" | "params">;

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
};

/**
 * Compiles a built statement to SQL text plus an ordered parameter list —
 * no I/O, no connection; identical input compiles byte-identically every
 * time.
 */
export const compile = (statement: CompileInput): CompileResult => {
	const queryNode = unwrapQueryNode(statement);
	const handler = compileHandlers[queryNode.queryKind] as (
		node: QueryNode,
	) => RenderedQuery;
	const { sql, params } = handler(queryNode);
	return { sql, params, kind: queryNode.queryKind };
};
