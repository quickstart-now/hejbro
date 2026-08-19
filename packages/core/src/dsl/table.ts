import { throwHejbroError } from "../error";
import type { ColumnRef } from "../expr/ast";
import { columnRef } from "../expr/ast";
import type {
	BuilderFamily,
	ColumnBuilder,
	ColumnState,
} from "../types/column-builder";
import type { RlsDeclaration, RlsInput } from "./rls";
import { bindRls } from "./rls";
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
	readonly rls: RlsDeclaration | null;
};

/** Hides a {@link Table}'s declaration metadata behind a unique symbol, keeping the object's own enumerable keys limited to its columns (D15). */
export const tableMeta: unique symbol = Symbol("hejbro:table-meta");

/** Maps a table's column builders to the typed {@link ColumnRef}s exposed at the top level of the built {@link Table}. */
export type TableColumns<TColumns extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TColumns]: ColumnRef<BuilderFamily<TColumns[K]>>;
};

/** A drizzle-style table object (D15): columns as top-level typed refs, declaration metadata hidden behind {@link tableMeta}. */
export type Table<
	TColumns extends Record<string, ColumnBuilder> = Record<
		string,
		ColumnBuilder
	>,
> = TableColumns<TColumns> & { readonly [tableMeta]: TableDeclaration };

/** Reads a {@link Table}'s hidden declaration metadata. */
export const getTableMeta = (tableObject: Table): TableDeclaration =>
	tableObject[tableMeta];

/** Guards that `value` is a {@link Table} built by {@link table}. */
export const isTable = (value: unknown): value is Table =>
	typeof value === "object" && value !== null && tableMeta in value;

/** A local foreign key column list plus the table+columns it references, as passed to a table's `extras` callback. */
export type ForeignKeyInput = {
	readonly columns: ReadonlyArray<ColumnRef>;
	readonly references: {
		readonly table: Table;
		readonly columns: ReadonlyArray<ColumnRef>;
	};
	readonly onDelete?: ForeignKeyAction;
};

/** The optional indexes/foreign keys a table's `extras` callback may return. */
export type TableExtras = {
	readonly indexes?: ReadonlyArray<IndexDeclaration>;
	readonly foreignKeys?: ReadonlyArray<ForeignKeyInput>;
	readonly rls?: RlsInput;
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

/**
 * Builds the `TableColumns<TColumns>` refs object exposed at the top level
 * of a `Table`. `columnEntries` is derived generically from `TColumns` via
 * `buildColumnEntries`, so TypeScript can't trace the per-key literal
 * family back through it — this cast is the one place that mapped type
 * meets the runtime object (Task 7 design note).
 */
const buildColumnRefs = <TColumns extends Record<string, ColumnBuilder>>(
	owner: SchemaDeclaration,
	tableName: string,
	columnEntries: ReadonlyArray<ColumnEntry>,
): TableColumns<TColumns> =>
	Object.fromEntries(
		columnEntries.map((entry) => [
			entry.columnKey,
			columnRef(
				owner.schemaName,
				tableName,
				entry.columnName,
				entry.columnState.typeNode,
			),
		]),
	) as TableColumns<TColumns>;

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

const findForeignColumnRef = (
	owner: SchemaDeclaration,
	tableName: string,
	refs: ReadonlyArray<ColumnRef>,
): ColumnRef | undefined =>
	refs.find(
		(ref) =>
			ref.exprNode.schemaName !== owner.schemaName ||
			ref.exprNode.tableName !== tableName,
	);

const resolveForeignKey = (
	owner: SchemaDeclaration,
	tableName: string,
	input: ForeignKeyInput,
): ForeignKeyDeclaration => {
	const foreignRef = findForeignColumnRef(owner, tableName, input.columns);
	if (foreignRef !== undefined) {
		return throwHejbroError(
			"foreign-column-ref",
			`table "${tableName}" received a column of "${foreignRef.exprNode.schemaName}.${foreignRef.exprNode.tableName}" — indexes and local fk columns must use this table's own columns.`,
		);
	}
	return {
		columns: input.columns.map((column) => column.sqlName),
		references: {
			table: getTableMeta(input.references.table),
			columns: input.references.columns.map((column) => column.sqlName),
		},
		onDelete: input.onDelete ?? null,
	};
};

/** Binds `extras.rls` to its owning table (D25), or `null` when a table declares none — an `if` helper so `table()` never needs a ternary. */
const resolveRls = (
	owner: SchemaDeclaration,
	tableName: string,
	rlsInput: RlsInput | undefined,
): RlsDeclaration | null => {
	if (rlsInput === undefined) {
		return null;
	}
	return bindRls(owner.schemaName, tableName, rlsInput);
};

/**
 * Declares a table under `owner`. Column keys are camelCase in TypeScript
 * and snake_cased in the generated SQL. `extras` receives this table's own
 * columns as typed `ColumnRef`s to build indexes (`index().on(t.column)`),
 * foreign keys, and row-level security (`rls.enabled({...})`).
 */
export const table = <TColumns extends Record<string, ColumnBuilder>>(
	owner: SchemaDeclaration,
	tableName: string,
	columns: TColumns,
	extras?: (t: TableColumns<TColumns>) => TableExtras,
): Table<TColumns> => {
	const columnEntries = buildColumnEntries(tableName, columns);
	const refsObject = buildColumnRefs<TColumns>(owner, tableName, columnEntries);

	const resolvedExtras = extras?.(refsObject) ?? {};
	const indexes = resolvedExtras.indexes ?? [];
	const foreignKeys = (resolvedExtras.foreignKeys ?? []).map((input) =>
		resolveForeignKey(owner, tableName, input),
	);

	const knownColumnNames = new Set(
		columnEntries.map((entry) => entry.columnName),
	);
	validateColumnRefs(tableName, knownColumnNames, indexes, foreignKeys);

	const rls = resolveRls(owner, tableName, resolvedExtras.rls);

	const declaration: TableDeclaration = {
		declarationKind: "table",
		schema: owner,
		tableName,
		columns: columnEntries.map((entry) => ({
			columnName: entry.columnName,
			columnState: entry.columnState,
		})),
		indexes,
		foreignKeys,
		rls,
	};

	return Object.assign(refsObject, { [tableMeta]: declaration });
};
