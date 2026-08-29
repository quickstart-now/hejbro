import type { Table } from "../dsl/table";
import { isTable, toSnakeCase } from "../dsl/table";
import type {
	ColumnRef,
	ColumnRefNode,
	Expr,
	WithEntryNode,
	WithNode,
} from "../expr/ast";
import type { BuilderFamily } from "../types/column-builder";
import type { SelectLimited, SelectProjection, SetOpStage } from "./select";

/**
 * One projected field's reference from inside a `withCte()` body (add-ctes,
 * task 3.2 — settled, lead 2026-08-29): `exprNode` always points back at the
 * CTE by name, never the original expression. `typeNode`/`sqlName` are
 * dropped too, not just `exprNode` replaced — a projected field can be a
 * declared column passed straight through (`select({ id: t.id }, t)`, or a
 * whole-table `select(t)`), which would otherwise still carry a real
 * `TypeNode` and satisfy `ColumnRef` structurally. Every other brand a
 * projected value carried (`ReadAs`, the column-origin brand) survives for
 * free through the plain object spread below — nothing here recomputes
 * them.
 */
export type CteFieldRef<TValue extends Expr = Expr> = Omit<
	TValue,
	"exprNode" | "typeNode" | "sqlName"
> & { readonly exprNode: ColumnRefNode };

/**
 * The named row environment `w.as(...)` hands back (add-ctes, task 3.1/3.2)
 * — one {@link CteFieldRef} per **projected** field, keyed by that field's
 * own key. A column the source table declares but the entry's projection
 * never mentions is not a key here at all — not merely inaccessible, absent.
 */
export type CteRowEnvironment<TProjection extends SelectProjection> =
	TProjection extends Table<infer TColumns>
		? {
				readonly [K in keyof TColumns]: CteFieldRef<
					ColumnRef<BuilderFamily<TColumns[K]>>
				>;
			}
		: TProjection extends Record<string, Expr>
			? { readonly [K in keyof TProjection]: CteFieldRef<TProjection[K]> }
			: never;

/**
 * Identifies a {@link CteReference} at runtime and carries the CTE's own
 * name — the same hidden-symbol shape `dsl/table.ts`'s `tableMeta` uses for
 * a `Table`, for the same reason: `Object.entries`/`Object.fromEntries`
 * skip symbol keys, so it never leaks into the enumerable field ref map
 * {@link buildCteRowEnvironment} builds.
 */
export const cteRowMeta: unique symbol = Symbol("hejbro:cte-row-meta");

/** The brand's shape — see {@link cteRowMeta}. */
export type CteRowMeta = { readonly cteName: string };

/**
 * What `w.as(...)` actually hands back (add-ctes, task 3.3): the row
 * environment plus the hidden `cteRowMeta` brand `select()`'s own
 * `from`-source widening reads to build a `CteRefNode` instead of a
 * `TableRefNode`.
 */
export type CteReference<
	TProjection extends SelectProjection = SelectProjection,
> = CteRowEnvironment<TProjection> & { readonly [cteRowMeta]: CteRowMeta };

/** Guards that `value` is a {@link CteReference} — the counterpart to `dsl/table.ts`'s `isTable`. */
export const isCteReference = (value: unknown): value is CteReference =>
	typeof value === "object" && value !== null && cteRowMeta in value;

/** A `w.as(...)` entry's optional hints (add-ctes, task 3.4). */
export type CteEntryOptions = {
	/** Tri-state, matching {@link WithEntryNode.materialized}: `true`/`false` render their own keyword, omitted (`undefined`) renders neither and leaves the choice to the planner. */
	readonly materialized?: boolean;
};

/** Passed into a `withCte(...)` callback (add-ctes, task 3.1) — the only way to declare an entry. */
export type CteBuilder = {
	readonly as: <TProjection extends SelectProjection>(
		name: string,
		query: SelectLimited<TProjection> | SetOpStage<TProjection>,
		options?: CteEntryOptions,
	) => CteReference<TProjection>;
};

/** What `withCte(...)` returns — the `withQuery` field mirrors every other builder stage's own `*Query` wrapper key (`selectQuery`, `setOpQuery`, ...), the convention `@hejbro/query`'s `compile()` dispatches on (task 5.1). */
export type WithStage<TProjection extends SelectProjection = SelectProjection> =
	{
		readonly withQuery: WithNode;
		readonly projectionInput: TProjection;
	};

type WithBody<TProjection extends SelectProjection> =
	| SelectLimited<TProjection>
	| SetOpStage<TProjection>;

const bodyQueryNode = (
	stage: WithBody<SelectProjection>,
): WithEntryNode["query"] => {
	if ("selectQuery" in stage) {
		return stage.selectQuery;
	}
	return stage.setOpQuery;
};

/** A projected field's own output column name — a whole-table entry keeps its source column's declared name; an object projection snake-cases the caller's TS key, matching `resolveProjection`'s own `alias` in `select.ts`. */
const cteFieldColumnName = (
	source: SelectProjection,
	key: string,
	value: Expr,
): string => {
	if (isTable(source)) {
		return (value as ColumnRef).sqlName;
	}
	return toSnakeCase(key);
};

/**
 * Builds the {@link CteRowEnvironment} `w.as(...)` hands back. `typeNode`/
 * `sqlName` are dropped from the runtime object, not merely typed away —
 * {@link CteFieldRef}'s own doc explains why a type-level omission alone
 * isn't enough (a duck-typed reader like `dsl/index-builder.ts`'s
 * `isColumnRef` would still find them on the underlying object).
 */
const buildCteRowEnvironment = <TProjection extends SelectProjection>(
	cteName: string,
	source: TProjection,
): CteReference<TProjection> => {
	const fields = Object.entries(source as Record<string, Expr>).map(
		([key, value]) => {
			const {
				typeNode: _typeNode,
				sqlName: _sqlName,
				...rest
			} = value as Expr & {
				readonly typeNode?: unknown;
				readonly sqlName?: unknown;
			};
			return [
				key,
				{
					...rest,
					exprNode: {
						nodeKind: "columnRef" as const,
						schemaName: null,
						tableName: cteName,
						columnName: cteFieldColumnName(source, key, value),
					},
				},
			] as const;
		},
	);
	return {
		...Object.fromEntries(fields),
		[cteRowMeta]: { cteName },
	} as unknown as CteReference<TProjection>;
};

/**
 * Starts a `WITH` statement (add-ctes, task 3.1). `build` receives a
 * {@link CteBuilder} whose `as(name, query)` both records the entry and
 * hands back the row environment to reference it by — declared entirely
 * as ordinary locals, so a later `w.as(...)` can only reference an entry
 * declared before it (Postgres's earlier-siblings rule, held by
 * construction, not by a runtime check: there is no way to spell a forward
 * reference). `entries` accumulates via `.push()` into a local `const`,
 * scoped to this one call and never observed outside it — the same shape
 * `plpgsql/body-context.ts` already uses for its own statement recording.
 */
export const withCte = <TProjection extends SelectProjection>(
	build: (w: CteBuilder) => WithBody<TProjection>,
): WithStage<TProjection> => {
	const entries: WithEntryNode[] = [];
	const w: CteBuilder = {
		as: (name, query, options) => {
			entries.push({
				name,
				query: bodyQueryNode(query),
				materialized: options?.materialized ?? null,
			});
			return buildCteRowEnvironment(name, query.projectionInput);
		},
	};
	const body = build(w);
	return {
		withQuery: {
			queryKind: "with",
			ctes: entries,
			recursive: false,
			body: bodyQueryNode(body),
		},
		projectionInput: body.projectionInput,
	};
};
