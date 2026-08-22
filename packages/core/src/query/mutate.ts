import type { Table } from "../dsl/table";
import { getTableMeta } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	ColumnRef,
	DeleteNode,
	Expr,
	ExprNode,
	InsertNode,
	ReturningNode,
	TableRefNode,
	UpdateNode,
} from "../expr/ast";
import { isExpr } from "../expr/ast";
import { liftOperand } from "../expr/literal";
import type { LiftableFor, SqlTypeFamily } from "../expr/type-family";
import type { BuilderFamily } from "../types/column-builder";

/** A value accepted for one column of an insert/update row: a matching `Expr`, an `unknown`-family `Expr`, a raw JS scalar, or `null` (unlike comparisons, `null` is a legal write). */
export type MutationValue<TFamily extends SqlTypeFamily> =
	| Expr<TFamily>
	| Expr<"unknown">
	| LiftableFor<TFamily>
	| null;

/** One insert/update row, keyed by the table's own TypeScript column names — every column is optional (multi-row insert fills missing keys with SQL `default`). */
export type MutationRow<TTable extends Table> =
	TTable extends Table<infer TColumns>
		? {
				readonly [K in keyof TColumns]?: MutationValue<
					BuilderFamily<TColumns[K]>
				>;
			}
		: never;

export type InsertFinal = { readonly insertQuery: InsertNode };
export type InsertReturnable = InsertFinal & {
	/** No-arg = every column, snake_cased and explicit (spec §5.2). */
	returning(): InsertFinal;
};
export type InsertConflictable<TTable extends Table> = InsertReturnable & {
	onConflictDoNothing(
		...targetColumns: ReadonlyArray<ColumnRef>
	): InsertReturnable;
	onConflictDoUpdate(config: {
		readonly target: ReadonlyArray<ColumnRef>;
		readonly set: MutationRow<TTable>;
	}): InsertReturnable;
};

export type UpdateFinal = { readonly updateQuery: UpdateNode };
export type UpdateReturnable = UpdateFinal & { returning(): UpdateFinal };
export type UpdateFilterable = UpdateReturnable & {
	where(condition: Expr<"boolean">): UpdateReturnable;
};

export type DeleteFinal = { readonly deleteQuery: DeleteNode };
export type DeleteReturnable = DeleteFinal & { returning(): DeleteFinal };
export type DeleteFilterable = DeleteReturnable & {
	where(condition: Expr<"boolean">): DeleteReturnable;
};

/**
 * `MutationRow<TTable>`/row objects are keyed by a table's own TypeScript
 * column names — a generic mapped type TypeScript can't trace back through
 * runtime key lookup. This is this file's one generic/runtime boundary
 * crossing (mirrors `dsl/table.ts`'s Task 7 cast, same underlying reason):
 * `Table`'s own enumerable properties are always its column `ColumnRef`s
 * (Task 7), so a plain-record view here is safe.
 */
const asRecord = (value: unknown): Record<string, unknown> =>
	value as Record<string, unknown>;

const isColumnRef = (value: unknown): value is ColumnRef =>
	isExpr(value) && "sqlName" in value;

const resolveTableRef = (target: Table): TableRefNode => {
	const meta = getTableMeta(target);
	return { schemaName: meta.schema.schemaName, tableName: meta.tableName };
};

const resolveColumnRef = (
	target: Table,
	tableRef: TableRefNode,
	key: string,
): ColumnRef => {
	const column = asRecord(target)[key];
	if (!isColumnRef(column)) {
		return throwHejbroError(
			"unknown-column",
			`insert()/update() on "${tableRef.schemaName}.${tableRef.tableName}" received unknown column key "${key}". Next: use a column key declared on this table's table() call — this is usually a typo in "${key}", or a column that was never declared on this table.`,
		);
	}
	return column;
};

const allColumnsReturning = (target: Table): ReturningNode => ({
	returningKind: "allColumns",
	columnNames: getTableMeta(target).columns.map((column) => column.columnName),
});

const resolveSetEntries = (
	target: Table,
	tableRef: TableRefNode,
	values: unknown,
): ReadonlyArray<{ readonly columnName: string; readonly value: ExprNode }> => {
	const record = asRecord(values);
	const keys = Object.keys(record);
	if (keys.length === 0) {
		return throwHejbroError(
			"empty-set",
			"set()/values() received no columns. Next: declare at least one column to write.",
		);
	}
	return keys.map((key) => {
		const column = resolveColumnRef(target, tableRef, key);
		return {
			columnName: column.sqlName,
			value: liftOperand(record[key], column.family),
		};
	});
};

/** Internal-only `default` marker for a multi-row insert's missing keys — never constructed from user input (D18's `sql.raw` remains the only user-facing raw-SQL escape hatch). */
const defaultValueNode: ExprNode = { nodeKind: "rawSql", sql: "default" };

const collectColumnKeys = (
	rows: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<string> => {
	const allKeys = rows.flatMap((row) => Object.keys(row));
	return allKeys.filter((key, index) => allKeys.indexOf(key) === index);
};

const normalizeRows = (
	rowsInput: unknown,
): ReadonlyArray<Record<string, unknown>> => {
	if (Array.isArray(rowsInput)) {
		return rowsInput.map(asRecord);
	}
	return [asRecord(rowsInput)];
};

const valueAtKey = (
	row: Record<string, unknown>,
	key: string | undefined,
): unknown => {
	if (key === undefined) {
		return undefined;
	}
	return row[key];
};

const resolveInsertRows = (
	target: Table,
	tableRef: TableRefNode,
	rowsInput: unknown,
): {
	readonly columnNames: ReadonlyArray<string>;
	readonly rows: ReadonlyArray<ReadonlyArray<ExprNode>>;
} => {
	const rows = normalizeRows(rowsInput);

	const keys = collectColumnKeys(rows);
	if (keys.length === 0) {
		return throwHejbroError(
			"empty-set",
			"set()/values() received no columns. Next: declare at least one column to write.",
		);
	}

	const columns = keys.map((key) => resolveColumnRef(target, tableRef, key));
	const columnNames = columns.map((column) => column.sqlName);

	const resolvedRows = rows.map((row) =>
		columns.map((column, index) => {
			const value = valueAtKey(row, keys[index]);
			if (value === undefined) {
				return defaultValueNode;
			}
			return liftOperand(value, column.family);
		}),
	);

	return { columnNames, rows: resolvedRows };
};

const makeInsertFinal = (node: InsertNode): InsertFinal => ({
	insertQuery: node,
});

const makeInsertReturnable = (
	node: InsertNode,
	target: Table,
): InsertReturnable => ({
	insertQuery: node,
	returning: () =>
		makeInsertFinal({ ...node, returning: allColumnsReturning(target) }),
});

const makeInsertConflictable = (
	node: InsertNode,
	target: Table,
): InsertConflictable<Table> => ({
	insertQuery: node,
	returning: () =>
		makeInsertFinal({ ...node, returning: allColumnsReturning(target) }),
	onConflictDoNothing: (...targetColumns) =>
		makeInsertReturnable(
			{
				...node,
				onConflict: {
					targetColumns: targetColumns.map((column) => column.sqlName),
					action: { actionKind: "nothing" },
				},
			},
			target,
		),
	onConflictDoUpdate: (config) => {
		const tableRef = resolveTableRef(target);
		return makeInsertReturnable(
			{
				...node,
				onConflict: {
					targetColumns: config.target.map((column) => column.sqlName),
					action: {
						actionKind: "update",
						set: resolveSetEntries(target, tableRef, config.set),
					},
				},
			},
			target,
		);
	},
});

/** Starts an insert into `target` — chain `.values(row | rows)`. */
export const insert = <TTable extends Table>(
	target: TTable,
): {
	values(
		rows: MutationRow<TTable> | ReadonlyArray<MutationRow<TTable>>,
	): InsertConflictable<TTable>;
} => ({
	values: (rows) => {
		const tableRef = resolveTableRef(target);
		const { columnNames, rows: resolvedRows } = resolveInsertRows(
			target,
			tableRef,
			rows,
		);
		const node: InsertNode = {
			queryKind: "insert",
			table: tableRef,
			columnNames,
			rows: resolvedRows,
			onConflict: null,
			returning: null,
		};
		return makeInsertConflictable(node, target);
	},
});

const makeUpdateFinal = (node: UpdateNode): UpdateFinal => ({
	updateQuery: node,
});

const makeUpdateReturnable = (
	node: UpdateNode,
	target: Table,
): UpdateReturnable => ({
	updateQuery: node,
	returning: () =>
		makeUpdateFinal({ ...node, returning: allColumnsReturning(target) }),
});

const makeUpdateFilterable = (
	node: UpdateNode,
	target: Table,
): UpdateFilterable => ({
	updateQuery: node,
	returning: () =>
		makeUpdateFinal({ ...node, returning: allColumnsReturning(target) }),
	where: (condition) =>
		makeUpdateReturnable({ ...node, where: condition.exprNode }, target),
});

/** Starts an update of `target` — chain `.set(values)`. */
export const update = <TTable extends Table>(
	target: TTable,
): { set(values: MutationRow<TTable>): UpdateFilterable } => ({
	set: (values) => {
		const tableRef = resolveTableRef(target);
		const node: UpdateNode = {
			queryKind: "update",
			table: tableRef,
			set: resolveSetEntries(target, tableRef, values),
			where: null,
			returning: null,
		};
		return makeUpdateFilterable(node, target);
	},
});

const makeDeleteFinal = (node: DeleteNode): DeleteFinal => ({
	deleteQuery: node,
});

const makeDeleteReturnable = (
	node: DeleteNode,
	target: Table,
): DeleteReturnable => ({
	deleteQuery: node,
	returning: () =>
		makeDeleteFinal({ ...node, returning: allColumnsReturning(target) }),
});

const makeDeleteFilterable = (
	node: DeleteNode,
	target: Table,
): DeleteFilterable => ({
	deleteQuery: node,
	returning: () =>
		makeDeleteFinal({ ...node, returning: allColumnsReturning(target) }),
	where: (condition) =>
		makeDeleteReturnable({ ...node, where: condition.exprNode }, target),
});

/** Starts a delete from `target` (`deleteFrom` — `delete` is a reserved word). */
export const deleteFrom = (target: Table): DeleteFilterable => {
	const tableRef = resolveTableRef(target);
	const node: DeleteNode = {
		queryKind: "delete",
		table: tableRef,
		where: null,
		returning: null,
	};
	return makeDeleteFilterable(node, target);
};
