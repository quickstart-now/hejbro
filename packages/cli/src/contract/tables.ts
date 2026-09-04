import type {
	ColumnSnapshot,
	NumericMode,
	Snapshot,
	TableSnapshot,
	TypeNode,
} from "@hejbro/core";
import { columnDefault, columnGenerated, columnIdentity } from "@hejbro/core";
import type { ExportTableFact } from "../export/description";
import type { ContractEnumFact } from "./read-snapshot";
import { columnOwnedBySequence, findTableInSnapshot } from "./read-snapshot";
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
 * (`table-kind.ts`'s `materializeTypeNode`) and its `nextval(...)`
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

/**
 * One column's full computed facts — the single source both the
 * `Database` interface's TS text and `contractMetadata`'s runtime name
 * map render from (R2-G6 6.1's own condition ②: the two must come from
 * one pass, never two independent ones that could drift). `typeNode`/
 * `mode`/`notNullElements` are carried (not just `tsType`, the rendered
 * string) because R2-G6's client needs the *structured* facts to
 * reconstruct a real column for query compilation — the exact three
 * fields `@hejbro/query`'s own `db/convert.ts` reads at runtime for row
 * conversion (array/enum/interval branches, numeric-mode decoding, the
 * array-element fail-fast guard) and nothing more (`primaryKey`/
 * `unique`/`defaultValue` never affect query compilation or row
 * conversion, so R2-G6 does not carry them — planner condition ④).
 */
type ColumnEntry = {
	readonly sqlName: string;
	readonly tsKey: string;
	readonly tsType: string;
	readonly typeNode: TypeNode;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
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
			typeNode: column.typeNode,
			mode,
			notNullElements,
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

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A type member key, quoted only when it is not a valid TS identifier
 * (#662) -- never a reserved-word list, since a reserved word (`class`,
 * `new`) is already legal unquoted as a type member/object literal key.
 * Shared by `contract/tables.ts` (`Row`/`Insert`/`Update`) and
 * `contract/functions.ts` (an argument's own key) -- the one place either
 * renderer decides whether a key needs quoting, so an identifier key's
 * own output never churns.
 */
export const renderKey = (key: string): string => {
	if (IDENTIFIER_PATTERN.test(key)) {
		return key;
	}
	return JSON.stringify(key);
};

const buildRowInterface = (entries: ReadonlyArray<ColumnEntry>): string =>
	renderInterfaceBody(
		entries.map(
			(entry) => `readonly ${renderKey(entry.tsKey)}: ${rowFieldType(entry)};`,
		),
	);

/** `Insert`'s own per-column key: absent for an ALWAYS-family column, required when `notNull` and no default, optional otherwise (mirrors `@hejbro/query`'s `insert-input.ts`). */
const buildInsertInterface = (entries: ReadonlyArray<ColumnEntry>): string =>
	renderInterfaceBody(
		entries
			.filter((entry) => !entry.alwaysGenerated)
			.map((entry) => {
				if (entry.optional) {
					return `readonly ${renderKey(entry.tsKey)}?: ${rowFieldType(entry)};`;
				}
				return `readonly ${renderKey(entry.tsKey)}: ${rowFieldType(entry)};`;
			}),
	);

/** `Update`'s own per-column key: absent for an ALWAYS-family column, optional otherwise, every value type unchanged from `Row`'s (mirrors `@hejbro/query`'s `insert-input.ts`). */
const buildUpdateInterface = (entries: ReadonlyArray<ColumnEntry>): string =>
	renderInterfaceBody(
		entries
			.filter((entry) => !entry.alwaysGenerated)
			.map(
				(entry) =>
					`readonly ${renderKey(entry.tsKey)}?: ${rowFieldType(entry)};`,
			),
	);

/**
 * One foreign key's full computed facts, target schema/name split out
 * (not re-parsed from a combined identity string later) — the single
 * source both `Relationships`' TS text and `contractMetadata`'s
 * reconstructed `foreignKeys` render from (6.1's condition ②). Absent
 * entirely for a foreign key pointing at a table the snapshot does not
 * carry (5.9), the same rule for both renderers.
 */
type RelationshipEntry = {
	readonly foreignKeyName: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesSchema: string;
	readonly referencesTable: string;
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
		.map((fk) => {
			const target = findTableInSnapshot(snapshot, fk.referencesTable);
			if (target === null) {
				return null;
			}
			return {
				foreignKeyName: fk.name,
				columns: fk.columns,
				referencesSchema: target.schema,
				referencesTable: target.name,
				referencedColumns: fk.referencesColumns,
			};
		})
		.filter((entry): entry is RelationshipEntry => entry !== null);

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
\t\t\t\treadonly referencedRelation: ${JSON.stringify(`${relationship.referencesSchema}.${relationship.referencesTable}`)};
\t\t\t\treadonly referencedColumns: readonly [${relationship.referencedColumns.map((name) => JSON.stringify(name)).join(", ")}];
\t\t\t}`,
		)
		.join(",\n");
	return `\t\treadonly Relationships: readonly [\n${entries},\n\t\t];`;
};

/**
 * One table's full computation — {@link buildColumnEntries}'s and
 * {@link buildRelationships}' own outputs, computed exactly once per
 * table and handed to both the `Database` interface renderer and the
 * `contractMetadata` renderer (6.1's condition ②, structural rather than
 * conventional: there is no second call site either renderer could drift
 * against). `existing` is read from the snapshot node here, once, for the
 * same reason (add-unmanaged-objects, 3.1) — only `contractMetadata`
 * renders it (the marker is client-metadata only, never the `Database`/
 * `Tables` interface, lead judgement), but sourcing it on this shared
 * array keeps that a rendering choice, not a second place the two
 * renderers could disagree about which tables exist.
 */
export type TableComputation = {
	readonly table: TableSnapshot;
	readonly entries: ReadonlyArray<ColumnEntry>;
	readonly relationships: ReadonlyArray<RelationshipEntry>;
	readonly existing: boolean;
};

export const computeTable = (
	table: TableSnapshot,
	fact: ExportTableFact,
	snapshot: Snapshot,
	enumLookup: EnumLookup,
): TableComputation => ({
	table,
	entries: buildColumnEntries(table, fact, snapshot, enumLookup),
	relationships: buildRelationships(table, snapshot),
	existing: table.existing === true,
});

/** One `Database["Tables"][tableName]` entry's own source text, keyed by the table's bare SQL name (the mirror is flat — no per-schema nesting, proposal.md's own "the emitted mirror is flat"). */
export const renderTableEntry = (
	computation: TableComputation,
): string => `\t${JSON.stringify(computation.table.name)}: {
\t\treadonly Row: {
${buildRowInterface(computation.entries)}
\t\t};
\t\treadonly Insert: {
${buildInsertInterface(computation.entries)}
\t\t};
\t\treadonly Update: {
${buildUpdateInterface(computation.entries)}
\t\t};
${renderRelationships(computation.relationships)}
\t};`;

/**
 * The runtime column fact `contractMetadata.tables[name].columns[tsKey]`
 * carries — exactly the three facts `@hejbro/query`'s `db/convert.ts`
 * reads at runtime (see {@link ColumnEntry}'s own doc comment), plus the
 * SQL name every clause needs to render at all.
 */
export type ContractColumnMeta = {
	readonly sqlName: string;
	readonly typeNode: TypeNode;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
};

/**
 * One column's runtime facts in the snapshot's physical order (#740/D4) —
 * {@link ContractColumnMeta} plus the TS key, carried as a plain string
 * value rather than an object-literal key: a JavaScript object's own key
 * enumeration always lists an integer-like name ahead of insertion order
 * (`Object.keys({ b: 1, "2": 1 })` → `["2", "b"]`), so the physical order
 * a table declares its columns in could never survive that shape — the
 * whole reason this is a list now, not a map. See
 * `packages/query/src/client/contract-types.ts`'s own `ContractColumnEntry`
 * (the reading side of this same shape).
 */
export type ContractColumnEntry = ContractColumnMeta & { readonly key: string };

/** The runtime fact `contractMetadata.tables[name].foreignKeys` carries — enough to reconstruct a real `ForeignKeyDeclaration` for relation-following (`@hejbro/query`'s `db/related.ts`), and nothing DDL-only (`onDelete`/`onUpdate` never affect a read). */
export type ContractForeignKeyMeta = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesSchema: string;
	readonly referencesTable: string;
	readonly referencedColumns: ReadonlyArray<string>;
};

/**
 * A table's schema-qualified SQL identity, its own physical-order column
 * list, and its foreign keys — the runtime name mapping
 * `contractMetadata.tables` carries (planner-confirmed, extended for
 * R2-G6): without it, a client would have to read `schema.json` at
 * runtime to build SQL at all, breaking the "import one file" surface
 * the contract exists to provide. Carries no value-conversion policy
 * beyond what query compilation and row conversion actually read
 * (planner condition ④) — `primaryKey`/`unique`/`defaultValue` are
 * deliberately absent. `existing` (add-unmanaged-objects, 3.1) is
 * **compact** — present (`true`) only for an existing table, absent for
 * a managed one — mirroring the snapshot's own `TableSnapshot.existing`
 * convention rather than the export description's always-present one:
 * this is generated code a person reads and diffs, so the common
 * (managed) case carries no noise (D57). No code reads this mark today;
 * it is carried for the reader of the generated file and for tooling
 * built on it.
 *
 * `columns` is a list, in the snapshot's own physical order (#740/D4) —
 * `entries` (`buildColumnEntries`) already reads `table.columns` in that
 * order, so this only ever has to stop losing it downstream, never
 * recover it. The name-keyed client reads this list to build its own
 * statements in the same order the owning repository's own client would
 * (`packages/query/src/client/synthesize.ts`'s own `columnEntries`,
 * which also still accepts the pre-#740 object-keyed map a contract
 * vendored before this shape existed carries).
 */
export type TableClientMeta = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<ContractColumnEntry>;
	readonly foreignKeys: ReadonlyArray<ContractForeignKeyMeta>;
	readonly existing?: true;
};

/** `{ existing: true }` for an existing table's client meta, else `{}` (compact, mirrors core's own `existingField`, `table-kind.ts`) — add-unmanaged-objects, 3.1. */
const clientMetaExistingField = (
	computation: TableComputation,
): Pick<TableClientMeta, "existing"> => {
	if (!computation.existing) {
		return {};
	}
	return { existing: true };
};

export const buildTableClientMeta = (
	computation: TableComputation,
): TableClientMeta => ({
	schema: computation.table.schema,
	name: computation.table.name,
	columns: computation.entries.map(
		(entry): ContractColumnEntry => ({
			key: entry.tsKey,
			sqlName: entry.sqlName,
			typeNode: entry.typeNode,
			mode: entry.mode,
			notNullElements: entry.notNullElements,
		}),
	),
	foreignKeys: computation.relationships.map((relationship) => ({
		name: relationship.foreignKeyName,
		columns: relationship.columns,
		referencesSchema: relationship.referencesSchema,
		referencesTable: relationship.referencesTable,
		referencedColumns: relationship.referencedColumns,
	})),
	...clientMetaExistingField(computation),
});
