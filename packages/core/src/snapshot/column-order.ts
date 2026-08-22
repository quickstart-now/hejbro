import type { TableDeclaration } from "../dsl/table";
import type {
	ColumnRenameSpec,
	RenameSpec,
	TableRenameSpec,
} from "../engine/rename-plan";
import type {
	ProjectionNode,
	QueryNode,
	ReturningNode,
	SelectNode,
	TableRefNode,
} from "../expr/ast";
import type { HejbroDeclaration } from "../kind/object-kind"; // type-only; object-kind.ts imports ColumnOrderOracle back as `import type`, which TS erases — no runtime cycle
import { asTableSnapshot } from "../kinds/table-snapshot";
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

/** Parent column names, already spelled the way the next snapshot spells them (column renames applied). */
const parentColumnNames = (
	previous: Snapshot,
	schemaName: string,
	tableName: string,
	renames: ReadonlyArray<RenameSpec>,
): ReadonlyArray<string> => {
	const node =
		previous.objects[
			`table:${schemaName}.${parentTableName(schemaName, tableName, renames)}`
		];
	if (node === undefined) {
		return [];
	}
	const renamed = new Map(
		renames
			.filter(isColumnRename)
			.filter(
				(spec) =>
					spec.schemaName === schemaName && spec.tableName === tableName,
			)
			.map((spec) => [spec.oldName, spec.newName] as const),
	);
	return asTableSnapshot(node).columns.map(
		(column) => renamed.get(column.name) ?? column.name,
	);
};

/** D81: parent order for the columns that survive, then the newcomers in declaration order. */
const physicalOrder = (
	parent: ReadonlyArray<string>,
	declared: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const declaredSet = new Set(declared);
	const parentSet = new Set(parent);
	return [
		...parent.filter((name) => declaredSet.has(name)),
		...declared.filter((name) => !parentSet.has(name)),
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
			return [
				`${schemaName}.${declaration.tableName}`,
				physicalOrder(
					parentColumnNames(
						previous,
						schemaName,
						declaration.tableName,
						renames,
					),
					declared,
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
