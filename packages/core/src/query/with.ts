import type { Table } from "../dsl/table";
import { isTable, toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	ColumnRef,
	ColumnRefNode,
	Expr,
	WithEntryNode,
	WithNode,
} from "../expr/ast";
import type {
	SelectLimited,
	SelectProjection,
	SetOpResult,
	SetOpStage,
} from "./select";
import type { RecursiveCteEntryOptions } from "./with-recursive";
import { buildRecursiveEntryQuery } from "./with-recursive";

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
 *
 * Written as a key-remapped mapped type (`as`) rather than the built-in
 * `Omit` — behaviorally identical (both were verified, with a fresh build,
 * to preserve `ReadAs`/`OriginBrand` through this generic alias; an earlier
 * draft claimed `Omit` drops them and did not reproduce under review, see
 * D105's own log for the correction). This form is kept because it states
 * directly, at the definition, which three fields are gone and which
 * `TValue` is reduced to — `Omit<TValue, "exprNode" | "typeNode" |
 * "sqlName">` says the same thing one level of indirection away.
 *
 * Surface: no existing utility composes to "an `Expr` minus its
 * declaration-only fields" — this is its own type, not a one-off inline
 * expression at each call site. Named `<Noun>Ref`, the same suffix
 * `ColumnRef`/`TableRefNode` already use for "a reference to X".
 */
export type CteFieldRef<TValue extends Expr = Expr> = {
	readonly [P in keyof TValue as P extends "exprNode" | "typeNode" | "sqlName"
		? never
		: P]: TValue[P];
} & { readonly exprNode: ColumnRefNode };

/**
 * The named row environment `w.as(...)` hands back (add-ctes, task 3.1/3.2)
 * — one {@link CteFieldRef} per **projected** field, keyed by that field's
 * own key. A column the source table declares but the entry's projection
 * never mentions is not a key here at all — not merely inaccessible, absent.
 *
 * Both branches key off `TProjection[K]` — the entry's own projected value,
 * unmodified — rather than rebuilding a fresh `ColumnRef` from `TColumns`.
 * For the whole-table branch this is what carries `OriginBrand` through:
 * `TProjection[K]` for `TProjection extends Table<TColumns>` already is
 * `TableColumns<TColumns>[K]` (`ColumnRef<family> & OriginBrand<TColumns,
 * K>`), so `CteFieldRef` receives it already branded — no separate
 * reconstruction needed, and none was found necessary (verified against
 * `@hejbro/query`'s `SelectResult` with a fresh build; an earlier draft
 * claimed the indexed access drops the brand and did not reproduce under
 * review). `OriginBrand` is what lets `SelectResult` recover the declared
 * column's full read type for a whole-table CTE's field — the same
 * richness a passthrough column already gets in an ordinary object
 * projection (#311); pinned in `@hejbro/query`'s `select-result.test.ts`.
 *
 * Surface: no existing type maps a `SelectProjection` to "one reference per
 * projected key" — `TableColumns` is the closest sibling but is keyed by a
 * table's own declared columns, never a projection. `<Noun>Environment`
 * names what SQL itself calls this (the row environment a `WITH` entry
 * introduces for everything after it), not a spelling this file invented.
 */
export type CteRowEnvironment<TProjection extends SelectProjection> =
	TProjection extends Table<infer TColumns>
		? { readonly [K in keyof TColumns]: CteFieldRef<TProjection[K]> }
		: TProjection extends Record<string, Expr>
			? { readonly [K in keyof TProjection]: CteFieldRef<TProjection[K]> }
			: never;

/**
 * Identifies a {@link CteReference} at runtime and carries the CTE's own
 * name — the same hidden-symbol shape `dsl/table.ts`'s `tableMeta` uses for
 * a `Table`, for the same reason: `Object.entries`/`Object.fromEntries`
 * skip symbol keys, so it never leaks into the enumerable field ref map
 * {@link buildCteRowEnvironment} builds.
 *
 * Surface: `select()`'s own `from`-source dispatch needs a runtime-checkable
 * identity a structural row environment alone can't give it (two different
 * CTEs can project the exact same field shape). Mirrors `tableMeta` exactly
 * — same mechanism, same reason, `<noun>Meta` naming kept symmetric with it.
 */
export const cteRowMeta: unique symbol = Symbol("hejbro:cte-row-meta");

/** The brand's shape — see {@link cteRowMeta}. */
export type CteRowMeta = { readonly cteName: string };

/**
 * What `w.as(...)` actually hands back (add-ctes, task 3.3): the row
 * environment plus the hidden `cteRowMeta` brand `select()`'s own
 * `from`-source widening reads to build a `CteRefNode` instead of a
 * `TableRefNode`.
 *
 * Surface: distinct from {@link CteRowEnvironment} because that type alone
 * is structural (no way to dispatch on it at runtime); this is the nominal
 * type callers actually hold. Named to read next to `Table` at a `from`
 * call site (`Table | CteReference`), not after it alphabetically by
 * accident.
 */
export type CteReference<
	TProjection extends SelectProjection = SelectProjection,
> = CteRowEnvironment<TProjection> & { readonly [cteRowMeta]: CteRowMeta };

/**
 * Guards that `value` is a {@link CteReference} — the counterpart to
 * `dsl/table.ts`'s `isTable`.
 *
 * Surface: mirrors `isTable` exactly (same mechanism, same reason); a
 * user-facing `is<Noun>` predicate isn't expressible by composing existing
 * exports since the brand itself is not exported for direct `in` checks.
 */
export const isCteReference = (value: unknown): value is CteReference =>
	typeof value === "object" && value !== null && cteRowMeta in value;

/**
 * A `w.as(...)` entry's optional hints (add-ctes, task 3.4).
 *
 * Surface: a third, all-optional parameter needs its own named type once it
 * carries more than a single positional value (`TableExtras` is the same
 * pattern for `table()`'s own callback options) — a bag of one field today,
 * room for a second (e.g. a future recursive-entry hint) without breaking
 * `.as()`'s call shape.
 */
export type CteEntryOptions = {
	/** Tri-state, matching {@link WithEntryNode.materialized}: `true`/`false` render their own keyword, omitted (`undefined`) renders neither and leaves the choice to the planner. */
	readonly materialized?: boolean;
};

/**
 * Poisons `asRecursive`'s `recursiveTerm` parameter when its own projection
 * is not union-compatible with the anchor's (add-ctes, task 6.5) — the same
 * mechanism `@hejbro/query`'s chain `union()` already uses (`SetOpResult`
 * resolving `never`), reused rather than re-invented, since a `WITH
 * RECURSIVE` entry's anchor/recursive-term pair is grammatically
 * `anchor UNION [ALL] recursive-term` (Postgres): "is the recursive term
 * union-compatible with the anchor" is the exact question `SetOpResult`
 * already answers. A missing/extra key still resolves to `never` (task 6.2's
 * own pin, kept); a key present on both sides but computed differently
 * (e.g. a window function or `distinct` in the recursive term) now
 * type-checks.
 *
 * Only the *compatibility check* is shared with a plain union — the
 * *result type* is not: `SetOpResult`'s own union-of-both-branches typing
 * is used here purely to decide `never`-or-not, and is discarded rather
 * than propagated into `asRecursive`'s own return type ({@link CteReference}
 * `<TProjection>`, the anchor's type — see `asRecursive`'s own docstring).
 * That split matches Postgres: an ordinary `union` widens a mismatched
 * column type (`int` and `bigint` resolve to `bigint`), but a recursive
 * CTE refuses to (measured, `42804`, "column N has type integer in
 * non-recursive term but type bigint overall") — its row type is always
 * the anchor's, not a union. The gap this leaves — a recursive term whose
 * column types resolve differently from the anchor's type-checks here and
 * fails on the server instead — is tracked separately, #489.
 */
type CompatibleRecursiveTerm<TProjection, TRecursiveProjection> = [
	SetOpResult<TProjection, TRecursiveProjection>,
] extends [never]
	? never
	: unknown;

/**
 * Passed into a `withCte(...)` callback (add-ctes, task 3.1) — the only way
 * to declare an entry.
 *
 * Surface: `withCte`'s own parameter needs a named type for its callback
 * argument; no existing builder type shape fits (it is not a query stage
 * itself, just the accumulator). `<Noun>Builder` matches `IndexBuilder`'s
 * own naming for the same role elsewhere in this package.
 */
export type CteBuilder = {
	readonly as: <TProjection extends SelectProjection>(
		name: string,
		query: SelectLimited<TProjection> | SetOpStage<TProjection>,
		options?: CteEntryOptions,
	) => CteReference<TProjection>;
	/**
	 * Declares a recursive entry (add-ctes, task 6.1): `anchor` fixes the
	 * CTE's own row type (`CteReference<TProjection>` — Postgres takes a
	 * recursive CTE's column names/types from its anchor, never the
	 * recursive term), and `recursiveTerm` is written inside a callback
	 * receiving a reference typed from it. `recursiveTerm`'s own projection
	 * must be union-compatible with the anchor's (task 6.5, via
	 * {@link CompatibleRecursiveTerm}): missing or extra keys don't
	 * type-check (task 6.2), but a key both sides carry may be computed
	 * differently on each side (window function, `distinct`, ...) — the
	 * grammar is literally `anchor UNION [ALL] recursive-term`, so this is
	 * the same compatibility rule any other `union()` already applies, not
	 * a new one. Every entry in the list becomes visible to render-sql.ts's
	 * own scope check once even one `asRecursive` call happens (task
	 * 6.1/6.4: `recursive` is the whole list's flag, not this one entry's).
	 *
	 * Surface: `w.as` cannot express "a reference to the entry currently
	 * being declared" — the anchor/recursive-term split, and the row type
	 * flowing from one to the other, is a genuinely different shape, not a
	 * variant reachable by composing `w.as` with something else.
	 * `as<Verb>` mirrors `w.as`'s own name, the same relationship
	 * `insert()`/`insert().values()` already has between a base call and
	 * its own qualified sibling.
	 */
	readonly asRecursive: <
		TProjection extends SelectProjection,
		TRecursiveProjection extends SelectProjection = TProjection,
	>(
		name: string,
		anchor: SelectLimited<TProjection> | SetOpStage<TProjection>,
		recursiveTerm: ((
			self: CteReference<TProjection>,
		) =>
			| SelectLimited<TRecursiveProjection>
			| SetOpStage<TRecursiveProjection>) &
			CompatibleRecursiveTerm<TProjection, TRecursiveProjection>,
		options?: RecursiveCteEntryOptions,
	) => CteReference<TProjection>;
};

/**
 * What `withCte(...)` returns — the `withQuery` field mirrors every other
 * builder stage's own `*Query` wrapper key (`selectQuery`, `setOpQuery`,
 * ...), the convention `@hejbro/query`'s `compile()` dispatches on (task
 * 5.1).
 *
 * Surface: `withCte`'s return type can't reuse `SelectLimited`/`SetOpStage`
 * — a `WITH` statement is a different `QueryNode` kind with no further
 * chain methods of its own (they live on the body, already built before
 * `withCte` wraps it). `<Noun>Stage` keeps the same suffix `SetOpStage`
 * already uses for "a builder stage holding a `QueryNode`".
 */
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
 * Rejects a second `w.as(name, ...)` for a name already declared (add-ctes,
 * task 3.6) — Postgres refuses this outright (`42712`), and unlike a plain
 * syntax error, the failure mode without this guard is worse than a build
 * error: `with "dup" as (...), "dup" as (...)` would render, and the
 * *second* declaration silently shadows the first, so the query a caller
 * reads is not the one Postgres runs.
 */
const assertNoDuplicateCteName = (
	entries: ReadonlyArray<WithEntryNode>,
	name: string,
): void => {
	if (entries.some((entry) => entry.name === name)) {
		throwHejbroError(
			"duplicate-cte-name",
			`withCte() declares two entries named "${name}" — Postgres refuses this (42712), and the second declaration would otherwise silently shadow the first inside the rendered statement. Next: give each entry its own name.`,
		);
	}
};

/**
 * Rejects a `withCte()` call whose callback never declares an entry
 * (add-ctes, task 3.6) — `with  select ...` (an empty entry list) is not
 * valid SQL; Postgres's own grammar requires at least one `<name> AS
 * (<query>)` after `WITH`. `42601` (syntax_error) is measured against
 * postgres:17 (task 7.1), the same rendered text this guard refuses.
 */
const assertNonEmptyCteList = (entries: ReadonlyArray<WithEntryNode>): void => {
	if (entries.length === 0) {
		throwHejbroError(
			"empty-with-list",
			'withCte() declared no entries at all -- "with  select ..." is not valid SQL (Postgres refuses this, 42601). Next: call w.as(...) at least once before returning the body.',
		);
	}
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
 *
 * Surface: no existing export starts a `WITH` statement — `select()`/
 * `insert()`/`update()`/`deleteFrom()` each start a different `QueryNode`
 * kind, and none composes into one that declares named entries ahead of a
 * body. `with` is the SQL keyword but a reserved JS word (`TS1389`/
 * `TS1003`, task 3.1); `withCte` is the same escape `deleteFrom` already
 * uses for `delete`, keeping the name recognizably "the `WITH` one" rather
 * than an unrelated synonym like `cte`.
 */
export const withCte = <TProjection extends SelectProjection>(
	build: (w: CteBuilder) => WithBody<TProjection>,
): WithStage<TProjection> => {
	const entries: WithEntryNode[] = [];
	// One `asRecursive` call makes the whole list recursive (task 6.4,
	// Postgres's own list-level flag) -- a length check reads that fact
	// without a second boolean local, the same push-only-const shape as
	// `entries` itself.
	const recursiveCalls: true[] = [];
	const w: CteBuilder = {
		as: (name, query, options) => {
			assertNoDuplicateCteName(entries, name);
			entries.push({
				name,
				query: bodyQueryNode(query),
				materialized: options?.materialized ?? null,
			});
			return buildCteRowEnvironment(name, query.projectionInput);
		},
		asRecursive: (name, anchor, recursiveTerm, options) => {
			assertNoDuplicateCteName(entries, name);
			const anchorRef = buildCteRowEnvironment(name, anchor.projectionInput);
			const term = recursiveTerm(anchorRef);
			recursiveCalls.push(true);
			entries.push({
				name,
				query: buildRecursiveEntryQuery(
					bodyQueryNode(anchor),
					bodyQueryNode(term),
					options?.all ?? true,
				),
				materialized: options?.materialized ?? null,
			});
			return anchorRef;
		},
	};
	const body = build(w);
	assertNonEmptyCteList(entries);
	return {
		withQuery: {
			queryKind: "with",
			ctes: entries,
			recursive: recursiveCalls.length > 0,
			body: bodyQueryNode(body),
		},
		projectionInput: body.projectionInput,
	};
};
