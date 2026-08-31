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

type ManifestColumnFact = {
	readonly key: string;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
};

/**
 * Keyed by the column's SQL name (`columnName`), never by array position
 * (schema-manifest delta, `COLKEY-FINAL=by-sql-name`): a snapshot orders
 * columns physically and a declaration orders them as written, and the
 * two agree only until a column is dropped and re-added (D81 moves the
 * re-added column to the end of physical order) — a reader that joined
 * facts to columns by position would, from that point on, attach every
 * fact to the wrong column while every value still looked well-typed.
 */
type ManifestColumns = { readonly [sqlName: string]: ManifestColumnFact };

type ManifestTableFact = {
	readonly schemaName: string;
	readonly tableName: string;
	readonly exportName: string | null;
	readonly columns: ManifestColumns;
};

type ManifestFunctionFact = {
	readonly schemaName: string;
	readonly functionName: string;
	readonly exportName: string | null;
};

/**
 * The declaration-time choices a consuming repository's type layer needs
 * that neither the database nor the snapshot can supply on their own
 * (schema-manifest spec, "A manifest row carries what a database cannot
 * be asked"): a column's numeric mode, whether an array column's
 * elements are non-null, its TypeScript key, the export name of every
 * table and function, and the role names a schema's grants and policies
 * declare. Carries no `$type` brand — none exists as a runtime field on
 * `ColumnState` to carry in the first place — and no manifest/snapshot
 * format number, both of which are the manifest row's own columns
 * (core's `sql/manifest.ts`), not payload fields; duplicating them here
 * would create a second copy of the same fact for the two to disagree
 * about later. Every field is a plain, always-present JSON value —
 * `null` (never an omitted key) is how an absent export name or default
 * numeric mode reads — so the whole shape is a {@link JsonValue} without
 * a cast.
 */
export type ManifestPayload = {
	readonly tables: ReadonlyArray<ManifestTableFact>;
	readonly functions: ReadonlyArray<ManifestFunctionFact>;
	readonly roles: ReadonlyArray<string>;
};

const columnFact = (
	column: ReturnType<typeof getTableMeta>["columns"][number],
): ManifestColumnFact => ({
	key: column.columnKey,
	mode: column.columnState.mode,
	notNullElements: column.columnState.notNullElements === true,
});

const columnsBySqlName = (
	columns: ReturnType<typeof getTableMeta>["columns"],
): ManifestColumns =>
	Object.fromEntries(
		columns.map((column) => [column.columnName, columnFact(column)]),
	);

const tableFact = (
	table: DeclaredTable,
	exportNames: ReadonlyMap<HejbroInput, string>,
): ManifestTableFact => {
	const meta = getTableMeta(table);
	return {
		schemaName: meta.schema.schemaName,
		tableName: meta.tableName,
		exportName: exportNames.get(table) ?? null,
		columns: columnsBySqlName(meta.columns),
	};
};

const functionFact = (
	fn: FunctionDeclaration,
	exportNames: ReadonlyMap<HejbroInput, string>,
): ManifestFunctionFact => ({
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
 * Collects the manifest's carried facts from a module's loaded
 * declarations and the export name each was found under (3.1's
 * `exportNames`). A function synthesized as part of a trigger definition
 * is included — it is in the snapshot — but was never itself a module
 * export, so `exportNames` naturally holds no entry for it and it
 * carries no export name, with no separate branch needed to say so.
 */
export const buildManifestPayload = (
	declarations: ReadonlyArray<HejbroInput>,
	exportNames: ReadonlyMap<HejbroInput, string>,
): ManifestPayload => {
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
 * Serializes a {@link ManifestPayload} with the same stable serialization
 * the snapshot itself uses (`stableJson`) — one determinism rule, not
 * two.
 */
export const serializeManifestPayload = (payload: ManifestPayload): string =>
	stableJson(payload);
