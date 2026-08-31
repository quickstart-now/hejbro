import { captureDeclarationSite } from "../declaration-site";
import type { SqlTypeFamily } from "../expr/type-family";
import { assertSqlName } from "../sql/identifier-rules";
import type {
	ColumnBuilder,
	ColumnMeta,
	IdentityKind,
} from "../types/column-builder";
import type { SchemaDeclaration } from "./schema";
import type { Table, TableDeclaration } from "./table";
import {
	buildColumnEntries,
	buildColumnRefs,
	foldColumnReferences,
	tableMeta,
} from "./table";

/**
 * A table read back from a database this repository does not own (`hejbro
 * sync`'s own output, D87 polyrepo-sync): the same consumer-visible type
 * layer as `table()` — TypeScript keys, numeric mode, non-null array
 * elements, and relation keys via `.references()` — but no migration
 * authority (`Table<TColumns, "usage">`, never `DeclaredTable`). Not
 * assignable to `generateMigration`'s input at the type level; the
 * runtime chokepoint (`engine/generate.ts`'s `resolveTableDeclarations`)
 * refuses it too, for a caller the type layer never saw (a JS project, or
 * a config file `jiti` loads without a compile step). `hejbro sync` is
 * this constructor's only sanctioned caller, but nothing here checks
 * who's calling — the refusal rests on the absence of authority in the
 * value itself, not on provenance.
 */
export const syncedTable = <TColumns extends Record<string, ColumnBuilder>>(
	schemaName: string,
	tableName: string,
	columns: TColumns,
	options?: {
		/** The manifest row this table was read from — the same string a
		 * synced module exports as its freshness stamp. Optional: a
		 * hand-built usage table (a test fixture, or a caller the type
		 * layer never saw) carries none, which is exactly how its refusal
		 * ends up naming no origin either. */
		readonly origin?: string;
	},
): Table<TColumns, "usage"> => {
	const declaredAt = captureDeclarationSite();
	assertSqlName(schemaName, "schema", declaredAt);
	assertSqlName(tableName, "table", declaredAt);
	const owner: SchemaDeclaration = { declarationKind: "schema", schemaName };
	const columnEntries = buildColumnEntries(tableName, columns);
	const refsObject = buildColumnRefs<TColumns>(owner, tableName, columnEntries);

	const declaration: TableDeclaration = {
		declarationKind: "table",
		schema: owner,
		tableName,
		columns: columnEntries.map((entry) => ({
			columnKey: entry.columnKey,
			columnName: entry.columnName,
			columnState: entry.columnState,
		})),
		indexes: [],
		foreignKeys: foldColumnReferences(tableName, columnEntries),
		checks: [],
		rls: null,
		existing: false,
		authority: "usage",
		...(options?.origin !== undefined && { origin: options.origin }),
		declaredAt,
	};

	return Object.assign(refsObject, { [tableMeta]: declaration }) as Table<
		TColumns,
		"usage"
	>;
};

/**
 * Type-only write-optionality markers for a synced column (schema-manifest
 * delta, "Write inputs follow what the database does for a column") —
 * `syncedTable()` has no SQL surface to reproduce a default expression, a
 * generated expression, or an identity kind (it only ever reads, never
 * writes DDL), but the manifest's embedded snapshot still carries whether
 * one applies, and that fact changes `@hejbro/query`'s `InsertInput`/
 * `UpdateInput` for the column. Each of the three functions below returns
 * the exact same value, re-typed: `InsertInput`/`UpdateInput` already read
 * these same `TMeta` fields for a `table()`-declared column (task
 * 3.2/3.16, D100 decision 5), so marking a synced column this way is what
 * lets a defaulted column stay optional to insert into and a computed one
 * disappear from writes entirely, with no new query-layer logic.
 */
export const syncedHasDefault = <
	TFamily extends SqlTypeFamily,
	TMeta extends ColumnMeta,
>(
	column: ColumnBuilder<TFamily, TMeta>,
): ColumnBuilder<TFamily, TMeta & { readonly hasDefault: true }> =>
	column as ColumnBuilder<TFamily, TMeta & { readonly hasDefault: true }>;

/** @see syncedHasDefault — the ALWAYS-family write-exclusion flag instead of the plain-optional one. */
export const syncedGenerated = <
	TFamily extends SqlTypeFamily,
	TMeta extends ColumnMeta,
>(
	column: ColumnBuilder<TFamily, TMeta>,
): ColumnBuilder<TFamily, TMeta & { readonly generated: true }> =>
	column as ColumnBuilder<TFamily, TMeta & { readonly generated: true }>;

/**
 * @see syncedHasDefault — `"always"` is ALWAYS-family (write-excluded,
 * same as {@link syncedGenerated}); `"byDefault"` stays writable and
 * carries `hasDefault: true` alongside it, exactly as `table()`'s own
 * `.generatedByDefaultAsIdentity()` does (design decision 1) — omitting
 * that second flag here would make a by-default identity column
 * required to insert into instead of optional.
 */
export const syncedIdentity = <
	TFamily extends SqlTypeFamily,
	TMeta extends ColumnMeta,
	TKind extends IdentityKind,
>(
	column: ColumnBuilder<TFamily, TMeta>,
	// Never read: this parameter exists so a call site (e.g.
	// `syncedIdentity(col, "byDefault")`) gives TypeScript a value to infer
	// `TKind`'s literal from — the function's whole effect is the return
	// type's re-tagging, not anything this does at runtime.
	_kind: TKind,
): ColumnBuilder<
	TFamily,
	TMeta &
		(TKind extends "byDefault"
			? { readonly identity: "byDefault"; readonly hasDefault: true }
			: { readonly identity: "always" })
> =>
	column as ColumnBuilder<
		TFamily,
		TMeta &
			(TKind extends "byDefault"
				? { readonly identity: "byDefault"; readonly hasDefault: true }
				: { readonly identity: "always" })
	>;
