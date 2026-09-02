import type { EnumDeclaration, SchemaDeclaration } from "@hejbro/core";
import { schema as declareSchema } from "@hejbro/core";
import type { Catalog, ColumnRow, ConstraintRow } from "../check/catalog";
import type { ColumnDetailRow, InferenceCatalog } from "./catalog";
import { inferColumnKeys } from "./column-keys";
import type { InferredColumnFacts } from "./columns";
import type {
	InferredForeignKey,
	InferredIndex,
	InferredTableFacts,
} from "./table";

const tableIdentity = (schema: string, table: string): string =>
	`${schema}.${table}`;

const enumIdentity = (schema: string, name: string): string =>
	`${schema}.${name}`;

/** `check/catalog.ts`'s own array-type spelling (`format_type` appends `[]`) -- the only signal `isArray` has, since the unwrapping already happened server-side for `baseTypeName`. */
const isArrayType = (catalogType: string): boolean =>
	catalogType.endsWith("[]");

const findColumnDetail = (
	inferenceCatalog: InferenceCatalog,
	row: ColumnRow,
): ColumnDetailRow | undefined =>
	inferenceCatalog.columnDetails.find(
		(detail) =>
			detail.schema === row.schema &&
			detail.table === row.table &&
			detail.name === row.name,
	);

const findIdentityOptions = (
	inferenceCatalog: InferenceCatalog,
	row: ColumnRow,
): InferredColumnFacts["identityOptions"] => {
	const found = inferenceCatalog.identitySequenceOptions.find(
		(option) =>
			option.schema === row.schema &&
			option.table === row.table &&
			option.column === row.name,
	);
	if (found === undefined) {
		return null;
	}
	return {
		startValue: found.startValue,
		increment: found.increment,
		minValue: found.minValue,
		maxValue: found.maxValue,
		cache: found.cache,
		cycle: found.cycle,
	};
};

const enumDeclarationFor = (
	row: ColumnRow,
	enumsByIdentity: ReadonlyMap<string, EnumDeclaration>,
): EnumDeclaration | null => {
	if (
		row.baseTypeKind !== "e" ||
		row.baseTypeSchema === null ||
		row.baseTypeName === null
	) {
		return null;
	}
	return (
		enumsByIdentity.get(enumIdentity(row.baseTypeSchema, row.baseTypeName)) ??
		null
	);
};

/** Merges one `ColumnRow` (the shared inventory) with its `ColumnDetailRow`/identity-options (inference's own reads) and a resolved enum, when this column's base type is one -- 1.3's own input shape. */
const columnFacts = (
	row: ColumnRow,
	inferenceCatalog: InferenceCatalog,
	enumsByIdentity: ReadonlyMap<string, EnumDeclaration>,
): InferredColumnFacts => {
	const detail = findColumnDetail(inferenceCatalog, row);
	return {
		schema: row.schema,
		table: row.table,
		name: row.name,
		sqlType: row.catalogType,
		baseTypeName: row.baseTypeName,
		isArray: isArrayType(row.catalogType),
		notNull: row.notNull,
		catalogDefault: row.catalogDefault,
		identityKind: detail?.identityKind ?? "",
		generatedKind: detail?.generatedKind ?? "",
		identityOptions: findIdentityOptions(inferenceCatalog, row),
		enumDeclaration: enumDeclarationFor(row, enumsByIdentity),
	};
};

const primaryKeyColumns = (
	constraints: ReadonlyArray<ConstraintRow>,
): ReadonlySet<string> =>
	new Set(
		constraints
			.filter((constraint) => constraint.type === "p")
			.flatMap((constraint) => constraint.columns),
	);

const foreignKeysFor = (
	constraints: ReadonlyArray<ConstraintRow>,
	inferenceCatalog: InferenceCatalog,
	columnFactsByName: ReadonlyMap<string, InferredColumnFacts>,
): ReadonlyArray<InferredForeignKey> =>
	constraints
		.filter((constraint) => constraint.type === "f")
		.flatMap((constraint) => {
			const detail = inferenceCatalog.foreignKeyDetails.find(
				(row) =>
					row.schema === constraint.schema &&
					row.table === constraint.table &&
					row.name === constraint.name,
			);
			if (detail === undefined) {
				return [];
			}
			return [
				{
					sourceColumns: constraint.columns,
					targetSchema: detail.targetSchema,
					targetTable: detail.targetTable,
					targetColumns: detail.targetColumns.map((sqlName) => ({
						sqlName,
						// The target's own facts are unknown here (a different
						// table's columns) -- a bare fallback is fine, since an
						// existingTable handle is never emitted (D41).
						facts: columnFactsByName.get(sqlName) ?? {
							schema: detail.targetSchema,
							table: detail.targetTable,
							name: sqlName,
							sqlType: "text",
							baseTypeName: "text",
							isArray: false,
							notNull: false,
							catalogDefault: null,
							identityKind: "",
							generatedKind: "",
							identityOptions: null,
							enumDeclaration: null,
						},
					})),
					onDelete: detail.onDelete,
					onUpdate: detail.onUpdate,
				},
			];
		});

const checksFor = (
	constraints: ReadonlyArray<ConstraintRow>,
	inferenceCatalog: InferenceCatalog,
): InferredTableFacts["checks"] =>
	constraints
		.filter((constraint) => constraint.type === "c")
		.flatMap((constraint) => {
			const detail = inferenceCatalog.checkExpressions.find(
				(row) =>
					row.schema === constraint.schema && row.name === constraint.name,
			);
			if (detail === undefined) {
				return [];
			}
			return [{ name: constraint.name, expression: detail.expression }];
		});

const indexesFor = (
	schema: string,
	table: string,
	inferenceCatalog: InferenceCatalog,
	primaryKeyConstraintName: string | undefined,
): ReadonlyArray<InferredIndex> =>
	inferenceCatalog.indexDetails.filter(
		(index) =>
			index.schema === schema &&
			index.table === table &&
			index.name !== primaryKeyConstraintName,
	);

/**
 * One table's own columns in physical order (`attnum`, via inference's
 * `columnDetails`) with the TypeScript key 1.1's collision rule assigns
 * each -- shared by `mergeTableFacts` (below) and `describeCatalog`
 * (1.6), which both need the *same* ordering and keys: the collision
 * rule is defined over one table's physical order, so computing it
 * twice, differently, would silently disagree.
 */
export const orderedColumnsWithKeys = (
	catalog: Catalog,
	inferenceCatalog: InferenceCatalog,
	schemaName: string,
	tableName: string,
): {
	readonly columns: ReadonlyArray<ColumnRow>;
	readonly tsKeys: ReadonlyArray<string>;
} => {
	const columns = catalog.columns.filter(
		(row) => row.schema === schemaName && row.table === tableName,
	);
	const positionByName = new Map(
		inferenceCatalog.columnDetails
			.filter(
				(detail) => detail.schema === schemaName && detail.table === tableName,
			)
			.map((detail) => [detail.name, detail.position]),
	);
	const orderedColumns = [...columns].sort(
		(a, b) =>
			(positionByName.get(a.name) ?? 0) - (positionByName.get(b.name) ?? 0),
	);
	return {
		columns: orderedColumns,
		tsKeys: inferColumnKeys(orderedColumns.map((row) => row.name)),
	};
};

/**
 * Groups the shared inventory (`Catalog`) and inference's own detail
 * reads (`InferenceCatalog`) into one `InferredTableFacts` per table --
 * the raw-row adapter tasks.md's group 1 header names, deferred until
 * 1.4b (CI-G1-R1-07). `enumsByIdentity` (1.5's `inferEnums` output) is
 * threaded through so every column of a given enum type shares the
 * *same* `EnumDeclaration` instance.
 */
export const mergeTableFacts = (
	catalog: Catalog,
	inferenceCatalog: InferenceCatalog,
	enumsByIdentity: ReadonlyMap<string, EnumDeclaration>,
): ReadonlyArray<InferredTableFacts> => {
	const schemasByName = new Map<string, SchemaDeclaration>(
		catalog.schemas.map((row) => [row.schema, declareSchema(row.schema)]),
	);
	return catalog.tables.map((tableRow) => {
		const { columns: orderedColumns, tsKeys } = orderedColumnsWithKeys(
			catalog,
			inferenceCatalog,
			tableRow.schema,
			tableRow.table,
		);
		const factsByColumn = orderedColumns.map((row) =>
			columnFacts(row, inferenceCatalog, enumsByIdentity),
		);
		const columnFactsByName = new Map(
			factsByColumn.map((facts, index) => [
				orderedColumns[index]?.name ?? "",
				facts,
			]),
		);
		const pkColumns = primaryKeyColumns(
			catalog.constraints.filter(
				(row) => row.schema === tableRow.schema && row.table === tableRow.table,
			),
		);
		const tableConstraints = catalog.constraints.filter(
			(row) => row.schema === tableRow.schema && row.table === tableRow.table,
		);
		const primaryKeyConstraint = tableConstraints.find(
			(row) => row.type === "p",
		);
		return {
			schema:
				schemasByName.get(tableRow.schema) ?? declareSchema(tableRow.schema),
			tableName: tableRow.table,
			columns: orderedColumns.map((row, index) => ({
				sqlName: row.name,
				tsKey: tsKeys[index] ?? row.name,
				facts: factsByColumn[index] as InferredColumnFacts,
				isPrimaryKey: pkColumns.has(row.name),
			})),
			foreignKeys: foreignKeysFor(
				tableConstraints,
				inferenceCatalog,
				columnFactsByName,
			),
			checks: checksFor(tableConstraints, inferenceCatalog),
			indexes: indexesFor(
				tableRow.schema,
				tableRow.table,
				inferenceCatalog,
				primaryKeyConstraint?.name,
			),
		};
	});
};

export { tableIdentity };
