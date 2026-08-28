import type { TableDeclaration } from "../dsl/table";
import type {
	ColumnRenameSpec,
	RenameSpec,
	TableRenameSpec,
} from "../engine/rename-plan";
import type {
	ExprNode,
	ProjectionNode,
	QueryNode,
	ReturningNode,
	SelectNode,
	TableRefNode,
} from "../expr/ast";
import { renderExpr } from "../expr/render-sql";
import type { HejbroDeclaration } from "../kind/object-kind"; // type-only; object-kind.ts imports ColumnOrderOracle back as `import type`, which TS erases — no runtime cycle
import type { ColumnSnapshot } from "../kinds/table-snapshot";
import { asTableSnapshot, columnGenerated } from "../kinds/table-snapshot";
import type { Snapshot } from "./snapshot";

/** Answers "what is the physical column order of this table?" — `null` when the table is unknown to the declarations being built. */
export type ColumnOrderOracle = (
	table: TableRefNode,
) => ReadonlyArray<string> | null;

/** The oracle that knows nothing — used where no parent snapshot applies (tests, presets calling `serialize` directly). */
export const noColumnOrder: ColumnOrderOracle = () => null;

const isTableDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TableDeclaration => declaration.declarationKind === "table";

const isColumnRename = (spec: RenameSpec): spec is ColumnRenameSpec =>
	spec.target === "column";
const isTableRename = (spec: RenameSpec): spec is TableRenameSpec =>
	spec.target === "table";

/** The parent-side name of a table: if a table rename lands on this name, look the parent up under the old one. */
const parentTableName = (
	schemaName: string,
	tableName: string,
	renames: ReadonlyArray<RenameSpec>,
): string =>
	renames
		.filter(isTableRename)
		.filter(
			(spec) => spec.schemaName === schemaName && spec.newName === tableName,
		)
		.map((spec) => spec.oldName)[0] ?? tableName;

/** Parent columns, keyed by the name the next snapshot spells them with (column renames applied). */
const parentColumnsByName = (
	previous: Snapshot,
	schemaName: string,
	tableName: string,
	renames: ReadonlyArray<RenameSpec>,
): ReadonlyMap<string, ColumnSnapshot> => {
	const parentName = parentTableName(schemaName, tableName, renames);
	const node = previous.objects[`table:${schemaName}.${parentName}`];
	if (node === undefined) {
		return new Map();
	}
	// A `ColumnRenameSpec.tableName` is always the table's *old* name
	// (`applyColumnRename`, rename-plan.ts — a same-run table rename is
	// resolved through `tableNameByOldKey`, keyed by the old identity), so
	// this must match against `parentName`, not the declared `tableName`;
	// when no table rename co-occurs the two are equal, and the `||`
	// still accepts a spec spelled against the current name.
	const renamed = new Map(
		renames
			.filter(isColumnRename)
			.filter(
				(spec) =>
					spec.schemaName === schemaName &&
					(spec.tableName === parentName || spec.tableName === tableName),
			)
			.map((spec) => [spec.oldName, spec.newName] as const),
	);
	return new Map(
		asTableSnapshot(node).columns.map((column) => [
			renamed.get(column.name) ?? column.name,
			column,
		]),
	);
};

/**
 * `true` when `previousColumn`'s own generated expression differs from
 * `declaredGenerated`'s rendered text — an expression-change rebuild,
 * which physically re-appends the column at the end of a real Postgres
 * table (`drop column` + `add column`, `table-kind-emit.ts`'s
 * `generatedRebuildStatements`). `declaredGenerated === null` (a plain or
 * absent-generated column) or no parent column is never a rebuild by this
 * check alone.
 */
const isGeneratedRebuild = (
	previousColumn: ColumnSnapshot | undefined,
	declaredGenerated: ExprNode | null,
): boolean => {
	if (previousColumn === undefined || declaredGenerated === null) {
		return false;
	}
	const previousGenerated = columnGenerated(previousColumn);
	if (previousGenerated === null) {
		return false;
	}
	return previousGenerated !== renderExpr(declaredGenerated);
};

/** Every declared column whose expression-change rebuild this build must reflect (see {@link isGeneratedRebuild}). */
const rebuiltColumnNames = (
	declaration: TableDeclaration,
	parentColumns: ReadonlyMap<string, ColumnSnapshot>,
): ReadonlySet<string> =>
	new Set(
		declaration.columns
			.filter((column) =>
				isGeneratedRebuild(
					parentColumns.get(column.columnName),
					column.columnState.generated ?? null,
				),
			)
			.map((column) => column.columnName),
	);

/**
 * D81: parent order for the columns that survive, then the newcomers in
 * declaration order. `rebuilt` (D100) routes a same-name expression-change
 * rebuild through the newcomer branch instead of its old position — it
 * physically lands at the end of a real Postgres table, not where it used
 * to be.
 */
const physicalOrder = (
	parent: ReadonlyArray<string>,
	declared: ReadonlyArray<string>,
	rebuilt: ReadonlySet<string>,
): ReadonlyArray<string> => {
	const declaredSet = new Set(declared);
	const parentSet = new Set(parent);
	return [
		...parent.filter((name) => declaredSet.has(name) && !rebuilt.has(name)),
		...declared.filter((name) => !parentSet.has(name) || rebuilt.has(name)),
	];
};

export const computeColumnOrder = (
	declarations: ReadonlyArray<HejbroDeclaration>,
	previous: Snapshot,
	renames: ReadonlyArray<RenameSpec>,
): ColumnOrderOracle => {
	const orders = new Map(
		declarations.filter(isTableDeclaration).map((declaration) => {
			const schemaName = declaration.schema.schemaName;
			const declared = declaration.columns.map((column) => column.columnName);
			const parentColumns = parentColumnsByName(
				previous,
				schemaName,
				declaration.tableName,
				renames,
			);
			return [
				`${schemaName}.${declaration.tableName}`,
				physicalOrder(
					Array.from(parentColumns.keys()),
					declared,
					rebuiltColumnNames(declaration, parentColumns),
				),
			] as const;
		}),
	);
	return (table) =>
		orders.get(`${table.schemaName}.${table.tableName}`) ?? null;
};

const orderedProjection = (
	projection: ProjectionNode,
	table: TableRefNode,
	columnOrder: ColumnOrderOracle,
): ProjectionNode => {
	if (projection.projectionKind !== "allColumns") {
		return projection;
	}
	const order = columnOrder(table);
	if (order === null) {
		return projection;
	}
	return { projectionKind: "allColumns", columnNames: order };
};

const orderedReturning = (
	returning: ReturningNode | null,
	table: TableRefNode,
	columnOrder: ColumnOrderOracle,
): ReturningNode | null => {
	if (returning === null || returning.returningKind !== "allColumns") {
		return returning;
	}
	const order = columnOrder(table);
	if (order === null) {
		return returning;
	}
	return { returningKind: "allColumns", columnNames: order };
};

export const applyColumnOrderToSelect = (
	node: SelectNode,
	columnOrder: ColumnOrderOracle,
): SelectNode => {
	const projection = orderedProjection(node.projection, node.from, columnOrder);
	if (projection === node.projection) {
		return node;
	}
	return { ...node, projection };
};

export const applyColumnOrderToQuery = (
	node: QueryNode,
	columnOrder: ColumnOrderOracle,
): QueryNode => {
	if (node.queryKind === "select") {
		return applyColumnOrderToSelect(node, columnOrder);
	}
	const returning = orderedReturning(node.returning, node.table, columnOrder);
	if (returning === node.returning) {
		return node;
	}
	return { ...node, returning };
};
