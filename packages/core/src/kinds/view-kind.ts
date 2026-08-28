import type { ViewDeclaration } from "../dsl/define-view";
import { assertNever, throwHejbroError } from "../error";
import type { ProjectionNode, SelectNode, SetOpNode } from "../expr/ast";
import { decodeQueryNode, encodeQueryNode } from "../expr/codec";
import { renderQuery } from "../expr/render-sql";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import { dispatchEmit } from "../kind/emit-helpers";
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

/** `snapshot.query` decoded and rendered back to SQL text. */
export const viewSelectSql = (snapshot: ViewSnapshot): string =>
	renderQuery(decodeQueryNode(snapshot.query));

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
/** The leftmost select of a view query — a set-operation's output columns are its LEFT branch's, SQL's own naming rule (D103). */
const leftmostSelect = (query: SelectNode | SetOpNode): SelectNode => {
	if (query.queryKind === "setOp") {
		return leftmostSelect(query.left);
	}
	return query;
};

/** A view query's declared column list — a plain select's projection, or the left branch's through a set operation. */
export const viewQueryColumns = (
	query: SelectNode | SetOpNode,
): ReadonlyArray<string> => projectionColumns(leftmostSelect(query).projection);

/** D81 column order over a view query — each set-op leaf reorders against its own `from` (the same rule `applyColumnOrderToQuery` applies). */
const applyColumnOrderToViewQuery = (
	query: SelectNode | SetOpNode,
	columnOrder: ColumnOrderOracle,
): SelectNode | SetOpNode => {
	if (query.queryKind === "setOp") {
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

const emitCreate = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"view create change is missing its next snapshot.",
		);
	}
	return [statement(createOrReplaceSql(asViewSnapshot(change.next)))];
};

const emitAlter = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"view alter change is missing its next snapshot.",
		);
	}
	if (change.previous === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"view alter change is missing its previous snapshot.",
		);
	}
	const previousSnapshot = asViewSnapshot(change.previous);
	const nextSnapshot = asViewSnapshot(change.next);
	if (isPrefixOf(previousSnapshot.columns, nextSnapshot.columns)) {
		return [statement(createOrReplaceSql(nextSnapshot))];
	}
	return [
		predropStatement(dropViewSql(nextSnapshot)),
		statement(createOrReplaceSql(nextSnapshot)),
	];
};

const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.previous === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"view drop change is missing its previous snapshot.",
		);
	}
	return [predropStatement(dropViewSql(asViewSnapshot(change.previous)))];
};

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
			query: encodeQueryNode(query),
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
