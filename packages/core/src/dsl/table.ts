import { throwHejbroError } from "../error";
import type { ColumnBuilder, ColumnState } from "../types/column-builder";
import type { SchemaDeclaration } from "./schema";

/** The referential actions Postgres supports for `on delete`. */
export const foreignKeyActions = [
	"cascade",
	"restrict",
	"set null",
	"no action",
] as const;

/** @see foreignKeyActions */
export type ForeignKeyAction = (typeof foreignKeyActions)[number];

/** A declared index on one or more (already snake_cased) column names. */
export type IndexDeclaration = {
	readonly columns: ReadonlyArray<string>;
	readonly unique: boolean;
	readonly indexName: string | null;
};

/** A declared foreign key from local (already snake_cased) columns to another table's columns. */
export type ForeignKeyDeclaration = {
	readonly columns: ReadonlyArray<string>;
	readonly references: {
		readonly table: TableDeclaration;
		readonly columns: ReadonlyArray<string>;
	};
	readonly onDelete: ForeignKeyAction | null;
};

/** A declared table: its columns (in declaration order), indexes, and foreign keys. */
export type TableDeclaration = {
	readonly declarationKind: "table";
	readonly schema: SchemaDeclaration;
	readonly tableName: string;
	readonly columns: ReadonlyArray<{
		readonly columnName: string;
		readonly columnState: ColumnState;
	}>;
	readonly indexes: ReadonlyArray<IndexDeclaration>;
	readonly foreignKeys: ReadonlyArray<ForeignKeyDeclaration>;
};

/** Typed helpers passed into a table's `extras` callback. */
export type TableExtrasHelpers<TColumns extends Record<string, ColumnBuilder>> =
	{
		/** resolves a TS column key to its snake_cased SQL column name */
		readonly column: (columnKey: keyof TColumns & string) => string;
	};

/** The optional indexes/foreign keys a table's `extras` callback may return. */
export type TableExtras = {
	readonly indexes?: ReadonlyArray<IndexDeclaration>;
	readonly foreignKeys?: ReadonlyArray<ForeignKeyDeclaration>;
};

/** Converts a camelCase TypeScript identifier to a snake_case SQL name (`publishedAt` → `published_at`). */
export const toSnakeCase = (name: string): string =>
	name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

type ColumnEntry = {
	readonly columnKey: string;
	readonly columnName: string;
	readonly columnState: ColumnState;
};

const buildColumnEntries = <TColumns extends Record<string, ColumnBuilder>>(
	tableName: string,
	columns: TColumns,
): ReadonlyArray<ColumnEntry> => {
	const columnEntries = Object.entries(columns).map(
		([columnKey, columnBuilder]) => ({
			columnKey,
			columnName: toSnakeCase(columnKey),
			columnState: columnBuilder.columnState,
		}),
	);

	const duplicateColumnName = columnEntries
		.map((entry) => entry.columnName)
		.find(
			(columnName, index, allNames) => allNames.indexOf(columnName) !== index,
		);

	if (duplicateColumnName !== undefined) {
		throwHejbroError(
			"duplicate-column",
			`table "${tableName}" has duplicate column name "${duplicateColumnName}" after snake_casing — rename one of the conflicting TypeScript properties.`,
		);
	}

	return columnEntries;
};

const buildExtrasHelpers = <TColumns extends Record<string, ColumnBuilder>>(
	tableName: string,
	columnEntries: ReadonlyArray<ColumnEntry>,
): TableExtrasHelpers<TColumns> => {
	const columnNameByKey = new Map(
		columnEntries.map((entry) => [entry.columnKey, entry.columnName] as const),
	);
	return {
		column: (columnKey) => {
			const columnName = columnNameByKey.get(columnKey);
			if (columnName === undefined) {
				return throwHejbroError(
					"unknown-column-ref",
					`table "${tableName}" has no column "${columnKey}" — check the column key you passed to the extras helper.`,
				);
			}
			return columnName;
		},
	};
};

const validateColumnRefs = (
	tableName: string,
	knownColumnNames: ReadonlySet<string>,
	indexes: ReadonlyArray<IndexDeclaration>,
	foreignKeys: ReadonlyArray<ForeignKeyDeclaration>,
): void => {
	const badIndexColumn = indexes
		.flatMap((index) => index.columns)
		.find((columnName) => !knownColumnNames.has(columnName));
	if (badIndexColumn !== undefined) {
		throwHejbroError(
			"unknown-index-column",
			`table "${tableName}" declares an index referencing unknown column "${badIndexColumn}" — check the column name.`,
		);
	}

	const badForeignKeyColumn = foreignKeys
		.flatMap((foreignKey) => foreignKey.columns)
		.find((columnName) => !knownColumnNames.has(columnName));
	if (badForeignKeyColumn !== undefined) {
		throwHejbroError(
			"unknown-foreign-key-column",
			`table "${tableName}" declares a foreign key referencing unknown column "${badForeignKeyColumn}" — check the column name.`,
		);
	}
};

/**
 * Declares a table under `owner`. Column keys are camelCase in TypeScript
 * and snake_cased in the generated SQL. `extras` receives typed helpers to
 * reference this table's own (snake_cased) columns when declaring indexes
 * or foreign keys.
 */
export const table = <TColumns extends Record<string, ColumnBuilder>>(
	owner: SchemaDeclaration,
	tableName: string,
	columns: TColumns,
	extras?: (helpers: TableExtrasHelpers<TColumns>) => TableExtras,
): TableDeclaration => {
	const columnEntries = buildColumnEntries(tableName, columns);
	const helpers = buildExtrasHelpers<TColumns>(tableName, columnEntries);
	const resolvedExtras = extras?.(helpers) ?? {};
	const indexes = resolvedExtras.indexes ?? [];
	const foreignKeys = resolvedExtras.foreignKeys ?? [];

	const knownColumnNames = new Set(
		columnEntries.map((entry) => entry.columnName),
	);
	validateColumnRefs(tableName, knownColumnNames, indexes, foreignKeys);

	return {
		declarationKind: "table",
		schema: owner,
		tableName,
		columns: columnEntries.map((entry) => ({
			columnName: entry.columnName,
			columnState: entry.columnState,
		})),
		indexes,
		foreignKeys,
	};
};
