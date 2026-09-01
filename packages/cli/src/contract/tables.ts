import type {
	ColumnSnapshot,
	NumericMode,
	Snapshot,
	TableSnapshot,
} from "@hejbro/core";
import { columnDefault, columnGenerated, columnIdentity } from "@hejbro/core";
import type { ExportTableFact } from "../export/description";
import type { ContractEnumFact } from "./read-snapshot";
import { columnOwnedBySequence, snapshotHasTable } from "./read-snapshot";
import { columnTsType } from "./ts-type";

type EnumLookup = (schema: string, name: string) => ContractEnumFact | null;

export const buildEnumLookup = (
	enums: ReadonlyArray<ContractEnumFact>,
): EnumLookup => {
	const byIdentity = new Map(
		enums.map((fact) => [`${fact.schema}.${fact.name}`, fact]),
	);
	return (schema, name) => byIdentity.get(`${schema}.${name}`) ?? null;
};

/**
 * Whether Postgres refuses a client-supplied value outright — a stored
 * generated column, or an always-identity column (D100 decision 5,
 * mirrored from `@hejbro/query`'s own `insert-input.ts`). Such a column
 * gets no key at all in `Insert`/`Update`, not even an optional one.
 */
const isAlwaysGenerated = (column: ColumnSnapshot): boolean =>
	columnGenerated(column) !== null || columnIdentity(column)?.kind === "always";

/**
 * Whether Postgres fills this column in when a write omits it —
 * re-derived from what the vendored snapshot alone carries (an explicit
 * default, a by-default identity, or ownership by a synthesized
 * sequence), **not** an exact mirror of `@hejbro/core`'s declaration-time
 * `hasDefault` flag.
 *
 * **The `serial`/`smallserial`/`bigserial` case, closed without a new
 * sidecar fact (planner-confirmed, R2-G5 5.3):** such a column decomposes
 * to its base integer type before it ever reaches a snapshot
 * (`table-kind.ts`'s `materializeTypeNode`), and its `nextval(...)`
 * default lives on a separately synthesized `sequence` object rather
 * than on the column itself — but that object records its own owner
 * (`SequenceSnapshot.table`/`.column`, `sequence-kind.ts`, exported
 * specifically so a cross-reference like this one never needs its own
 * fact), so `columnOwnedBySequence` derives "the database fills this
 * in" from the snapshot exactly as the live declaration path would.
 */
const hasDefault = (
	schemaName: string,
	tableName: string,
	column: ColumnSnapshot,
	snapshot: Snapshot,
): boolean =>
	columnDefault(column) !== null ||
	columnIdentity(column) !== null ||
	columnOwnedBySequence(snapshot, schemaName, tableName, column.name);

const isColumnNotNull = (column: ColumnSnapshot): boolean =>
	column.notNull === true;

type ColumnEntry = {
	readonly sqlName: string;
	readonly tsKey: string;
	readonly tsType: string;
	readonly notNull: boolean;
	readonly alwaysGenerated: boolean;
	readonly optional: boolean;
};

const buildColumnEntries = (
	table: TableSnapshot,
	fact: ExportTableFact,
	snapshot: Snapshot,
	enumLookup: EnumLookup,
): ReadonlyArray<ColumnEntry> =>
	table.columns.map((column) => {
		const columnFact = fact.columns[column.name];
		const tsKey = columnFact?.key ?? column.name;
		const mode: NumericMode | null = columnFact?.mode ?? null;
		const notNullElements = columnFact?.notNullElements === true;
		const notNull = isColumnNotNull(column);
		const alwaysGenerated = isAlwaysGenerated(column);
		return {
			sqlName: column.name,
			tsKey,
			tsType: columnTsType(column.typeNode, mode, notNullElements, enumLookup),
			notNull,
			alwaysGenerated,
			optional:
				!notNull || hasDefault(table.schema, table.name, column, snapshot),
		};
	});

/** `Row`'s own per-column value: the base type, `| null` unless `notNull`. */
const rowFieldType = (entry: ColumnEntry): string => {
	if (entry.notNull) {
		return entry.tsType;
	}
	return `${entry.tsType} | null`;
};

const renderInterfaceBody = (lines: ReadonlyArray<string>): string =>
	lines.map((line) => `\t\t${line}`).join("\n");

const buildRowInterface = (entries: ReadonlyArray<ColumnEntry>): string =>
	renderInterfaceBody(
		entries.map((entry) => `readonly ${entry.tsKey}: ${rowFieldType(entry)};`),
	);

/** `Insert`'s own per-column key: absent for an ALWAYS-family column, required when `notNull` and no default, optional otherwise (mirrors `@hejbro/query`'s `insert-input.ts`). */
const buildInsertInterface = (entries: ReadonlyArray<ColumnEntry>): string =>
	renderInterfaceBody(
		entries
			.filter((entry) => !entry.alwaysGenerated)
			.map((entry) => {
				if (entry.optional) {
					return `readonly ${entry.tsKey}?: ${rowFieldType(entry)};`;
				}
				return `readonly ${entry.tsKey}: ${rowFieldType(entry)};`;
			}),
	);

/** `Update`'s own per-column key: absent for an ALWAYS-family column, optional otherwise, every value type unchanged from `Row`'s (mirrors `@hejbro/query`'s `insert-input.ts`). */
const buildUpdateInterface = (entries: ReadonlyArray<ColumnEntry>): string =>
	renderInterfaceBody(
		entries
			.filter((entry) => !entry.alwaysGenerated)
			.map((entry) => `readonly ${entry.tsKey}?: ${rowFieldType(entry)};`),
	);

type RelationshipEntry = {
	readonly foreignKeyName: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencedRelation: string;
	readonly referencedColumns: ReadonlyArray<string>;
};

/**
 * SQL-name-based, mirroring Supabase's own generated `Relationships`
 * array — a foreign key pointing at a table the snapshot does not carry
 * is dropped rather than guessed at (5.9, "A reference to a table the
 * schema does not own has no relation"); the column itself still
 * appears in `Row`/`Insert`/`Update` either way, untouched by this.
 */
const buildRelationships = (
	table: TableSnapshot,
	snapshot: Snapshot,
): ReadonlyArray<RelationshipEntry> =>
	table.foreignKeys
		.filter((fk) => snapshotHasTable(snapshot, fk.referencesTable))
		.map((fk) => ({
			foreignKeyName: fk.name,
			columns: fk.columns,
			referencedRelation: fk.referencesTable,
			referencedColumns: fk.referencesColumns,
		}));

const renderRelationships = (
	relationships: ReadonlyArray<RelationshipEntry>,
): string => {
	if (relationships.length === 0) {
		return "\t\treadonly Relationships: readonly [];";
	}
	const entries = relationships
		.map(
			(relationship) => `\t\t\t{
\t\t\t\treadonly foreignKeyName: ${JSON.stringify(relationship.foreignKeyName)};
\t\t\t\treadonly columns: readonly [${relationship.columns.map((name) => JSON.stringify(name)).join(", ")}];
\t\t\t\treadonly referencedRelation: ${JSON.stringify(relationship.referencedRelation)};
\t\t\t\treadonly referencedColumns: readonly [${relationship.referencedColumns.map((name) => JSON.stringify(name)).join(", ")}];
\t\t\t}`,
		)
		.join(",\n");
	return `\t\treadonly Relationships: readonly [\n${entries},\n\t\t];`;
};

export type TableIdentity = {
	readonly schemaName: string;
	readonly tableName: string;
};

/**
 * A table's schema-qualified SQL identity plus its own TS-key→SQL-name
 * column map — the runtime name mapping `contractMetadata.tables` carries
 * (planner-confirmed): without it, a consumer's client would have to
 * read `schema.json` at runtime to build SQL at all, breaking the
 * "import one file" surface the contract exists to provide. Carries no
 * value-conversion policy (numeric mode, etc.) — additive once R2-G6
 * reveals what it actually needs.
 */
export type TableNameMap = {
	readonly schema: string;
	readonly name: string;
	readonly columns: { readonly [tsKey: string]: string };
};

export const buildTableNameMap = (
	table: TableSnapshot,
	fact: ExportTableFact,
): TableNameMap => ({
	schema: table.schema,
	name: table.name,
	columns: Object.fromEntries(
		table.columns.map((column) => [
			fact.columns[column.name]?.key ?? column.name,
			column.name,
		]),
	),
});

/** One `Database["Tables"][tableName]` entry's own source text, keyed by the table's bare SQL name (the mirror is flat — no per-schema nesting, proposal.md's own "the emitted mirror is flat"). */
export const buildTableEntry = (
	table: TableSnapshot,
	fact: ExportTableFact,
	snapshot: Snapshot,
	enumLookup: EnumLookup,
): string => {
	const entries = buildColumnEntries(table, fact, snapshot, enumLookup);
	return `\t${JSON.stringify(table.name)}: {
\t\treadonly Row: {
${buildRowInterface(entries)}
\t\t};
\t\treadonly Insert: {
${buildInsertInterface(entries)}
\t\t};
\t\treadonly Update: {
${buildUpdateInterface(entries)}
\t\t};
${renderRelationships(buildRelationships(table, snapshot))}
\t};`;
};
