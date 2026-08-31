import type {
	ColumnSnapshot,
	ForeignKeySnapshot,
	IdentitySnapshot,
	Snapshot,
	TableSnapshot,
	TypeNode,
} from "@hejbro/core";
import {
	columnDefault,
	columnGenerated,
	columnIdentity,
	columnNotNull,
	tableIdentity,
} from "@hejbro/core";
import type { ManifestPayload } from "../manifest-payload";
import { SYNCED_MODULE_MARKER } from "./write";

/** The manifest payload's own shape (group 3), plus the snapshot it embeds
 * (group 4) — this is what a parsed manifest row's `manifest` column
 * actually deserializes to. */
export type ManifestDocument = ManifestPayload & {
	readonly snapshot: Snapshot;
};

/** An enum type as materialized in a snapshot (`kinds/enum-kind.ts`'s own,
 * internal-only shape) — restated here rather than exported from core,
 * since core purity keeps this reader's own object-key parsing out of
 * core (owner condition on this group's core-export requests). */
type EnumSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly values: ReadonlyArray<string>;
};

/** A `Snapshot.objects` key is always `"<kind>:<identity>"` (`snapshot/snapshot.ts`'s own `buildEntry`) — split on the first colon only, since an identity can itself contain one (a schema-qualified name never does, but this stays correct if that ever changes). */
const parseObjectKey = (
	key: string,
): { readonly kind: string; readonly identity: string } => {
	const separatorIndex = key.indexOf(":");
	return {
		kind: key.slice(0, separatorIndex),
		identity: key.slice(separatorIndex + 1),
	};
};

const objectsOfKind = <T>(snapshot: Snapshot, kind: string): ReadonlyArray<T> =>
	Object.entries(snapshot.objects)
		.filter(([key]) => parseObjectKey(key).kind === kind)
		.map(([, node]) => node as T);

const tableSnapshots = (snapshot: Snapshot): ReadonlyArray<TableSnapshot> =>
	objectsOfKind<TableSnapshot>(snapshot, "table");

const enumSnapshots = (snapshot: Snapshot): ReadonlyArray<EnumSnapshot> =>
	objectsOfKind<EnumSnapshot>(snapshot, "enum");

/** `"post_status"` -> `"postStatus"` — a JS identifier for an enum's own
 * const, cosmetic only: enum export names aren't a carried manifest fact
 * (schema-manifest delta, "the export names of views, enums, schemas and
 * grants are not carried"), only their values are, so this name never
 * has to match the declaring repository's own identifier. */
const toCamelCase = (snakeCase: string): string =>
	snakeCase.replace(/_([a-z0-9])/g, (_match, char: string) =>
		char.toUpperCase(),
	);

const enumVarName = (enumSnapshot: EnumSnapshot): string =>
	toCamelCase(enumSnapshot.name);

const tableVarName = (tableFact: {
	readonly exportName: string | null;
	readonly tableName: string;
}): string => {
	if (tableFact.exportName !== null) {
		return tableFact.exportName;
	}
	return toCamelCase(tableFact.tableName);
};

const SIMPLE_FACTORY_NAMES: Readonly<Record<string, string>> = {
	uuid: "uuid",
	text: "text",
	boolean: "boolean",
	smallint: "smallint",
	integer: "integer",
	bigint: "bigint",
	real: "real",
	"double precision": "doublePrecision",
	date: "date",
	time: "time",
	timetz: "timetz",
	timestamp: "timestamp",
	timestamptz: "timestamptz",
	interval: "interval",
	json: "json",
	jsonb: "jsonb",
	bytea: "bytea",
	inet: "inet",
	cidr: "cidr",
	macaddr: "macaddr",
};

const isArrayTypeNode = (
	typeNode: TypeNode,
): typeNode is { readonly typeName: "array"; readonly element: TypeNode } =>
	typeNode.typeName === "array";

/** The non-array element type a column's own `TypeNode` reads through — itself, unless it's an `array`. */
const elementTypeNode = (typeNode: TypeNode): TypeNode => {
	if (isArrayTypeNode(typeNode)) {
		return typeNode.element;
	}
	return typeNode;
};

const numericConfigPart = (
	label: string,
	value: number | null,
): string | null => {
	if (value === null) {
		return null;
	}
	return `${label}: ${value}`;
};

const modeConfigPart = (mode: string | null): string | null => {
	if (mode === null) {
		return null;
	}
	return `mode: "${mode}"`;
};

/** The scalar (non-array) column-builder call for one element type, e.g. `uuid()`, `varchar({ length: 20 })`, `bigint({ mode: "bigint" })`, or `postStatus.column()` for an enum. `mode` is the sidecar's own carried fact (group 3) — never re-derived from the snapshot, which doesn't carry it. */
const scalarBuilderCall = (typeNode: TypeNode, mode: string | null): string => {
	if (typeNode.typeName === "varchar") {
		if (typeNode.length === null) {
			return "varchar()";
		}
		return `varchar({ length: ${typeNode.length} })`;
	}
	if (typeNode.typeName === "char") {
		return `char({ length: ${typeNode.length} })`;
	}
	if (typeNode.typeName === "numeric") {
		const parts = [
			numericConfigPart("precision", typeNode.precision),
			numericConfigPart("scale", typeNode.scale),
			modeConfigPart(mode),
		].filter((part): part is string => part !== null);
		if (parts.length === 0) {
			return "numeric()";
		}
		return `numeric({ ${parts.join(", ")} })`;
	}
	if (typeNode.typeName === "bigint" && mode !== null) {
		return `bigint({ mode: "${mode}" })`;
	}
	if (typeNode.typeName === "enum") {
		return `${toCamelCase(typeNode.enumName)}.column()`;
	}
	const factoryName = SIMPLE_FACTORY_NAMES[typeNode.typeName];
	if (factoryName === undefined) {
		throw new Error(
			`hejbro sync cannot yet reproduce a column of type "${typeNode.typeName}"`,
		);
	}
	return `${factoryName}()`;
};

const identityKindLiteral = (
	kind: IdentitySnapshot["kind"],
): "always" | "byDefault" => {
	if (kind === "by-default") {
		return "byDefault";
	}
	return "always";
};

/** Wraps a column-builder expression with the type-only write-optionality marker the snapshot's own compact fields call for (schema-manifest delta, "Write inputs follow what the database does for a column") — at most one applies, generated/identity taking precedence over a plain default exactly as `table()`'s own guard requires them to be mutually exclusive. */
const applyWriteFacts = (expr: string, column: ColumnSnapshot): string => {
	if (columnGenerated(column) !== null) {
		return `syncedGenerated(${expr})`;
	}
	const identity = columnIdentity(column);
	if (identity !== null) {
		return `syncedIdentity(${expr}, "${identityKindLiteral(identity.kind)}")`;
	}
	if (columnDefault(column) !== null) {
		return `syncedHasDefault(${expr})`;
	}
	return expr;
};

const appendArray = (expr: string, typeNode: TypeNode): string => {
	if (isArrayTypeNode(typeNode)) {
		return `${expr}.array()`;
	}
	return expr;
};

const appendNotNullElements = (
	expr: string,
	typeNode: TypeNode,
	notNullElements: boolean,
): string => {
	if (isArrayTypeNode(typeNode) && notNullElements) {
		return `${expr}.notNullElements()`;
	}
	return expr;
};

const appendNotNull = (expr: string, column: ColumnSnapshot): string => {
	if (columnNotNull(column)) {
		return `${expr}.notNull()`;
	}
	return expr;
};

/** One column's full builder expression: base type, `.array()` and `.notNullElements()` when the snapshot says so, `.notNull()` from the snapshot's own materialized flag, and finally this column's write-optionality marker, if any. */
const columnBuilderExpr = (
	column: ColumnSnapshot,
	mode: string | null,
	notNullElements: boolean,
): string => {
	const scalar = scalarBuilderCall(elementTypeNode(column.typeNode), mode);
	const arrayed = appendArray(scalar, column.typeNode);
	const elementsNotNulled = appendNotNullElements(
		arrayed,
		column.typeNode,
		notNullElements,
	);
	const notNulled = appendNotNull(elementsNotNulled, column);
	return applyWriteFacts(notNulled, column);
};

/** One declared table's context once its own line has been written — what a *later* table's own relation needs to reach it. */
type EmittedTable = {
	readonly varName: string;
	/** SQL column name -> TS key, from this group's own sidecar (group 3, `COLKEY-FINAL=by-sql-name`) — never the snapshot's physical position. */
	readonly sqlKeyByName: ReadonlyMap<string, string>;
};

/** Every single-column foreign key on `tableSnapshot`, keyed by its own (source-side) SQL column name — a multi-column foreign key has no single column to attach `.references()` to, so it's left out (the columns and the constraint stay reconstructed at the type level regardless; only the derived relation is narrower here than a full DDL reproduction would be). */
const foreignKeysBySourceColumn = (
	tableSnapshot: TableSnapshot,
): ReadonlyMap<string, ForeignKeySnapshot> => {
	const singleColumnKeys = tableSnapshot.foreignKeys.filter(
		(foreignKey) => foreignKey.columns.length === 1,
	);
	return new Map(
		singleColumnKeys.map((foreignKey) => {
			const [sourceColumn] = foreignKey.columns;
			return [sourceColumn as string, foreignKey];
		}),
	);
};

/** `.references(() => target.key)`, or `null` when the target table isn't in this manifest (schema-sync delta, "A reference to a table the schema does not own has no relation") — the column and the constraint are still reconstructed by the caller regardless; only the derived relation is absent. */
const relationSuffix = (
	foreignKey: ForeignKeySnapshot,
	emittedByIdentity: ReadonlyMap<string, EmittedTable>,
): string | null => {
	const target = emittedByIdentity.get(foreignKey.referencesTable);
	if (target === undefined) {
		return null;
	}
	const [targetSqlColumn] = foreignKey.referencesColumns;
	if (targetSqlColumn === undefined) {
		return null;
	}
	const targetKey = target.sqlKeyByName.get(targetSqlColumn);
	if (targetKey === undefined) {
		return null;
	}
	return `.references(() => ${target.varName}.${targetKey})`;
};

const appendRelation = (
	expr: string,
	sqlColumnName: string,
	foreignKeysBySource: ReadonlyMap<string, ForeignKeySnapshot>,
	emittedByIdentity: ReadonlyMap<string, EmittedTable>,
): string => {
	const foreignKey = foreignKeysBySource.get(sqlColumnName);
	if (foreignKey === undefined) {
		return expr;
	}
	const suffix = relationSuffix(foreignKey, emittedByIdentity);
	if (suffix === null) {
		return expr;
	}
	return `${expr}${suffix}`;
};

/** A table fact's own carried column facts (group 3), or an all-absent stand-in for a column the sidecar somehow doesn't carry (never expected — the sidecar is built from the exact same declaration this snapshot was — but a total function here beats a thrown one over a manifest a differently-versioned reader wrote). */
const columnFactOf = (
	tableFact: ManifestPayload["tables"][number] | undefined,
	sqlColumnName: string,
): {
	readonly key: string;
	readonly mode: string | null;
	readonly notNullElements: boolean;
} => {
	const fact = tableFact?.columns[sqlColumnName];
	if (fact === undefined) {
		return { key: sqlColumnName, mode: null, notNullElements: false };
	}
	return fact;
};

const columnSourceLine = (
	column: ColumnSnapshot,
	tableFact: ManifestPayload["tables"][number] | undefined,
	foreignKeysBySource: ReadonlyMap<string, ForeignKeySnapshot>,
	emittedByIdentity: ReadonlyMap<string, EmittedTable>,
): string => {
	const fact = columnFactOf(tableFact, column.name);
	const builderExpr = columnBuilderExpr(
		column,
		fact.mode,
		fact.notNullElements,
	);
	const withRelation = appendRelation(
		builderExpr,
		column.name,
		foreignKeysBySource,
		emittedByIdentity,
	);
	return `\t\t${fact.key}: ${withRelation},`;
};

const tableFactFor = (
	payload: ManifestPayload,
	tableSnapshot: TableSnapshot,
): ManifestPayload["tables"][number] | undefined =>
	payload.tables.find(
		(candidate) =>
			candidate.schemaName === tableSnapshot.schema &&
			candidate.tableName === tableSnapshot.name,
	);

const tableSourceLines = (
	tableSnapshot: TableSnapshot,
	payload: ManifestPayload,
	emittedByIdentity: ReadonlyMap<string, EmittedTable>,
): ReadonlyArray<string> => {
	const tableFact = tableFactFor(payload, tableSnapshot);
	const foreignKeysBySource = foreignKeysBySourceColumn(tableSnapshot);
	const varName = tableVarName({
		exportName: tableFact?.exportName ?? null,
		tableName: tableSnapshot.name,
	});
	const columnLines = tableSnapshot.columns.map((column) =>
		columnSourceLine(column, tableFact, foreignKeysBySource, emittedByIdentity),
	);
	return [
		`export const ${varName} = syncedTable(`,
		`\t"${tableSnapshot.schema}",`,
		`\t"${tableSnapshot.name}",`,
		"\t{",
		...columnLines,
		"\t},",
		");",
	];
};

const enumDeclarationLine = (enumSnapshot: EnumSnapshot): string => {
	const valuesList = enumSnapshot.values
		.map((value) => `"${value}"`)
		.join(", ");
	return `export const ${enumVarName(enumSnapshot)} = pgEnum(${enumSnapshot.schema}Schema, "${enumSnapshot.name}", [${valuesList}]);`;
};

const distinctSchemaNames = (
	enums: ReadonlyArray<EnumSnapshot>,
): ReadonlyArray<string> => [...new Set(enums.map((entry) => entry.schema))];

const schemaDeclarationLine = (schemaName: string): string =>
	`const ${schemaName}Schema = schema("${schemaName}");`;

/**
 * Builds the module source `hejbro sync` writes (5.4's own scope: table
 * and enum declarations, and nothing else — no function declaration, no
 * stamp, no role export; those are group 5's later tasks). Declaration
 * order never matters for `.references(() => …)` — it's a lazy callback,
 * evaluated only when a query actually runs, long after every `const` in
 * the module has initialized — so tables are emitted in the manifest's
 * own snapshot order and relations resolve regardless of which side
 * comes first.
 */
export const buildSyncedModuleSource = (document: ManifestDocument): string => {
	const tables = tableSnapshots(document.snapshot);
	const enums = enumSnapshots(document.snapshot);

	const emittedByIdentity = new Map<string, EmittedTable>(
		tables.map((tableSnapshot) => {
			const tableFact = tableFactFor(document, tableSnapshot);
			const varName = tableVarName({
				exportName: tableFact?.exportName ?? null,
				tableName: tableSnapshot.name,
			});
			const sqlKeyByName = new Map(
				tableSnapshot.columns.map((column) => [
					column.name,
					columnFactOf(tableFact, column.name).key,
				]),
			);
			return [
				tableIdentity(tableSnapshot.schema, tableSnapshot.name),
				{ varName, sqlKeyByName },
			];
		}),
	);

	const schemaLines = distinctSchemaNames(enums).map(schemaDeclarationLine);
	const enumLines = enums.map(enumDeclarationLine);
	const tableBlocks = tables.map((tableSnapshot) =>
		tableSourceLines(tableSnapshot, document, emittedByIdentity).join("\n"),
	);

	// Every column-builder factory this module could possibly call,
	// imported unconditionally — the generated source is not meant to be
	// hand-edited or tree-shaken, so there's no benefit to computing the
	// exact subset a given manifest happens to use, only a place a real
	// omission (like this list once had) can hide.
	const importNames = [
		...Object.values(SIMPLE_FACTORY_NAMES),
		"varchar",
		"char",
		"numeric",
		"pgEnum",
		"schema",
		"syncedGenerated",
		"syncedHasDefault",
		"syncedIdentity",
		"syncedTable",
	].sort();
	const header = [
		SYNCED_MODULE_MARKER,
		`import { ${importNames.join(", ")} } from "hejbro";`,
	];

	const blankAfter = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
		if (lines.length === 0) {
			return [];
		}
		return [...lines, ""];
	};

	return [
		...header,
		"",
		...blankAfter(schemaLines),
		...blankAfter(enumLines),
		tableBlocks.join("\n\n"),
		"",
	].join("\n");
};
