import { arrayWithIdentityPreserved } from "../array-identity";
import type { ViewDeclaration } from "../dsl/define-view";
import { assertNever, throwHejbroError } from "../error";
import type {
	ProjectionNode,
	SelectNode,
	SetOpNode,
	WithEntryNode,
	WithNode,
} from "../expr/ast";
import {
	decodeQueryNode,
	decodeWithNode,
	encodeQueryNode,
	encodeWithNode,
} from "../expr/codec";
import { renderQuery } from "../expr/render-sql";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import {
	dispatchEmit,
	requireNext,
	requirePrevious,
} from "../kind/emit-helpers";
import type { KindChange, ObjectKind } from "../kind/object-kind";
import type { ColumnOrderOracle } from "../snapshot/column-order";
import {
	applyColumnOrderToSelect,
	noColumnOrder,
} from "../snapshot/column-order";
import type { JsonValue } from "../snapshot/stable-json";
import { qualifyName } from "../sql/identifier";
import type { SqlStatement } from "../sql/statement";
import { predropStatement, statement } from "../sql/statement";

/**
 * A view's serialized snapshot node — `columns` drives the
 * recreate-vs-replace decision (D27). **Compact** (Task 3 audit / D33):
 * `securityInvoker` is present only when `true` (declared default
 * `false`) — read via {@link viewSecurityInvoker}.
 *
 * `query` is a **structured expression-codec `SelectNode`** (D67/D70/D72),
 * not pre-rendered SQL text (that was D24/D27's original shape, matching
 * `ColumnSnapshot.default`'s own pre-D67 shape) — encoded/decoded with
 * #110's own `encodeSelectNode`/`decodeSelectNode`, reused unchanged since
 * neither assumes it's only ever called from inside an `ExistsNode`.
 * {@link viewSelectSql} decodes and renders it back to SQL text on demand,
 * so every caller of that accessor is unaffected by this shape change.
 * This is **not a defect fix** — `create or replace view` already
 * resolves a renamed dependency correctly today — see D72's rationale.
 */
export type ViewSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly query: JsonValue;
	readonly securityInvoker?: true;
};

/**
 * Encodes a view's own query, `WithNode` included (add-ctes, task 4.1) —
 * `encodeQueryNode` stays `SelectNode | SetOpNode` (D94: a stored view body
 * is a snapshot-reachable caller that needs the wider set; `encodeWithNode`'s
 * own docstring names this exact wiring call). Exported (not merged into
 * the shared dispatcher, which stays narrow: a `WithEntryNode.query`/
 * `SetOpNode.left`/`right` can never themselves be a `WithNode`, so widening
 * `encodeQueryNode` there would let a value that must never exist
 * type-check) so the rename engine's own view path (task 4.3,
 * `engine/rename/retarget.ts`) can reuse the same dispatch rather than
 * duplicating it.
 */
export const encodeViewQueryNode = (
	query: SelectNode | SetOpNode | WithNode,
): JsonValue => {
	if (query.queryKind === "with") {
		return encodeWithNode(query);
	}
	return encodeQueryNode(query);
};

/** The decoding counterpart to {@link encodeViewQueryNode}. */
export const decodeViewQueryNode = (
	value: JsonValue,
): SelectNode | SetOpNode | WithNode => {
	const record = value as { readonly queryKind?: string };
	if (record.queryKind === "with") {
		return decodeWithNode(value);
	}
	return decodeQueryNode(value);
};

/** `snapshot.query` decoded and rendered back to SQL text. */
export const viewSelectSql = (snapshot: ViewSnapshot): string =>
	renderQuery(decodeViewQueryNode(snapshot.query));

/** `snapshot.securityInvoker`, defaulting to `false` when absent (compact snapshot). */
export const viewSecurityInvoker = (snapshot: ViewSnapshot): boolean =>
	snapshot.securityInvoker === true;

/** `{ securityInvoker: true }` when set, else `{}` (compact snapshot). */
const securityInvokerField = (
	value: boolean,
): Pick<ViewSnapshot, "securityInvoker"> => {
	if (!value) {
		return {};
	}
	return { securityInvoker: true };
};

// Internal invariant: this shape is exactly what viewKind.serialize below produces.
const asViewSnapshot = (snapshot: JsonValue): ViewSnapshot =>
	snapshot as ViewSnapshot;

const viewIdentity = (schema: string, name: string): string =>
	`${schema}.${name}`;

const VIEW_CHANGED_NOTE = "view changed";
const VIEW_RECREATE_NOTE = "view columns changed; recreating";

/**
 * Derives a view's ordered column-name list from its query's projection
 * (`constantOne` is unreachable via `select()`, hence `defineView`).
 * Exported so `rename-plan.ts`'s `retargetViewFields` can recompute
 * `ViewSnapshot.columns` from a retargeted query, the same way `serialize`
 * derives it the first time — a column rename changes `allColumns`'s
 * `columnNames` (via `retargetProjection`), and `columns` must follow it,
 * or the D27 prefix-rule diff compares a stale name against the new one.
 */
/**
 * The leftmost select of a view query — a set-operation's output columns
 * are its LEFT branch's, SQL's own naming rule (D103). A `WithNode`
 * defers to its own `body` (add-ctes, task 4.1) — a `WITH` statement's
 * output columns are the body's, never an entry's, the same one-vocabulary
 * rule D103 already established for a set operation's left branch.
 */
const leftmostSelect = (
	query: SelectNode | SetOpNode | WithNode,
): SelectNode => {
	if (query.queryKind === "with") {
		return leftmostSelect(query.body);
	}
	if (query.queryKind === "setOp") {
		return leftmostSelect(query.left);
	}
	return query;
};

/** A view query's declared column list — a plain select's projection, the left branch's through a set operation, or the body's through a `WITH` statement. */
export const viewQueryColumns = (
	query: SelectNode | SetOpNode | WithNode,
): ReadonlyArray<string> => projectionColumns(leftmostSelect(query).projection);

/** One `WITH` entry's own query reordered against its own `from` -- an entry's body is an ordinary select over a real table (or another entry), with exactly the physical order any other select has (add-ctes, task 4.2b). */
const applyColumnOrderToViewWithEntry = (
	entry: WithEntryNode,
	columnOrder: ColumnOrderOracle,
): WithEntryNode => {
	const query = applyColumnOrderToViewQuery(entry.query, columnOrder);
	if (query === entry.query) {
		return entry;
	}
	return { ...entry, query: query as typeof entry.query };
};

/**
 * A `WITH` statement's own physical order reaches both its body and every
 * entry's own query (add-ctes, task 4.2b) -- only a CTE *reference* has
 * no physical order (handled by `column-order.ts`'s own `orderedProjection`
 * `cteName` branch); an entry's *body* is a plain select over real tables
 * and reorders exactly like any other one, the same way `retargetWithNode`
 * already recurses into `ctes` for a rename. Split out (D71/#154
 * ratchet-5) to keep `applyColumnOrderToViewQuery`'s own complexity from
 * accumulating a third branch's worth.
 */
const applyColumnOrderToViewWith = (
	query: WithNode,
	columnOrder: ColumnOrderOracle,
): WithNode => {
	const ctes = arrayWithIdentityPreserved(
		query.ctes.map((entry) =>
			applyColumnOrderToViewWithEntry(entry, columnOrder),
		),
		query.ctes,
	);
	const body = applyColumnOrderToViewQuery(query.body, columnOrder);
	if (ctes === query.ctes && body === query.body) {
		return query;
	}
	return { ...query, ctes, body: body as typeof query.body };
};

/** D81 over a set operation: each leaf select reorders against its own `from`. Split out (D71/#154 ratchet-5), same reasoning as {@link applyColumnOrderToViewWith}. */
const applyColumnOrderToViewSetOp = (
	query: SetOpNode,
	columnOrder: ColumnOrderOracle,
): SetOpNode => {
	const left = applyColumnOrderToViewQuery(query.left, columnOrder);
	const right = applyColumnOrderToViewQuery(query.right, columnOrder);
	if (left === query.left && right === query.right) {
		return query;
	}
	return {
		...query,
		left: left as typeof query.left,
		right: right as typeof query.right,
	};
};

/** D81 column order over a view query — each set-op leaf reorders against its own `from` (the same rule `applyColumnOrderToQuery` applies). */
const applyColumnOrderToViewQuery = (
	query: SelectNode | SetOpNode | WithNode,
	columnOrder: ColumnOrderOracle,
): SelectNode | SetOpNode | WithNode => {
	if (query.queryKind === "with") {
		return applyColumnOrderToViewWith(query, columnOrder);
	}
	if (query.queryKind === "setOp") {
		return applyColumnOrderToViewSetOp(query, columnOrder);
	}
	return applyColumnOrderToSelect(query, columnOrder);
};

export const projectionColumns = (
	projection: ProjectionNode,
): ReadonlyArray<string> => {
	switch (projection.projectionKind) {
		case "allColumns":
			return projection.columnNames;
		case "columns":
			return projection.columns.map((column) => column.alias);
		case "constantOne":
			return throwHejbroError(
				"invalid-view-projection",
				"a view's query resolved to a constantOne projection — this is only produced by exists()/notExists(), which defineView() never accepts.",
			);
		default:
			return assertNever(projection);
	}
};

const isPrefixOf = (
	previousColumns: ReadonlyArray<string>,
	nextColumns: ReadonlyArray<string>,
): boolean =>
	previousColumns.every((name, index) => nextColumns[index] === name);

const dropViewSql = (snapshot: ViewSnapshot): string =>
	`drop view if exists ${qualifyName(snapshot.schema, snapshot.name)};`;

const securityInvokerClause = (securityInvoker: boolean): string => {
	if (securityInvoker) {
		return " with (security_invoker = true)";
	}
	return "";
};

const createOrReplaceSql = (snapshot: ViewSnapshot): string =>
	`create or replace view ${qualifyName(snapshot.schema, snapshot.name)}${securityInvokerClause(viewSecurityInvoker(snapshot))} as ${viewSelectSql(snapshot)};`;

const emitCreate = (change: KindChange): ReadonlyArray<SqlStatement> => [
	statement(createOrReplaceSql(asViewSnapshot(requireNext(change)))),
];

const emitAlter = (change: KindChange): ReadonlyArray<SqlStatement> => {
	// #472 trap 2: next is checked before previous here — the reverse of
	// grant-kind.ts's alter — and that order is the observable both-null
	// message, not a stylistic choice to harmonize.
	const nextSnapshot = asViewSnapshot(requireNext(change));
	const previousSnapshot = asViewSnapshot(requirePrevious(change));
	if (isPrefixOf(previousSnapshot.columns, nextSnapshot.columns)) {
		return [statement(createOrReplaceSql(nextSnapshot))];
	}
	return [
		predropStatement(dropViewSql(nextSnapshot)),
		statement(createOrReplaceSql(nextSnapshot)),
	];
};

const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => [
	predropStatement(dropViewSql(asViewSnapshot(requirePrevious(change)))),
];

/**
 * The built-in object kind for Postgres views. Identity is
 * `"<schema>.<name>"`. `diff` applies the prefix rule (D27): when the
 * previous column list is a prefix of the next, Postgres can extend the
 * view with `create or replace view`; any other column-list change (a
 * removal, reorder, or rename) can't, so it recreates via a single
 * `alter` change whose `emit` returns `drop view if exists` followed by
 * `create or replace view`, in that order (D23/#55 — never a separate
 * drop + create pair). The `drop view if exists` half (recreate, and a true
 * drop) goes out on the `predrop` stage — a view can depend on a table
 * column that a `main`-stage alter on that same table is about to drop
 * (#122), so the view must be gone before that alter runs. `emit`
 * recomputes the prefix rule itself from
 * `previous`/`next`'s `columns` — notes are display-only banner text
 * (spec's `ObjectKind` contract), never a control channel that a wording
 * change to the banner could silently break.
 *
 * `serialize` re-resolves an `allColumns` projection against
 * `context?.columnOrder` (D81) before deriving `columns`/encoding `query`
 * — so a column added mid-declaration to the underlying table lands last
 * in *this* snapshot's column list too, the same physical order the
 * table's own snapshot uses, and the D27 prefix rule above sees a genuine
 * prefix extension instead of a spurious reorder-shaped recreate.
 */
export const viewKind: ObjectKind<ViewDeclaration> = {
	kind: "view",
	dependsOn: ["schema", "table"],
	requiredKeys: ["schema", "name", "columns", "query"],
	owns: (declaration): declaration is ViewDeclaration =>
		declaration.declarationKind === "view",
	serialize: (declaration, context) => {
		const query = applyColumnOrderToViewQuery(
			declaration.query,
			context?.columnOrder ?? noColumnOrder,
		);
		const snapshot: ViewSnapshot = {
			schema: declaration.schema.schemaName,
			name: declaration.viewName,
			columns: viewQueryColumns(query),
			query: encodeViewQueryNode(query),
			...securityInvokerField(declaration.securityInvoker),
		};
		return snapshot;
	},
	identify: (snapshot) => {
		const viewSnapshot = asViewSnapshot(snapshot);
		return viewIdentity(viewSnapshot.schema, viewSnapshot.name);
	},
	diff: (previous, next, identity) => {
		const guard = createOrDropDiff("view", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}
		if (sameJson(guard.previous, guard.next)) {
			return [];
		}
		const previousSnapshot = asViewSnapshot(guard.previous);
		const nextSnapshot = asViewSnapshot(guard.next);
		if (isPrefixOf(previousSnapshot.columns, nextSnapshot.columns)) {
			return [
				{
					kind: "view",
					operation: "alter",
					identity,
					previous: guard.previous,
					next: guard.next,
					notes: [VIEW_CHANGED_NOTE],
				},
			];
		}
		return [
			{
				kind: "view",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: [VIEW_RECREATE_NOTE],
			},
		];
	},
	emit: (change, siblingChanges) =>
		dispatchEmit(
			{ create: emitCreate, alter: emitAlter, drop: emitDrop },
			change,
			siblingChanges,
		),
};
