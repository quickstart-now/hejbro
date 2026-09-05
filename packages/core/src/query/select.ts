import type { Table } from "../dsl/table";
import { getTableMeta, isTable, toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	Condition,
	Expr,
	ExprNode,
	FromNode,
	JoinKind,
	OrderTermInput,
	ProjectionNode,
	SelectNode,
	SetOpNode,
	TableRefNode,
} from "../expr/ast";
import { expr, resolveOrderTerm } from "../expr/ast";
import type { ReadShape } from "../expr/read-shape";
import { BUILDER_READ_SHAPES } from "../expr/read-shape";
import { someExprNode } from "../expr/walk";
import { markConsumed, noteBuilder } from "../plpgsql/recording-session";
import type { TypeNode } from "../types/type-node";
import type { LeftJoinedBrand, UntrackedJoins } from "./left-joined";
import { assertSameSetOpKeyOrder } from "./set-op-key-order";
import type { CteReference } from "./with";
import { cteRowMeta, isCteReference } from "./with";

/**
 * A `select()` from-source: a declared table, or a `withCte()` reference
 * (add-ctes, task 3.3).
 *
 * Surface: `Table` alone stopped being what `from`/`fromTable` accept once
 * a CTE reference was; the plain union has no smaller composition (it is
 * exactly `SelectProjection`'s own two component types minus the object-
 * projection shape). Named `<Noun>Source` for what the field it types is
 * already called (`fromTable`, `from`), not a new coinage.
 */
export type FromSource = Table | CteReference;

/** A `select()` projection: the whole table (deterministic column list), or an object of aliased expressions. */
export type SelectProjection = Table | Record<string, Expr>;

/**
 * Re-exported for backward compatibility (and for `@hejbro/query`'s chain
 * set-op stage, which imports both from here) — the type and its resolver
 * now live in `expr/ast.ts` (group 3, D104): `expr/window.ts` needed the
 * exact same order-term shape for `over()`'s spec, and `expr/` cannot
 * depend on `query/` (the reverse holds throughout this package), so a
 * second real consumer promoted the shared shape up rather than adding a
 * second hand-kept duplicate.
 */
export type { OrderTermInput };
export { resolveOrderTerm };

/** A combined set-operation stage (add-set-operations, D103): carries the recursive node, whole-set `orderBy`/`limit`, and the same six combinators every select stage carries ({@link SetOpCombinators}) — so `(a union b) except c` chains naturally, and `c`'s own compatibility is checked exactly like `b`'s was (#487: this used to be a hand-duplicated, unchecked six rather than this intersection, which is how the chained position kept the gap after the first position was fixed). */
export type SetOpStage<
	TProjection extends SelectProjection = SelectProjection,
> = {
	readonly setOpQuery: SetOpNode;
	readonly projectionInput: TProjection;
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SetOpStage<TProjection>;
	limit(count: number): SetOpStage<TProjection>;
} & SetOpCombinators<TProjection>;

/** What a combinator accepts as its other side: any select stage, or a prior combination. */
export type SetOpBranch<
	TProjection extends SelectProjection = SelectProjection,
> = SelectLimited<TProjection> | SetOpStage<TProjection>;

/**
 * Poisons a set-op combinator's `other` parameter when its projection is
 * not union-compatible with the left side's (#487) — the same mechanism
 * `with.ts`'s `CompatibleRecursiveTerm` and `@hejbro/query`'s chain
 * `CompatibleBranch` already use (`SetOpResult` resolving `never` turns
 * the parameter itself into `never`, so the mismatch errors at the call
 * site instead of compiling into a statement the database would reject).
 * Only the compatibility check is consumed here, never the computed
 * result type: `TProjection` (the LEFT side) is still what every
 * combinator returns — a plain `union()` widens a mismatched column
 * type at the server, but which side's *keys* name the result is a
 * fixed SQL rule (the left branch's), not something a call should be
 * able to change by uttering `SetOpResult` in its own return position.
 */
type CompatibleSetOpBranch<TProjection, TOther> = [
	SetOpResult<TProjection, TOther>,
] extends [never]
	? never
	: unknown;

/** The six combinators every select stage carries (and every {@link SetOpStage} carries again) — each binds the OTHER branch's own projection (`TOther`) and gates it through {@link CompatibleSetOpBranch}, so a mismatched key set resolves the parameter to `never` and the call does not compile (#487). The runtime, the built node, and the rendered SQL are unchanged: this is a type-level narrowing only, and the result stays `SetOpStage<TProjection>` — the left branch's own projection, per SQL's own naming rule. */
export type SetOpCombinators<TProjection extends SelectProjection> = {
	union<TOther extends SelectProjection>(
		other: SetOpBranch<TOther> & CompatibleSetOpBranch<TProjection, TOther>,
	): SetOpStage<TProjection>;
	unionAll<TOther extends SelectProjection>(
		other: SetOpBranch<TOther> & CompatibleSetOpBranch<TProjection, TOther>,
	): SetOpStage<TProjection>;
	intersect<TOther extends SelectProjection>(
		other: SetOpBranch<TOther> & CompatibleSetOpBranch<TProjection, TOther>,
	): SetOpStage<TProjection>;
	intersectAll<TOther extends SelectProjection>(
		other: SetOpBranch<TOther> & CompatibleSetOpBranch<TProjection, TOther>,
	): SetOpStage<TProjection>;
	except<TOther extends SelectProjection>(
		other: SetOpBranch<TOther> & CompatibleSetOpBranch<TProjection, TOther>,
	): SetOpStage<TProjection>;
	exceptAll<TOther extends SelectProjection>(
		other: SetOpBranch<TOther> & CompatibleSetOpBranch<TProjection, TOther>,
	): SetOpStage<TProjection>;
};

/** `SameKeys<TLeft, TRight>` is `true` only when both sides carry exactly the same key set (neither a missing nor an extra one) — the shape half of the union-compatibility question, checked in both directions since `keyof` alone only proves a subset. */
type SameKeys<TLeft, TRight> = [keyof TLeft] extends [keyof TRight]
	? [keyof TRight] extends [keyof TLeft]
		? true
		: false
	: false;

/**
 * Set-operation result typing (moved from `@hejbro/query`, add-ctes task
 * 6.5): the database rejects branches whose rows are not union-compatible,
 * so the type layer rejects them FIRST — mismatched key sets resolve the
 * whole result to `never`. On a match the result takes the LEFT branch's
 * keys (SQL's own naming rule); each column is the union of the two
 * branches' declared types (identical declarations collapse by
 * idempotence), so a column typed differently by each branch is typed as
 * their union in the result — the same rule a recursive CTE's own anchor/
 * recursive-term pair needs (task 6.5: a window function or `distinct` in
 * the recursive term computes a field differently from the anchor without
 * disagreeing on which fields exist).
 *
 * Surface: originally `@hejbro/query`-only (add-set-operations, D103) —
 * moved here because its subject (whether two `SelectProjection` shapes
 * union-compatible) is core vocabulary, and a second, independently
 * maintained copy in `@hejbro/core` would answer the same question twice.
 * `@hejbro/query` re-exports this name unchanged, so its own chain typing
 * has no visible surface change. `@hejbro/core`'s own plain `union()`
 * family ({@link SetOpCombinators}) now gates its own `other` branch
 * through this same type too (#487, harden-query-surface) — a
 * mismatched union used to compile here and fail at the server instead;
 * it is refused at build time now, matching every other union surface.
 */
export type SetOpResult<TLeft, TRight> =
	SameKeys<TLeft, TRight> extends true
		? { readonly [K in keyof TLeft]: TLeft[K] | TRight[K & keyof TRight] }
		: never;

/**
 * Every select stage below takes `TLeftJoined` as its second parameter
 * (narrow-join-nullability) — defaulted to {@link UntrackedJoins} so every
 * existing one-argument use (`SelectLimited<Posts>`, a bare core type
 * import, …) keeps resolving the untracked, fail-safe widening unchanged.
 * Only {@link SelectLimited} carries {@link LeftJoinedBrand} in its own
 * shape; every other stage below inherits it through its own intersection
 * with `SelectLimited` (directly or transitively) — a type parameter only
 * the brand's owner needs to restate structurally, not nine copies of it.
 */
export type SelectLimited<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = {
	readonly selectQuery: SelectNode;
	readonly fromTable: FromSource;
	readonly projectionInput: TProjection;
} & SetOpCombinators<TProjection> &
	LeftJoinedBrand<TLeftJoined>;
export type SelectOffsetted<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectLimited<TProjection, TLeftJoined>;
export type SelectOrdered<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectLimited<TProjection, TLeftJoined> & {
	limit(count: number): SelectLimitedThenOffset<TProjection, TLeftJoined>;
	/** `offset` without a `limit` is legal SQL and useful on its own. */
	offset(count: number): SelectOffsetted<TProjection, TLeftJoined>;
};
export type SelectLimitedThenOffset<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectLimited<TProjection, TLeftJoined> & {
	offset(count: number): SelectOffsetted<TProjection, TLeftJoined>;
};
/** After `having`: `order by`/`limit`/`offset` still follow, `group by` and a second `having` do not. */
export type SelectHaving<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectOrdered<TProjection, TLeftJoined> & {
	orderBy(
		...terms: ReadonlyArray<OrderTermInput>
	): SelectOrdered<TProjection, TLeftJoined>;
};
export type SelectGrouped<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectHaving<TProjection, TLeftJoined> & {
	/** Filters GROUPS, after aggregation — `where` filters rows before it. */
	having(condition: Condition): SelectHaving<TProjection, TLeftJoined>;
};
export type SelectFiltered<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectOrdered<TProjection, TLeftJoined> & {
	orderBy(
		...terms: ReadonlyArray<OrderTermInput>
	): SelectOrdered<TProjection, TLeftJoined>;
	groupBy(
		...terms: ReadonlyArray<Expr>
	): SelectGrouped<TProjection, TLeftJoined>;
};
export type SelectJoinable<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectFiltered<TProjection, TLeftJoined> & {
	innerJoin<TJoined extends Table>(
		joined: TJoined,
		on: Condition,
	): SelectJoinable<TProjection, TLeftJoined>;
	/** Accumulates `TJoined` into the left-joined set (narrow-join-nullability) — `innerJoin` above takes the same generic but leaves `TLeftJoined` unchanged, since an inner join can never null a row. */
	leftJoin<TJoined extends Table>(
		joined: TJoined,
		on: Condition,
	): SelectJoinable<TProjection, TLeftJoined | TJoined>;
	where(condition: Condition): SelectFiltered<TProjection, TLeftJoined>;
};
/**
 * What `select()` itself returns: a joinable stage that can still take
 * `distinct`. SQL puts `distinct` between `select` and the projection, so
 * the chain does too — it is available first and exactly once, and every
 * later stage is a plain {@link SelectJoinable}.
 */
export type SelectDistinctable<
	TProjection extends SelectProjection = SelectProjection,
	TLeftJoined = UntrackedJoins,
> = SelectJoinable<TProjection, TLeftJoined> & {
	distinct(): SelectJoinable<TProjection, TLeftJoined>;
	distinctOn(
		...columns: ReadonlyArray<Expr>
	): SelectJoinable<TProjection, TLeftJoined>;
};

const tableRefOf = (target: Table): TableRefNode => {
	const meta = getTableMeta(target);
	return { schemaName: meta.schema.schemaName, tableName: meta.tableName };
};

/** A `from`-source's own `FromNode` (add-ctes, task 3.3) — a table renders qualified, a `withCte()` reference renders bare by its declared name (its own `cteRowMeta` brand, not a lookup). */
const fromNodeOf = (source: FromSource): FromNode => {
	if (isCteReference(source)) {
		return { cteName: source[cteRowMeta].cteName };
	}
	return tableRefOf(source);
};

const appendJoin = (
	query: SelectNode,
	joinKind: JoinKind,
	joined: Table,
	on: Condition,
): SelectNode => ({
	...query,
	joins: [
		...query.joins,
		{ joinKind, table: tableRefOf(joined), on: on.exprNode },
	],
});

const branchNode = (branch: SetOpBranch): SelectNode | SetOpNode => {
	if ("setOpQuery" in branch) {
		return branch.setOpQuery;
	}
	return branch.selectQuery;
};

const combineSetOp = <TProjection extends SelectProjection>(
	left: SelectNode | SetOpNode,
	operator: SetOpNode["operator"],
	all: boolean,
	other: SetOpBranch,
	projectionInput: TProjection,
): SetOpStage<TProjection> => {
	const right = branchNode(other);
	assertSameSetOpKeyOrder(left, right);
	const node: SetOpNode = {
		queryKind: "setOp",
		operator,
		all,
		left,
		right,
		orderBy: [],
		limit: null,
		offset: null,
	};
	noteBuilder(node, left);
	markConsumed(right);
	return makeSetOpStage(node, projectionInput);
};

/** The runtime combinator set over `left` — shared by every select stage and by {@link makeSetOpStage} itself (further chaining re-combines the whole node). */
const setOpCombinators = <TProjection extends SelectProjection>(
	left: () => SelectNode | SetOpNode,
	projectionInput: TProjection,
): SetOpCombinators<TProjection> => ({
	union: (other) =>
		combineSetOp(left(), "union", false, other, projectionInput),
	unionAll: (other) =>
		combineSetOp(left(), "union", true, other, projectionInput),
	intersect: (other) =>
		combineSetOp(left(), "intersect", false, other, projectionInput),
	intersectAll: (other) =>
		combineSetOp(left(), "intersect", true, other, projectionInput),
	except: (other) =>
		combineSetOp(left(), "except", false, other, projectionInput),
	exceptAll: (other) =>
		combineSetOp(left(), "except", true, other, projectionInput),
});

const makeSetOpStage = <TProjection extends SelectProjection>(
	node: SetOpNode,
	projectionInput: TProjection,
): SetOpStage<TProjection> => {
	// Same pairing as `makeStages`'s own `derive` (#423): `orderBy`/`limit`
	// each build the next `SetOpNode` via `{ ...node, … }` and recurse
	// through this same function, so the produced/superseded node must be
	// registered here too, not just at the combinator that first built `node`.
	const derive = (next: SetOpNode) => {
		noteBuilder(next, node);
		return makeSetOpStage(next, projectionInput);
	};
	noteBuilder(node, null);
	return {
		setOpQuery: node,
		projectionInput,
		...setOpCombinators(() => node, projectionInput),
		orderBy: (...terms) =>
			derive({
				...node,
				orderBy: [...node.orderBy, ...terms.map(resolveOrderTerm)],
			}),
		limit: (count) => derive({ ...node, limit: count }),
	};
};

/** `limit`/`offset` take the same non-negative integer and render inline, never as a bind parameter — one validator, so the two can never drift on what they accept. */
const assertRowCount = (count: number, clause: "limit" | "offset"): void => {
	if (!Number.isInteger(count) || count < 0) {
		throwHejbroError(
			`invalid-${clause}`,
			`${clause}(${count}) must be a non-negative integer. Next: pass a non-negative integer, e.g. ${clause}(10).`,
		);
	}
};

const isWindowNode = (node: ExprNode): boolean => node.nodeKind === "window";

/**
 * Rejects `where()`/`groupBy()`/`having()` arguments containing a window
 * function (D104) — Postgres evaluates window functions after all three
 * clauses run, so their result isn't available there yet (`42P20`). Uses
 * the SHALLOW `someExprNode` (the `exists`-rejection precedent,
 * `dsl/table.ts`'s `validateChecks`): a window function inside an
 * `exists()` subquery's own select list is a different, legal query, not
 * this one's clause. `distinctOn` deliberately has no such guard —
 * Postgres accepts a window function there (measured on postgres:17;
 * `distinct on` counts as part of the select list).
 */
const assertNoWindowFunction = (
	clause: "where" | "group by" | "having",
	exprs: ReadonlyArray<ExprNode>,
): void => {
	if (exprs.some((node) => someExprNode(node, isWindowNode))) {
		throwHejbroError(
			"window-function-not-allowed",
			`a ${clause} clause cannot reference a window function — Postgres evaluates window functions after ${clause} runs, so its result isn't available there yet. Next: move the window function into the select list instead, or filter on it from an outer query.`,
		);
	}
};

const makeStages = <
	TProjection extends SelectProjection,
	TLeftJoined = UntrackedJoins,
>(
	query: SelectNode,
	fromTable: FromSource,
	projectionInput: TProjection,
	// Every stage member exists on the one object `makeStages` builds; the
	// STAGE TYPES are what hide the ones SQL wouldn't allow next. The
	// intersection here is what lets `groupBy` return a grouped stage
	// without a second builder that would have to stay in sync.
): SelectJoinable<TProjection, TLeftJoined> &
	SelectGrouped<TProjection, TLeftJoined> => {
	// Every transition below builds its next `SelectNode` via `{ ...query,
	// … }` and recurses through this same `derive` — the one place that
	// pairs "this new node was produced" with "the node it was spread from
	// is superseded" (#423), so a transition added later inherits it
	// automatically instead of needing its own registration call.
	const derive = (next: SelectNode) => {
		noteBuilder(next, query);
		return makeStages<TProjection, TLeftJoined>(
			next,
			fromTable,
			projectionInput,
		);
	};
	return {
		selectQuery: query,
		fromTable,
		projectionInput,
		...setOpCombinators(() => query, projectionInput),
		innerJoin: <TJoined extends Table>(joined: TJoined, on: Condition) =>
			derive(appendJoin(query, "inner", joined, on)),
		// The runtime object built by `derive` never varies by `TJoined` --
		// only the DECLARED return type does (the accumulated union,
		// `TLeftJoined | TJoined`, frozen contract task 1.3). `derive`'s own
		// signature fixes it at `TLeftJoined` alone, so this is the one spot
		// that widens the declared type at the boundary (the `columnOriginBrand`/
		// `makeChainThen` cast-at-boundary precedent) rather than making every
		// stage builder generic over a union it never actually inspects.
		leftJoin: <TJoined extends Table>(joined: TJoined, on: Condition) =>
			derive(appendJoin(query, "left", joined, on)) as SelectJoinable<
				TProjection,
				TLeftJoined | TJoined
			> &
				SelectGrouped<TProjection, TLeftJoined | TJoined>,
		where: (condition) => {
			assertNoWindowFunction("where", [condition.exprNode]);
			return derive({ ...query, where: condition.exprNode });
		},
		orderBy: (...terms) =>
			derive({ ...query, orderBy: terms.map(resolveOrderTerm) }),
		groupBy: (...terms) => {
			if (terms.length === 0) {
				return throwHejbroError(
					"empty-group-by",
					"groupBy() needs at least one expression. Next: pass the columns the aggregate is grouped by, e.g. groupBy(posts.authorId).",
				);
			}
			assertNoWindowFunction(
				"group by",
				terms.map((term) => term.exprNode),
			);
			return derive({ ...query, groupBy: terms.map((term) => term.exprNode) });
		},
		having: (condition: Condition) => {
			assertNoWindowFunction("having", [condition.exprNode]);
			return derive({ ...query, having: condition.exprNode });
		},
		limit: (count) => {
			assertRowCount(count, "limit");
			return derive({ ...query, limit: count });
		},
		offset: (count) => {
			assertRowCount(count, "offset");
			return derive({ ...query, offset: count });
		},
	};
};

/**
 * What `select()` returns — {@link makeStages} plus the two `distinct`
 * members, which every later stage drops (SQL allows `distinct` only
 * between `select` and the projection, so the chain allows it exactly
 * once, first).
 */
const makeDistinctableStages = <
	TProjection extends SelectProjection,
	TLeftJoined = UntrackedJoins,
>(
	query: SelectNode,
	fromTable: FromSource,
	projectionInput: TProjection,
): SelectDistinctable<TProjection, TLeftJoined> => {
	// Same pairing as `makeStages`'s own `derive` (#423): `distinct`/
	// `distinctOn` are each a transition off `query`, not off whatever
	// `makeStages` builds from it, so this stage gets its own.
	const derive = (next: SelectNode) => {
		noteBuilder(next, query);
		return makeStages<TProjection, TLeftJoined>(
			next,
			fromTable,
			projectionInput,
		);
	};
	return {
		...makeStages<TProjection, TLeftJoined>(query, fromTable, projectionInput),
		distinct: () => derive({ ...query, distinct: { distinctKind: "all" } }),
		distinctOn: (...columns) => {
			if (columns.length === 0) {
				return throwHejbroError(
					"empty-distinct-on",
					"distinctOn() needs at least one column. Next: pass the columns one row per group is taken for, e.g. distinctOn(posts.authorId), and order by those columns first.",
				);
			}
			return derive({
				...query,
				distinct: {
					distinctKind: "on",
					columns: columns.map((column) => column.exprNode),
				},
			});
		},
	};
};

type ResolvedProjection = {
	readonly projectionNode: ProjectionNode;
	readonly fromTable: FromSource;
};

const resolveProjection = (
	projection: SelectProjection,
	from: FromSource | undefined,
): ResolvedProjection => {
	if (isTable(projection)) {
		const meta = getTableMeta(projection);
		return {
			projectionNode: {
				projectionKind: "allColumns",
				columnNames: meta.columns.map((column) => column.columnName),
			},
			fromTable: projection,
		};
	}
	if (from === undefined) {
		return throwHejbroError(
			"missing-from-table",
			"select() with an object projection can't infer the from table. Next: pass it as the second argument: select({ … }, posts).",
		);
	}
	return {
		projectionNode: {
			projectionKind: "columns",
			// `alias` is what rendering emits -- snake, a result-set label in
			// the SQL medium (and, through defineView, a view's column name).
			// `resultKey` keeps the caller's verbatim TS key so the query
			// layer can key converted rows by it (#339); it never reaches SQL
			// text or a stored snapshot (the expression codec drops it).
			columns: Object.entries(projection).map(([alias, value]) => ({
				alias: toSnakeCase(alias),
				resultKey: alias,
				expr: value.exprNode,
			})),
		},
		fromTable: from,
	};
};

/**
 * Starts a `select` query. `select(table)` projects every declared column
 * (an explicit list, not `*`, so `add column` stays deterministic);
 * `select({ alias: expr, … }, table)` projects an object of expressions —
 * `table` is required in that form since it can't be inferred. Starts at
 * `never` for {@link LeftJoinedBrand}'s own `TLeftJoined` (narrow-join-
 * nullability, task 1.2) — a fresh statement has left-joined nothing, and
 * `never | TJoined` is `TJoined`, so `leftJoin`'s own accumulation needs no
 * special first case.
 */
export const select = <TProjection extends SelectProjection>(
	projection: TProjection,
	from?: FromSource,
): SelectDistinctable<TProjection, never> => {
	const { projectionNode, fromTable } = resolveProjection(projection, from);
	const query: SelectNode = {
		queryKind: "select",
		projection: projectionNode,
		from: fromNodeOf(fromTable),
		joins: [],
		where: null,
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	};
	noteBuilder(query, null);
	return makeDistinctableStages<TProjection, never>(
		query,
		fromTable,
		projection,
	);
};

/**
 * Type names whose values do not survive a JSON round-trip untouched —
 * exactly the JSON-number precision problem: `bigint`/`numeric` collapse
 * to a lossy JSON number past 2^53, so they cast to text (D102,
 * cast+revive; F1 owner ruling at group 2 review). Nothing else is cast:
 * temporal values JSON-encode as ISO-8601 regardless of the session's
 * `DateStyle` (measured — a text cast would instead FOLLOW `DateStyle`
 * and lose that stability), `interval` is deterministic because the
 * driver pins `intervalstyle` at session setup, and `bytea` rides the
 * driver's `bytea_output` pin (a text cast obeys the same GUC, buying
 * nothing).
 */
const JSON_AT_RISK_TYPE_NAMES: ReadonlySet<string> = new Set([
	"bigint",
	"numeric",
]);

const jsonSafeCastSuffix = (typeNode: TypeNode): string | null => {
	if (typeNode.typeName === "array") {
		if (JSON_AT_RISK_TYPE_NAMES.has(typeNode.element.typeName)) {
			return "::text[]";
		}
		return null;
	}
	if (JSON_AT_RISK_TYPE_NAMES.has(typeNode.typeName)) {
		return "::text";
	}
	return null;
};

const castExprNode = (expr: ExprNode, suffix: string): ExprNode => ({
	nodeKind: "sqlTemplate",
	chunks: [
		{ chunkKind: "expr", expr },
		{ chunkKind: "text", text: suffix },
	],
});

/** The chain's original projection value for one rendered column, or `undefined` when the column carries no `resultKey` (a decoded node) or the input has no such key. */
const inputValueFor = (
	projectionInput: Record<string, unknown>,
	resultKey: string | undefined,
): unknown => {
	if (resultKey === undefined) {
		return undefined;
	}
	return projectionInput[resultKey];
};

const typeNodeOf = (inputValue: unknown): TypeNode | undefined =>
	(inputValue as { readonly typeNode?: TypeNode } | undefined)?.typeNode;

/**
 * The builder's own unqualified aggregate/window function name, or
 * `undefined` for anything else — a schema-qualified call is a declared
 * function (`db.fn`), which may legitimately be named `count`/`min`/`max`
 * in someone's own schema and must not be treated as the builder's own,
 * and a non-`functionCall` expr obviously isn't one either. A `window`
 * node (D104, `over(...)`) reads through to its own inner call first —
 * exactly how `@hejbro/query`'s `convert.ts` already reads it — so a
 * windowed cell is classified by the SAME name an unwindowed one would
 * be, never treated as unclassifiable (#452, the drift this table
 * closes: `over(count(), …)` used to cast nothing at all).
 */
const unwrapWindowNode = (node: ExprNode): ExprNode => {
	if (node.nodeKind === "window") {
		return node.fn;
	}
	return node;
};

const builderAggregateFunctionName = (node: ExprNode): string | undefined => {
	const target = unwrapWindowNode(node);
	if (target.nodeKind !== "functionCall") {
		return undefined;
	}
	if (target.schemaName !== null) {
		return undefined;
	}
	return target.functionName;
};

/**
 * `expr`'s {@link ReadShape} per {@link BUILDER_READ_SHAPES}, or
 * `undefined` when `expr` isn't one of the builder's own aggregate/window
 * calls at all (`convert.ts`'s own `aggregateColumnState` reads the same
 * table for the same lookup, #452 — the two sides cannot share a
 * function, but they share this data).
 */
const builderReadShapeOf = (expr: ExprNode): ReadShape | undefined => {
	const name = builderAggregateFunctionName(expr);
	if (name === undefined || !Object.hasOwn(BUILDER_READ_SHAPES, name)) {
		return undefined;
	}
	return BUILDER_READ_SHAPES[name as keyof typeof BUILDER_READ_SHAPES];
};

/**
 * The `::text`/`::text[]` suffix `expr` needs to survive JSON transport
 * losslessly, or `null` when it doesn't need one — a direct `columnRef`,
 * or a builder aggregate/window call whose {@link ReadShape} is `"int8"`
 * (cast unconditionally, whatever its argument) or `"argument"` (cast
 * exactly as a bare column ref of its own argument's type would be,
 * windowed or not). A `"own"` shape (`sum`/`avg` and the three
 * ranking-fraction/bucket functions) is never cast (#452, `own`'s own
 * doc comment on {@link ReadShape} for why).
 */
const atRiskCastSuffix = (
	expr: ExprNode,
	inputValue: unknown,
): string | null => {
	const shape = builderReadShapeOf(expr);
	if (shape === "int8") {
		return "::text";
	}
	if (expr.nodeKind !== "columnRef" && shape !== "argument") {
		return null;
	}
	const typeNode = typeNodeOf(inputValue);
	if (typeNode === undefined) {
		return null;
	}
	return jsonSafeCastSuffix(typeNode);
};

const castColumnIfAtRisk = (
	column: {
		readonly alias: string;
		readonly resultKey?: string;
		readonly expr: ExprNode;
	},
	inputValue: unknown,
): {
	readonly alias: string;
	readonly resultKey?: string;
	readonly expr: ExprNode;
} => {
	const suffix = atRiskCastSuffix(column.expr, inputValue);
	if (suffix === null) {
		return column;
	}
	return { ...column, expr: castExprNode(column.expr, suffix) };
};

/**
 * Bakes the D102 cast+revive casts into an embedded subselect's
 * projection AT BUILD TIME — the node itself carries the casts, so the
 * compiled SQL, the snapshot codec round-trip, and rename retargeting
 * all see the same statement (a render-time cast could not: the stored
 * node has no column types). A direct column ref and every builder
 * aggregate/window cell whose `BUILDER_READ_SHAPES` row is `"int8"` or
 * `"argument"` are cast (#452); any other computed expression's JSON
 * shape is its author's own contract. The types come from the chain's
 * own `projectionInput` (the built refs — and, since #444 F9, `min`/
 * `max`'s own result — carry their `typeNode`); a whole-`Table`
 * subselect expands into the equivalent aliased projection so its casts
 * apply too (F2).
 */
/** Expands a whole-`Table` subselect into an explicit aliased projection with the F1 casts applied — the builder knows every column's type here (the table meta), so the most common nested-read form must not be the one that silently loses precision (F2 owner ruling at group 2 review). */
const expandTableProjection = (
	query: SelectNode,
	projectionInput: Table,
): SelectNode => {
	const meta = getTableMeta(projectionInput);
	const columns = meta.columns.map((column) => {
		const ref: ExprNode = {
			nodeKind: "columnRef",
			schemaName: meta.schema.schemaName,
			tableName: meta.tableName,
			columnName: column.columnName,
		};
		const suffix = jsonSafeCastSuffix(column.columnState.typeNode);
		if (suffix === null) {
			return {
				alias: column.columnName,
				resultKey: column.columnKey,
				expr: ref,
			};
		}
		return {
			alias: column.columnName,
			resultKey: column.columnKey,
			expr: castExprNode(ref, suffix),
		};
	});
	return {
		...query,
		projection: { projectionKind: "columns", columns },
	};
};

const withJsonSafeCasts = (
	query: SelectNode,
	projectionInput: SelectProjection,
): SelectNode => {
	if (isTable(projectionInput)) {
		return expandTableProjection(query, projectionInput);
	}
	if (query.projection.projectionKind !== "columns") {
		return query;
	}
	const originalColumns = query.projection.columns;
	const columns = originalColumns.map((column) =>
		castColumnIfAtRisk(
			column,
			inputValueFor(projectionInput, column.resultKey),
		),
	);
	const anyCast = columns.some(
		(column, index) => column !== originalColumns[index],
	);
	if (!anyCast) {
		return query;
	}
	return { ...query, projection: { ...query.projection, columns } };
};

/**
 * Phantom marker `jsonArrayFrom`/`jsonObjectFrom` stamp on their returned
 * expression (add-relational-reads group 3) — carries the embedded
 * subselect's projection TYPE and mode so the query layer can compute the
 * nested row type. Optional and never assigned at runtime (the
 * `columnMetaBrand` precedent).
 */
export const nestedReadBrand: unique symbol = Symbol("hejbro:nested-read");

/** The marker's shape — see {@link nestedReadBrand}. */
export type NestedReadMarker<
	TMode extends "jsonArray" | "jsonObject",
	TProjection extends SelectProjection,
> = {
	readonly [nestedReadBrand]?: {
		readonly mode: TMode;
		readonly projection: TProjection;
	};
};

/**
 * `subselect: SelectLimited<TProjection>` deliberately takes the bare,
 * single-argument form (narrow-join-nullability, task 1.4) — `TLeftJoined`
 * defaults to {@link UntrackedJoins} (`unknown`), so a tracked subselect
 * passed here is still ACCEPTED (every tracked stage is assignable to the
 * type top) and its own set is ABSORBED into the untracked default, never
 * read. This is not a gap this file forgot to close: `jsonArrayFrom`/
 * `jsonObjectFrom` produce a NEW `Expr`, not a `SelectResult`, so there is
 * no field-per-column position on this expression's own type for a
 * narrower nullability to land on even if the set WERE read here — only
 * `@hejbro/query`'s later `SelectResult<TSub>` recursion (D102 cast+revive)
 * reads the embedded projection, at which point it is exactly as if the
 * nested `select()` had started fresh, and narrowing there would first
 * have to prove which of ITS OWN joins (not this one's outer statement)
 * were left ones. Reading the outer set here and narrowing on it anyway
 * would be a lie a nested subselect's own rows never earned. `withCte`'s
 * CTE body and `defineView`'s view body take the same bare form for the
 * identical reason: each also produces a new declared shape (a CTE row
 * environment, a view's own columns) from the inner select, not a
 * passthrough of the inner stage's own type.
 */
const buildSelectExpr =
	<TMode extends "jsonArray" | "jsonObject">(mode: TMode) =>
	<TProjection extends SelectProjection>(
		subselect: SelectLimited<TProjection>,
	): Expr<"json"> & NestedReadMarker<TMode, TProjection> => {
		markConsumed(subselect.selectQuery);
		return expr("json", {
			nodeKind: "selectExpr",
			mode,
			query: withJsonSafeCasts(
				subselect.selectQuery,
				subselect.projectionInput,
			),
		});
	};

/** Wraps a subselect into a projection expression compiling to a correlated `(select coalesce(json_agg("agg"), '[]'::json) from (…) as "agg")` — the nested-collection primitive (D102). The subselect's `where`/`orderBy`/`limit` and its own nested reads carry through; empty arrives as `[]`, never SQL null. */
export const jsonArrayFrom = buildSelectExpr("jsonArray");
/** Wraps a subselect into a correlated `(select row_to_json("agg") from (…) as "agg")` — the single-nested-row primitive (D102). No row arrives as SQL null; more than one row is Postgres's own loud error (add `limit 1` with an order for a deterministic pick). */
export const jsonObjectFrom = buildSelectExpr("jsonObject");

const buildExists =
	(negated: boolean) =>
	(query: SelectLimited): Expr<"boolean"> => {
		markConsumed(query.selectQuery);
		return expr("boolean", {
			nodeKind: "exists",
			negated,
			query: {
				...query.selectQuery,
				projection: { projectionKind: "constantOne" },
			},
		});
	};

/** `exists (select 1 from … where …)` — replaces the subquery's projection with the `select 1` idiom regardless of what it selected. */
export const exists = buildExists(false);
/** `not exists (select 1 from … where …)` — see {@link exists}. */
export const notExists = buildExists(true);
