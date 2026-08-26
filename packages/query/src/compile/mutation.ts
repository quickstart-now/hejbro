import type {
	DeleteNode,
	ExprNode,
	InsertNode,
	OnConflictNode,
	ReturningNode,
	UpdateNode,
} from "@hejbro/core";
import { renderDelete, renderInsert, renderUpdate } from "@hejbro/core";
import type { Lifted } from "./params";
import { liftExprNode, liftExprSequence } from "./params";

/** A rendered insert/update/delete: SQL text plus the bind parameters its literals lifted to. */
export type CompiledMutation = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

type SetEntry = { readonly columnName: string; readonly value: ExprNode };
type AliasedExpr = { readonly alias: string; readonly expr: ExprNode };

const liftSetEntries = (
	set: ReadonlyArray<SetEntry>,
	startIndex: number,
): Lifted<ReadonlyArray<SetEntry>> =>
	set.reduce<Lifted<ReadonlyArray<SetEntry>>>(
		(acc, entry) => {
			const lifted = liftExprNode(entry.value, startIndex + acc.params.length);
			return {
				node: [
					...acc.node,
					{ columnName: entry.columnName, value: lifted.node },
				],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

const liftReturningColumns = (
	columns: ReadonlyArray<AliasedExpr>,
	startIndex: number,
): Lifted<ReadonlyArray<AliasedExpr>> =>
	columns.reduce<Lifted<ReadonlyArray<AliasedExpr>>>(
		(acc, column) => {
			const lifted = liftExprNode(column.expr, startIndex + acc.params.length);
			return {
				node: [...acc.node, { alias: column.alias, expr: lifted.node }],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

const liftColumnsReturning = (
	returning: Extract<ReturningNode, { readonly returningKind: "columns" }>,
	startIndex: number,
): Lifted<ReturningNode> => {
	const lifted = liftReturningColumns(returning.columns, startIndex);
	return {
		node: { ...returning, columns: lifted.node },
		params: lifted.params,
	};
};

const liftUnchangedReturning = (
	returning: ReturningNode,
): Lifted<ReturningNode> => ({ node: returning, params: [] });

// `allColumns` (bare `returning()`) names no expression to lift; only an
// object projection (`returning({ alias: expr })`) has one.
const returningLiftHandlers: {
	readonly [K in ReturningNode["returningKind"]]: (
		returning: Extract<ReturningNode, { readonly returningKind: K }>,
		startIndex: number,
	) => Lifted<ReturningNode>;
} = {
	allColumns: liftUnchangedReturning,
	columns: liftColumnsReturning,
};

const liftReturningNode = (
	returning: ReturningNode,
	startIndex: number,
): Lifted<ReturningNode> => {
	const handler = returningLiftHandlers[returning.returningKind] as (
		returning: ReturningNode,
		startIndex: number,
	) => Lifted<ReturningNode>;
	return handler(returning, startIndex);
};

const liftReturning = (
	returning: ReturningNode | null,
	startIndex: number,
): Lifted<ReturningNode | null> => {
	if (returning === null) {
		return { node: null, params: [] };
	}
	return liftReturningNode(returning, startIndex);
};

const liftMutationWhere = (
	where: ExprNode | null,
	startIndex: number,
): Lifted<ExprNode | null> => {
	if (where === null) {
		return { node: null, params: [] };
	}
	return liftExprNode(where, startIndex);
};

const liftOnConflictNothing = (
	action: Extract<OnConflictNode["action"], { readonly actionKind: "nothing" }>,
): Lifted<OnConflictNode["action"]> => ({ node: action, params: [] });

const liftOnConflictUpdate = (
	action: Extract<OnConflictNode["action"], { readonly actionKind: "update" }>,
	startIndex: number,
): Lifted<OnConflictNode["action"]> => {
	const lifted = liftSetEntries(action.set, startIndex);
	return { node: { ...action, set: lifted.node }, params: lifted.params };
};

const onConflictActionLiftHandlers: {
	readonly [K in OnConflictNode["action"]["actionKind"]]: (
		action: Extract<OnConflictNode["action"], { readonly actionKind: K }>,
		startIndex: number,
	) => Lifted<OnConflictNode["action"]>;
} = {
	nothing: liftOnConflictNothing,
	update: liftOnConflictUpdate,
};

const liftOnConflict = (
	onConflict: OnConflictNode | null,
	startIndex: number,
): Lifted<OnConflictNode | null> => {
	if (onConflict === null) {
		return { node: null, params: [] };
	}
	const handler = onConflictActionLiftHandlers[
		onConflict.action.actionKind
	] as (
		action: OnConflictNode["action"],
		startIndex: number,
	) => Lifted<OnConflictNode["action"]>;
	const lifted = handler(onConflict.action, startIndex);
	return {
		node: { ...onConflict, action: lifted.node },
		params: lifted.params,
	};
};

const liftRows = (
	rows: ReadonlyArray<ReadonlyArray<ExprNode>>,
	startIndex: number,
): Lifted<ReadonlyArray<ReadonlyArray<ExprNode>>> =>
	rows.reduce<Lifted<ReadonlyArray<ReadonlyArray<ExprNode>>>>(
		(acc, row) => {
			const lifted = liftExprSequence(row, startIndex + acc.params.length);
			return {
				node: [...acc.node, lifted.node],
				params: [...acc.params, ...lifted.params],
			};
		},
		{ node: [], params: [] },
	);

/**
 * Compiles an {@link InsertNode} in render order — row values, then
 * `onConflict`, then `returning` — matching `renderInsert`'s clause order.
 * Row values include core's internal `default` marker (`RawSqlNode`) for a
 * multi-row insert's missing keys; `liftExprNode` passes it through
 * unchanged like any other `rawSql`, so it stays `default`, never a
 * parameter.
 */
export const compileInsert = (node: InsertNode): CompiledMutation => {
	const rows = liftRows(node.rows, 1);
	const onConflict = liftOnConflict(node.onConflict, 1 + rows.params.length);
	const returning = liftReturning(
		node.returning,
		1 + rows.params.length + onConflict.params.length,
	);
	const lifted: InsertNode = {
		...node,
		rows: rows.node,
		onConflict: onConflict.node,
		returning: returning.node,
	};
	return {
		sql: renderInsert(lifted),
		params: [...rows.params, ...onConflict.params, ...returning.params],
	};
};

/** Compiles an {@link UpdateNode} in render order — `set`, then `where`, then `returning` — matching `renderUpdate`'s clause order. */
export const compileUpdate = (node: UpdateNode): CompiledMutation => {
	const set = liftSetEntries(node.set, 1);
	const where = liftMutationWhere(node.where, 1 + set.params.length);
	const returning = liftReturning(
		node.returning,
		1 + set.params.length + where.params.length,
	);
	const lifted: UpdateNode = {
		...node,
		set: set.node,
		where: where.node,
		returning: returning.node,
	};
	return {
		sql: renderUpdate(lifted),
		params: [...set.params, ...where.params, ...returning.params],
	};
};

/** Compiles a {@link DeleteNode} in render order — `where`, then `returning` — matching `renderDelete`'s clause order. */
export const compileDelete = (node: DeleteNode): CompiledMutation => {
	const where = liftMutationWhere(node.where, 1);
	const returning = liftReturning(node.returning, 1 + where.params.length);
	const lifted: DeleteNode = {
		...node,
		where: where.node,
		returning: returning.node,
	};
	return {
		sql: renderDelete(lifted),
		params: [...where.params, ...returning.params],
	};
};
