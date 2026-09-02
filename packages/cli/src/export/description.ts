import type {
	DeclaredTable,
	FunctionDeclaration,
	GrantSetDeclaration,
	HejbroInput,
	JsonValue,
	NumericMode,
	TriggerDeclaration,
} from "@hejbro/core";
import { getTableMeta, isTable, stableJson } from "@hejbro/core";

/** `isTable`'s own guard narrows to bare `Table`, which is wider than
 * `HejbroInput`'s `DeclaredTable` member — `Array.prototype.filter`'s
 * type-predicate overload needs the narrowed type to extend the array's
 * element type, so filtering `ReadonlyArray<HejbroInput>` needs this
 * `DeclaredTable`-typed rewrap rather than `isTable` directly. */
const isDeclaredTable = (value: HejbroInput): value is DeclaredTable =>
	isTable(value);

export type ExportColumnFact = {
	readonly key: string;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
};

/**
 * Keyed by the column's SQL name (`columnName`), never by array position
 * (schema-export delta, "Every fact that belongs to a column SHALL be
 * carried against that column's SQL name, never against its position"):
 * a snapshot orders columns physically and a declaration orders them as
 * written, and the two agree only until a column is dropped and re-added
 * (D81 moves the re-added column to the end of physical order) — a
 * reader that joined facts to columns by position would, from that
 * point on, attach every fact to the wrong column while every value
 * still looked well-typed.
 */
type ExportColumns = { readonly [sqlName: string]: ExportColumnFact };

export type ExportTableFact = {
	readonly schemaName: string;
	readonly tableName: string;
	readonly exportName: string | null;
	readonly columns: ExportColumns;
	/**
	 * `true` for an `existingTable()` declaration, `false` for a `table()`
	 * one (add-unmanaged-objects) — always present, unlike the snapshot's
	 * own compact `existing?: true` (`@hejbro/core`'s `TableSnapshot`):
	 * this file's own convention is that every field is a plain,
	 * always-present JSON value (see {@link ExportDescription}'s doc
	 * comment), so a reader never has to supply its own default for an
	 * absent key here the way `tableExisting` does for the snapshot.
	 */
	readonly existing: boolean;
};

type ExportFunctionFact = {
	readonly schemaName: string;
	readonly functionName: string;
	readonly exportName: string | null;
};

/**
 * The declaration-time choices a consuming repository's type layer needs
 * that neither a database nor the snapshot can supply on their own
 * (schema-export spec, "The export carries what the schema alone does
 * not say"): a column's numeric mode, whether an array column's elements
 * are non-null, its TypeScript key, the export name of every table and
 * function, and the role names a schema's grants and policies declare.
 * Carries no `$type` brand — none exists as a runtime field on
 * `ColumnState` to carry in the first place — and no description/
 * snapshot format number, which are the format record's own fields
 * (`export/format.ts`), not description fields; duplicating them here
 * would create a second copy of the same fact for the two to disagree
 * about later.
 *
 * **What this does not carry, by design (R2-G2 2.8):** a view's column
 * types and a function's structural signature are not carried in this
 * version — a view produces no fact here at all (only `table()`-declared
 * tables do), and a function fact carries only its names, never its
 * argument or return types. A function argument's own TypeScript key is
 * a third candidate that cannot be added later without a DSL change: the
 * declaration itself never keeps it, and the SQL-to-TypeScript
 * conversion for an argument is one-way. A consumer reading past this
 * boundary sees no view entry and no function signature at all, never a
 * partial or guessed one.
 *
 * Every field is a plain, always-present JSON value — `null` (never an
 * omitted key) is how an absent export name or default numeric mode
 * reads — so the whole shape is a {@link JsonValue} without a cast.
 */
export type ExportDescription = {
	readonly tables: ReadonlyArray<ExportTableFact>;
	readonly functions: ReadonlyArray<ExportFunctionFact>;
	readonly roles: ReadonlyArray<string>;
};

const columnFact = (
	column: ReturnType<typeof getTableMeta>["columns"][number],
): ExportColumnFact => ({
	key: column.columnKey,
	mode: column.columnState.mode,
	notNullElements: column.columnState.notNullElements === true,
});

const columnsBySqlName = (
	columns: ReturnType<typeof getTableMeta>["columns"],
): ExportColumns =>
	Object.fromEntries(
		columns.map((column) => [column.columnName, columnFact(column)]),
	);

const tableFact = (
	table: DeclaredTable,
	exportNames: ReadonlyMap<HejbroInput, string>,
): ExportTableFact => {
	const meta = getTableMeta(table);
	return {
		schemaName: meta.schema.schemaName,
		tableName: meta.tableName,
		exportName: exportNames.get(table) ?? null,
		columns: columnsBySqlName(meta.columns),
		existing: meta.existing,
	};
};

const functionFact = (
	fn: FunctionDeclaration,
	exportNames: ReadonlyMap<HejbroInput, string>,
): ExportFunctionFact => ({
	schemaName: fn.schemaName,
	functionName: fn.functionName,
	exportName: exportNames.get(fn) ?? null,
});

const isFunctionDeclaration = (
	value: HejbroInput,
): value is FunctionDeclaration =>
	!isTable(value) && value.declarationKind === "function";

const isTriggerDeclaration = (
	value: HejbroInput,
): value is TriggerDeclaration =>
	!isTable(value) && value.declarationKind === "trigger";

const isGrantSetDeclaration = (
	value: HejbroInput,
): value is GrantSetDeclaration =>
	!isTable(value) && value.declarationKind === "grant-set";

const rolesFromGrants = (
	declarations: ReadonlyArray<HejbroInput>,
): ReadonlyArray<string> =>
	declarations
		.filter(isGrantSetDeclaration)
		.flatMap((declaration) => declaration.grants.map((grant) => grant.role));

const rolesFromPolicies = (
	declarations: ReadonlyArray<HejbroInput>,
): ReadonlyArray<string> =>
	declarations
		.filter(isDeclaredTable)
		.flatMap((table) => getTableMeta(table).rls?.policies ?? [])
		.flatMap((policy) => policy.roles);

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
	[...new Set(values)].sort();

/**
 * Collects the export's carried facts from a module's loaded declarations
 * and the export name each was found under (`exportNames`, the same map
 * `generate`'s own loader already builds). A function synthesized as
 * part of a trigger definition is included — it is in the snapshot — but
 * was never itself a module export, so `exportNames` naturally holds no
 * entry for it and it carries no export name, with no separate branch
 * needed to say so.
 */
export const buildExportDescription = (
	declarations: ReadonlyArray<HejbroInput>,
	exportNames: ReadonlyMap<HejbroInput, string>,
): ExportDescription => {
	const tables = declarations
		.filter(isDeclaredTable)
		.map((table) => tableFact(table, exportNames));
	const declaredFunctions = declarations
		.filter(isFunctionDeclaration)
		.map((fn) => functionFact(fn, exportNames));
	const triggerFunctions = declarations
		.filter(isTriggerDeclaration)
		.map((trigger) => functionFact(trigger.functionDeclaration, exportNames));
	const roles = uniqueSorted([
		...rolesFromGrants(declarations),
		...rolesFromPolicies(declarations),
	]);
	return {
		tables,
		functions: [...declaredFunctions, ...triggerFunctions],
		roles,
	};
};

/**
 * Serializes an {@link ExportDescription} with the same stable
 * serialization the snapshot itself uses (`stableJson`) — one
 * determinism rule, not two.
 */
export const serializeExportDescription = (
	description: ExportDescription,
): string => stableJson(description);
