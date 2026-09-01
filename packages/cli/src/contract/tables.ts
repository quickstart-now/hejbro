import type {
	ColumnSnapshot,
	NumericMode,
	Snapshot,
	TableSnapshot,
} from "@hejbro/core";
import { columnDefault, columnGenerated, columnIdentity } from "@hejbro/core";
import type { ExportTableFact } from "../export/description";
import type { ContractEnumFact } from "./read-snapshot";
import { snapshotHasTable } from "./read-snapshot";
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
 * default, or a by-default identity), **not** an exact mirror of
 * `@hejbro/core`'s declaration-time `hasDefault` flag.
 *
 * **Known gap, documented rather than silently wrong**: a `serial`/
 * `smallserial`/`bigserial` column decomposes to its base integer type
 * before it ever reaches a snapshot (`table-kind.ts`'s own
 * `materializeTypeNode`), and its `nextval(...)` default lives on a
 * separately synthesized `sequence` object, never on the column itself
 * — so a vendored contract cannot tell such a column apart from a
 * plain `integer().notNull()` column with no default, and reads it as
 * **required** in `Insert` where the live declaration path reads it as
 * optional. No example in this repository exercises `serial` today
 * (owner-confirmed, R2-G5 5.3). Closing this gap needs a fourth sidecar
 * fact recording implied-default-ness, which is R2-G2 delta surface —
 * out of this group's scope.
 */
const hasDefault = (column: ColumnSnapshot): boolean =>
	columnDefault(column) !== null || columnIdentity(column) !== null;

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
			optional: !notNull || hasDefault(column),
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

/** One `Database["Tables"][tableName]` entry's own source text, keyed by the table's bare SQL name (the mirror is flat — no per-schema nesting, proposal.md's own "the emitted mirror is flat"). */
export const buildTableEntry = (
	table: TableSnapshot,
	fact: ExportTableFact,
	snapshot: Snapshot,
	enumLookup: EnumLookup,
): string => {
	const entries = buildColumnEntries(table, fact, enumLookup);
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
