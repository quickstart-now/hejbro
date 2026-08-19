import type { HejbroError } from "../error";
import { hejbroError } from "../error";
import type { KindChange } from "../kind/object-kind";
import type { PolicySnapshot } from "../kinds/policy-kind";
import type { RlsSnapshot } from "../kinds/rls-kind";
import { deriveForeignKeyName, deriveIndexName } from "../kinds/table-kind";
import type {
	ForeignKeySnapshot,
	IndexSnapshot,
	TableSnapshot,
} from "../kinds/table-snapshot";
import { asTableSnapshot, tableIdentity } from "../kinds/table-snapshot";
import type { TriggerSnapshot } from "../kinds/trigger-kind";
import type { Snapshot } from "../snapshot/snapshot";
import type { JsonValue } from "../snapshot/stable-json";
import { compareKeys } from "../sort";
import {
	renderColumnRename,
	renderForeignKeyConstraintRename,
	renderIndexRename,
	renderTableRename,
} from "../sql/rename-sql";

/** A `--rename <schema>.<table>.<old>=<new>` (column) flag, parsed into pure data. */
export type ColumnRenameSpec = {
	readonly target: "column";
	readonly schemaName: string;
	readonly tableName: string;
	readonly oldName: string;
	readonly newName: string;
};

/** A `--rename <schema>.<old>=<new>` (table) flag, parsed into pure data. */
export type TableRenameSpec = {
	readonly target: "table";
	readonly schemaName: string;
	readonly oldName: string;
	readonly newName: string;
};

/** @see ColumnRenameSpec, TableRenameSpec */
export type RenameSpec = ColumnRenameSpec | TableRenameSpec;

/** A `--confirm-drop` flag (column- or table-level), parsed into pure data. */
export type ConfirmDropSpec =
	| {
			readonly target: "column";
			readonly schemaName: string;
			readonly tableName: string;
			readonly columnName: string;
	  }
	| {
			readonly target: "table";
			readonly schemaName: string;
			readonly tableName: string;
	  };

/** The result of resolving a set of `--rename`/`--confirm-drop` flags against a previous→next snapshot pair (decision D32/rule A). */
export type RenamePlan = {
	/** previous snapshot with confirmed renames applied (old→new names) */
	readonly rewrittenPrevious: Snapshot;
	/** `alter table … rename …` statements, identity-ordered, emitted first */
	readonly renameStatements: ReadonlyArray<string>;
	/** synthetic banner-only changes, e.g. `~ table app.posts [column slug renamed to handle]` */
	readonly renameChanges: ReadonlyArray<KindChange>;
	/** batch-collected diagnostics; non-empty ⇒ caller must not emit SQL */
	readonly errors: ReadonlyArray<HejbroError>;
};

const TABLE_PREFIX = "table:";
const RLS_PREFIX = "rls:";
const POLICY_PREFIX = "policy:";
const TRIGGER_PREFIX = "trigger:";

type ObjectsRecord = Snapshot["objects"];

const entriesWithPrefix = (
	objects: ObjectsRecord,
	prefix: string,
): ReadonlyArray<readonly [string, JsonValue]> =>
	Object.entries(objects).filter(([key]) => key.startsWith(prefix));

const tableEntries = (
	objects: ObjectsRecord,
): ReadonlyMap<string, TableSnapshot> =>
	new Map(
		entriesWithPrefix(objects, TABLE_PREFIX).map(([key, node]) => [
			key.slice(TABLE_PREFIX.length),
			asTableSnapshot(node),
		]),
	);

type NameSets = {
	readonly dropped: ReadonlySet<string>;
	readonly added: ReadonlySet<string>;
};

/** Per-schema dropped/added table-name sets (raw — before any rename/confirm-drop resolution). */
type SchemaTableSets = ReadonlyMap<string, NameSets>;

/** Per-table (identity `schema.table`, present in both snapshots) dropped/added column-name sets. */
type TableColumnSets = ReadonlyMap<string, NameSets>;

/** Every value of `source` not present in `remove`. */
const setDifference = (
	source: ReadonlySet<string>,
	remove: ReadonlySet<string>,
): ReadonlySet<string> =>
	new Set(Array.from(source).filter((value) => !remove.has(value)));

const computeSchemaTableSets = (
	previousTables: ReadonlyMap<string, TableSnapshot>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
): SchemaTableSets => {
	const schemaNames = new Set([
		...Array.from(previousTables.values(), (t) => t.schema),
		...Array.from(nextTables.values(), (t) => t.schema),
	]);
	return new Map(
		Array.from(schemaNames).map((schemaName) => {
			const previousNames = new Set(
				Array.from(previousTables.values())
					.filter((t) => t.schema === schemaName)
					.map((t) => t.name),
			);
			const nextNames = new Set(
				Array.from(nextTables.values())
					.filter((t) => t.schema === schemaName)
					.map((t) => t.name),
			);
			return [
				schemaName,
				{
					dropped: setDifference(previousNames, nextNames),
					added: setDifference(nextNames, previousNames),
				},
			] as const;
		}),
	);
};

/**
 * Every valid table-rename candidate (schema-level dropped/added check
 * only — duplicates aren't resolved yet), `oldIdentity → newIdentity`. Used
 * only to *pair* tables for column-set computation below; applying the
 * rename still goes through the full `partitionRenameSpecs` validation.
 */
const tableRenamePairings = (
	renames: ReadonlyArray<RenameSpec>,
	schemaTableSets: SchemaTableSets,
): ReadonlyMap<string, string> => {
	const candidates = renames.filter(
		(spec): spec is TableRenameSpec => spec.target === "table",
	);
	const valid = candidates.filter((spec) => {
		const sets = schemaTableSets.get(spec.schemaName);
		return (
			(sets?.dropped.has(spec.oldName) ?? false) &&
			(sets?.added.has(spec.newName) ?? false)
		);
	});
	return new Map(
		valid.map((spec) => [
			tableIdentity(spec.schemaName, spec.oldName),
			tableIdentity(spec.schemaName, spec.newName),
		]),
	);
};

/**
 * Per-table dropped/added column-name sets, keyed by the table's *previous*
 * identity — for tables unchanged by name (same identity in both
 * snapshots) and for tables paired by a valid `--rename` table spec (M1
 * fix: without this pairing, a table-rename+column-change combo would miss
 * rule A's ambiguity check entirely, and any accompanying column spec would
 * be rejected as `unknown-rename-target` since its table never appeared to
 * have changed columns).
 */
const computeTableColumnSets = (
	previousTables: ReadonlyMap<string, TableSnapshot>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
	renamedPairings: ReadonlyMap<string, string>,
): TableColumnSets => {
	const columnSetEntry = (
		oldIdentity: string,
		nextIdentity: string,
	): readonly [string, NameSets] | null => {
		const previousTable = previousTables.get(oldIdentity);
		const nextTable = nextTables.get(nextIdentity);
		if (previousTable === undefined || nextTable === undefined) {
			return null;
		}
		const previousNames = new Set(previousTable.columns.map((c) => c.name));
		const nextNames = new Set(nextTable.columns.map((c) => c.name));
		return [
			oldIdentity,
			{
				dropped: setDifference(previousNames, nextNames),
				added: setDifference(nextNames, previousNames),
			},
		];
	};

	const unchangedEntries = Array.from(previousTables.keys())
		.filter((identity) => nextTables.has(identity))
		.map((identity) => columnSetEntry(identity, identity));
	const renamedEntries = Array.from(renamedPairings.entries()).map(
		([oldIdentity, newIdentity]) => columnSetEntry(oldIdentity, newIdentity),
	);

	return new Map(
		[...unchangedEntries, ...renamedEntries].filter(
			(entry): entry is readonly [string, NameSets] => entry !== null,
		),
	);
};

// --- Step 2: validation -----------------------------------------------

/**
 * One spec's claim on an old or new name — grouped by `groupKey` (which
 * encodes target kind, scope, direction, and name) to find two specs that
 * claim the same identifier. Carries enough to render a human-readable
 * message (never a raw internal key — m3 fix).
 */
type Claim = {
	readonly groupKey: string;
	readonly targetKind: "column" | "table";
	readonly schemaName: string;
	readonly tableName: string | null;
	readonly direction: "old" | "new";
	readonly name: string;
	readonly specIndex: number;
};

const specClaims = (
	spec: RenameSpec,
	specIndex: number,
): ReadonlyArray<Claim> => {
	if (spec.target === "column") {
		const scope = tableIdentity(spec.schemaName, spec.tableName);
		return [
			{
				groupKey: `column-old:${scope}:${spec.oldName}`,
				targetKind: "column",
				schemaName: spec.schemaName,
				tableName: spec.tableName,
				direction: "old",
				name: spec.oldName,
				specIndex,
			},
			{
				groupKey: `column-new:${scope}:${spec.newName}`,
				targetKind: "column",
				schemaName: spec.schemaName,
				tableName: spec.tableName,
				direction: "new",
				name: spec.newName,
				specIndex,
			},
		];
	}
	return [
		{
			groupKey: `table-old:${spec.schemaName}:${spec.oldName}`,
			targetKind: "table",
			schemaName: spec.schemaName,
			tableName: null,
			direction: "old",
			name: spec.oldName,
			specIndex,
		},
		{
			groupKey: `table-new:${spec.schemaName}:${spec.newName}`,
			targetKind: "table",
			schemaName: spec.schemaName,
			tableName: null,
			direction: "new",
			name: spec.newName,
			specIndex,
		},
	];
};

const groupClaims = (
	claims: ReadonlyArray<Claim>,
): ReadonlyMap<string, ReadonlyArray<Claim>> =>
	claims.reduce((acc, claim) => {
		const existing = acc.get(claim.groupKey) ?? [];
		acc.set(claim.groupKey, [...existing, claim]);
		return acc;
	}, new Map<string, ReadonlyArray<Claim>>());

/** Human-readable description of what a claim targets — never the raw internal `groupKey` (m3 fix). */
const describeClaim = (claim: Claim): string => {
	if (claim.targetKind === "column") {
		const identity = tableIdentity(claim.schemaName, claim.tableName ?? "");
		if (claim.direction === "old") {
			return `old column name "${claim.name}" on "${identity}"`;
		}
		return `new column name "${claim.name}" on "${identity}"`;
	}
	if (claim.direction === "old") {
		return `old table name "${claim.name}" in schema "${claim.schemaName}"`;
	}
	return `new table name "${claim.name}" in schema "${claim.schemaName}"`;
};

const describeFirstClaim = (claims: ReadonlyArray<Claim>): string => {
	const [first] = claims;
	if (first === undefined) {
		return "an identifier";
	}
	return describeClaim(first);
};

const duplicateCountPhrase = (count: number): string => {
	if (count === 2) {
		return "two --rename flags both target";
	}
	return `${count} --rename flags all target`;
};

const findDuplicateRenameSpecs = (
	renames: ReadonlyArray<RenameSpec>,
): {
	readonly duplicatedIndices: ReadonlySet<number>;
	readonly errors: ReadonlyArray<HejbroError>;
} => {
	const grouped = groupClaims(
		renames.flatMap((spec, index) => specClaims(spec, index)),
	);
	const duplicateGroups = Array.from(grouped.entries())
		.filter(([, claims]) => new Set(claims.map((c) => c.specIndex)).size > 1)
		.sort((a, b) => compareKeys(a[0], b[0]));
	const duplicatedIndices = new Set(
		duplicateGroups.flatMap(([, claims]) => claims.map((c) => c.specIndex)),
	);
	const errors = duplicateGroups.map(([, claims]) => {
		const count = new Set(claims.map((c) => c.specIndex)).size;
		const target = describeFirstClaim(claims);
		return hejbroError(
			"duplicate-rename-target",
			`${duplicateCountPhrase(count)} the same ${target} — each old or new name may appear in at most one --rename flag per generate run. Next: keep a single --rename flag per identifier and rerun.`,
		);
	});
	return { duplicatedIndices, errors };
};

const validateRenameSpecTarget = (
	spec: RenameSpec,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): HejbroError | null => {
	if (spec.target === "table") {
		const sets = schemaTableSets.get(spec.schemaName);
		const isValid =
			(sets?.dropped.has(spec.oldName) ?? false) &&
			(sets?.added.has(spec.newName) ?? false);
		if (isValid) {
			return null;
		}
		const declaredAt =
			declaredAtByIdentity.get(tableIdentity(spec.schemaName, spec.newName)) ??
			null;
		return hejbroError(
			"unknown-rename-target",
			`--rename ${spec.schemaName}.${spec.oldName}=${spec.newName} does not match a dropped table "${spec.oldName}" and a newly-added table "${spec.newName}" in schema "${spec.schemaName}" for this generate run. Next: check the table names, or drop the --rename flag if nothing changed here.`,
			declaredAt,
		);
	}
	const identity = tableIdentity(spec.schemaName, spec.tableName);
	const sets = tableColumnSets.get(identity);
	const isValid =
		(sets?.dropped.has(spec.oldName) ?? false) &&
		(sets?.added.has(spec.newName) ?? false);
	if (isValid) {
		return null;
	}
	const declaredAt = declaredAtByIdentity.get(identity) ?? null;
	return hejbroError(
		"unknown-rename-target",
		`--rename ${spec.schemaName}.${spec.tableName}.${spec.oldName}=${spec.newName} does not match a dropped column "${spec.oldName}" and a newly-added column "${spec.newName}" on "${identity}" for this generate run. Next: check the column names, or drop the --rename flag if nothing changed here.`,
		declaredAt,
	);
};

const partitionRenameSpecs = (
	renames: ReadonlyArray<RenameSpec>,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): {
	readonly validSpecs: ReadonlyArray<RenameSpec>;
	readonly errors: ReadonlyArray<HejbroError>;
} => {
	const { duplicatedIndices, errors: duplicateErrors } =
		findDuplicateRenameSpecs(renames);
	const targetErrorOf = (spec: RenameSpec): HejbroError | null =>
		validateRenameSpecTarget(
			spec,
			schemaTableSets,
			tableColumnSets,
			declaredAtByIdentity,
		);
	const targetErrorUnlessDuplicated = (
		spec: RenameSpec,
		index: number,
	): HejbroError | null => {
		if (duplicatedIndices.has(index)) {
			return null;
		}
		return targetErrorOf(spec);
	};
	const targetErrors = renames
		.map((spec, index) => targetErrorUnlessDuplicated(spec, index))
		.filter((error): error is HejbroError => error !== null);
	const validSpecs = renames.filter(
		(spec, index) =>
			!duplicatedIndices.has(index) && targetErrorOf(spec) === null,
	);
	return { validSpecs, errors: [...duplicateErrors, ...targetErrors] };
};

const validateConfirmDropTarget = (
	spec: ConfirmDropSpec,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
): HejbroError | null => {
	if (spec.target === "table") {
		const sets = schemaTableSets.get(spec.schemaName);
		if (sets?.dropped.has(spec.tableName) ?? false) {
			return null;
		}
		return hejbroError(
			"unknown-confirm-drop-target",
			`--confirm-drop ${spec.schemaName}.${spec.tableName} does not match a dropped table in this generate run. Next: check the table name, or drop the --confirm-drop flag if nothing changed here.`,
		);
	}
	const identity = tableIdentity(spec.schemaName, spec.tableName);
	const sets = tableColumnSets.get(identity);
	if (sets?.dropped.has(spec.columnName) ?? false) {
		return null;
	}
	return hejbroError(
		"unknown-confirm-drop-target",
		`--confirm-drop ${spec.schemaName}.${spec.tableName}.${spec.columnName} does not match a dropped column on "${identity}" in this generate run. Next: check the column name, or drop the --confirm-drop flag if nothing changed here.`,
	);
};

const partitionConfirmDrops = (
	confirmedDrops: ReadonlyArray<ConfirmDropSpec>,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
): {
	readonly validDrops: ReadonlyArray<ConfirmDropSpec>;
	readonly errors: ReadonlyArray<HejbroError>;
} => {
	const errorOf = (spec: ConfirmDropSpec): HejbroError | null =>
		validateConfirmDropTarget(spec, schemaTableSets, tableColumnSets);
	const errors = confirmedDrops
		.map((spec) => errorOf(spec))
		.filter((error): error is HejbroError => error !== null);
	const validDrops = confirmedDrops.filter((spec) => errorOf(spec) === null);
	return { validDrops, errors };
};

// --- Steps 3+4: apply valid renames, rewriting `previous` --------------

type RewriteState = {
	readonly objects: ObjectsRecord;
	readonly statements: ReadonlyArray<string>;
	readonly changes: ReadonlyArray<KindChange>;
	/** `schema.oldName` → current name, accumulated across applied table renames. */
	readonly tableNameByOldKey: ReadonlyMap<string, string>;
};

const getObject = (
	objects: ObjectsRecord,
	key: string,
): JsonValue | undefined => objects[key];

const withoutKey = (objects: ObjectsRecord, key: string): ObjectsRecord => {
	const { [key]: _removed, ...rest } = objects;
	return rest;
};

const setKey = (
	objects: ObjectsRecord,
	key: string,
	value: JsonValue,
): ObjectsRecord => ({
	...objects,
	[key]: value,
});

/** Renames the trailing `schema.oldTable` occurrence in a `rls`/`policy`/`trigger` key to `schema.newTable`. */
const rekeyTableScopedIdentity = (
	key: string,
	prefix: string,
	schemaName: string,
	oldTableName: string,
	newTableName: string,
): string | null => {
	const oldPrefix = `${prefix}${tableIdentity(schemaName, oldTableName)}`;
	if (key !== oldPrefix && !key.startsWith(`${oldPrefix}.`)) {
		return null;
	}
	return `${prefix}${tableIdentity(schemaName, newTableName)}${key.slice(oldPrefix.length)}`;
};

type DependentKind = {
	readonly prefix: string;
	readonly setTable: (node: JsonValue, table: string) => JsonValue;
};

const dependentKinds: ReadonlyArray<DependentKind> = [
	{
		prefix: RLS_PREFIX,
		setTable: (node, table) => ({ ...(node as RlsSnapshot), table }),
	},
	{
		prefix: POLICY_PREFIX,
		setTable: (node, table) => ({ ...(node as PolicySnapshot), table }),
	},
	{
		prefix: TRIGGER_PREFIX,
		setTable: (node, table) => ({ ...(node as TriggerSnapshot), table }),
	},
];

/** Re-keys every `rls`/`policy`/`trigger` entry scoped to the renamed table, updating both its objects key and its `table` field. */
const rekeyDependentIdentities = (
	objects: ObjectsRecord,
	schemaName: string,
	oldTableName: string,
	newTableName: string,
): ObjectsRecord =>
	dependentKinds.reduce((acc, dependent) => {
		const matches = entriesWithPrefix(acc, dependent.prefix).flatMap(
			([key, node]) => {
				const newKey = rekeyTableScopedIdentity(
					key,
					dependent.prefix,
					schemaName,
					oldTableName,
					newTableName,
				);
				if (newKey === null) {
					return [];
				}
				return [{ oldKey: key, newKey, node }];
			},
		);
		return matches.reduce(
			(inner, match) =>
				setKey(
					withoutKey(inner, match.oldKey),
					match.newKey,
					dependent.setTable(match.node, newTableName),
				),
			acc,
		);
	}, objects);

const renameIfMatches = (
	value: string,
	oldName: string,
	newName: string,
): string => {
	if (value !== oldName) {
		return value;
	}
	return newName;
};

const retargetForeignKey = (
	foreignKey: ForeignKeySnapshot,
	oldIdentity: string,
	newIdentity: string,
): ForeignKeySnapshot => {
	if (foreignKey.referencesTable !== oldIdentity) {
		return foreignKey;
	}
	return { ...foreignKey, referencesTable: newIdentity };
};

/** Rewrites every other table's foreign keys pointing at `oldIdentity` to point at `newIdentity` (node only — Postgres tracks FK targets by OID). */
const rewriteForeignKeyTargets = (
	objects: ObjectsRecord,
	oldIdentity: string,
	newIdentity: string,
): ObjectsRecord =>
	entriesWithPrefix(objects, TABLE_PREFIX).reduce((acc, [key, node]) => {
		const tableSnapshot = asTableSnapshot(node);
		const hasMatch = tableSnapshot.foreignKeys.some(
			(foreignKey) => foreignKey.referencesTable === oldIdentity,
		);
		if (!hasMatch) {
			return acc;
		}
		const rewrittenForeignKeys = tableSnapshot.foreignKeys.map((foreignKey) =>
			retargetForeignKey(foreignKey, oldIdentity, newIdentity),
		);
		return setKey(acc, key, {
			...tableSnapshot,
			foreignKeys: rewrittenForeignKeys,
		});
	}, objects);

const retargetForeignKeyReferenceColumn = (
	foreignKey: ForeignKeySnapshot,
	identity: string,
	oldColumnName: string,
	newColumnName: string,
): ForeignKeySnapshot => {
	if (foreignKey.referencesTable !== identity) {
		return foreignKey;
	}
	if (!foreignKey.referencesColumns.includes(oldColumnName)) {
		return foreignKey;
	}
	return {
		...foreignKey,
		referencesColumns: foreignKey.referencesColumns.map((column) =>
			renameIfMatches(column, oldColumnName, newColumnName),
		),
	};
};

/** Rewrites every other table's foreign keys' `referencesColumns` entry for a renamed column of `identity`. */
const rewriteForeignKeyReferenceColumn = (
	objects: ObjectsRecord,
	identity: string,
	oldColumnName: string,
	newColumnName: string,
): ObjectsRecord =>
	entriesWithPrefix(objects, TABLE_PREFIX).reduce((acc, [key, node]) => {
		const tableSnapshot = asTableSnapshot(node);
		const hasMatch = tableSnapshot.foreignKeys.some(
			(foreignKey) =>
				foreignKey.referencesTable === identity &&
				foreignKey.referencesColumns.includes(oldColumnName),
		);
		if (!hasMatch) {
			return acc;
		}
		const rewrittenForeignKeys = tableSnapshot.foreignKeys.map((foreignKey) =>
			retargetForeignKeyReferenceColumn(
				foreignKey,
				identity,
				oldColumnName,
				newColumnName,
			),
		);
		return setKey(acc, key, {
			...tableSnapshot,
			foreignKeys: rewrittenForeignKeys,
		});
	}, objects);

// --- table-node level index/FK rewriting -------------------------------

const renameColumnInList = (
	columns: ReadonlyArray<string>,
	oldName: string,
	newName: string,
): ReadonlyArray<string> =>
	columns.map((column) => renameIfMatches(column, oldName, newName));

/** `entry.columns` renamed for a column-rename spec, or unchanged for a table-rename spec (`oldColumnName`/`newColumnName` both `null`). */
const resolveRenamedColumns = (
	columns: ReadonlyArray<string>,
	oldColumnName: string | null,
	newColumnName: string | null,
): ReadonlyArray<string> => {
	if (oldColumnName === null || newColumnName === null) {
		return columns;
	}
	return renameColumnInList(columns, oldColumnName, newColumnName);
};

/** Rewrites one table's indexes for either a table rename (new table name, unchanged columns) or a column rename (unchanged table name, one renamed column) — synthesizing derived-name rename statements only for names that were actually `derive(...)`-generated (algorithm step 4). */
const rewriteIndexesForRename = (
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	oldColumnName: string | null,
	newColumnName: string | null,
	indexes: ReadonlyArray<IndexSnapshot>,
): {
	readonly indexes: ReadonlyArray<IndexSnapshot>;
	readonly statements: ReadonlyArray<string>;
} => {
	const sorted = [...indexes].sort((a, b) => compareKeys(a.name, b.name));
	const rewritten = sorted.map((entry) => {
		const oldDerivedName = deriveIndexName(oldTableName, entry.columns);
		const newColumns = resolveRenamedColumns(
			entry.columns,
			oldColumnName,
			newColumnName,
		);
		const wasDerived = entry.name === oldDerivedName;
		if (!wasDerived) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		const newDerivedName = deriveIndexName(newTableName, newColumns);
		if (newDerivedName === entry.name) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		return {
			entry: { ...entry, name: newDerivedName, columns: newColumns },
			statement: renderIndexRename(schemaName, entry.name, newDerivedName),
		};
	});
	return {
		indexes: rewritten.map((r) => r.entry),
		statements: rewritten
			.map((r) => r.statement)
			.filter((s): s is string => s !== null),
	};
};

/** @see rewriteIndexesForRename — the foreign-key counterpart (`rename constraint`, current/new table name). */
const rewriteForeignKeysForRename = (
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	oldColumnName: string | null,
	newColumnName: string | null,
	foreignKeys: ReadonlyArray<ForeignKeySnapshot>,
): {
	readonly foreignKeys: ReadonlyArray<ForeignKeySnapshot>;
	readonly statements: ReadonlyArray<string>;
} => {
	const sorted = [...foreignKeys].sort((a, b) => compareKeys(a.name, b.name));
	const rewritten = sorted.map((entry) => {
		const oldDerivedName = deriveForeignKeyName(oldTableName, entry.columns);
		const newColumns = resolveRenamedColumns(
			entry.columns,
			oldColumnName,
			newColumnName,
		);
		const wasDerived = entry.name === oldDerivedName;
		if (!wasDerived) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		const newDerivedName = deriveForeignKeyName(newTableName, newColumns);
		if (newDerivedName === entry.name) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		return {
			entry: { ...entry, name: newDerivedName, columns: newColumns },
			statement: renderForeignKeyConstraintRename(
				schemaName,
				newTableName,
				entry.name,
				newDerivedName,
			),
		};
	});
	return {
		foreignKeys: rewritten.map((r) => r.entry),
		statements: rewritten
			.map((r) => r.statement)
			.filter((s): s is string => s !== null),
	};
};

const applyTableRename = (
	state: RewriteState,
	spec: TableRenameSpec,
): RewriteState => {
	const oldIdentity = tableIdentity(spec.schemaName, spec.oldName);
	const newIdentity = tableIdentity(spec.schemaName, spec.newName);
	const oldKey = `${TABLE_PREFIX}${oldIdentity}`;
	const raw = getObject(state.objects, oldKey);
	if (raw === undefined) {
		return state;
	}
	const tableSnapshot = asTableSnapshot(raw);

	const indexResult = rewriteIndexesForRename(
		spec.schemaName,
		spec.oldName,
		spec.newName,
		null,
		null,
		tableSnapshot.indexes,
	);
	const foreignKeyResult = rewriteForeignKeysForRename(
		spec.schemaName,
		spec.oldName,
		spec.newName,
		null,
		null,
		tableSnapshot.foreignKeys,
	);

	const renamedNode: TableSnapshot = {
		...tableSnapshot,
		name: spec.newName,
		indexes: indexResult.indexes,
		foreignKeys: foreignKeyResult.foreignKeys,
	};

	const withoutOld = withoutKey(state.objects, oldKey);
	const withNewTable = setKey(
		withoutOld,
		`${TABLE_PREFIX}${newIdentity}`,
		renamedNode,
	);
	const withDependents = rekeyDependentIdentities(
		withNewTable,
		spec.schemaName,
		spec.oldName,
		spec.newName,
	);
	const withForeignKeyTargets = rewriteForeignKeyTargets(
		withDependents,
		oldIdentity,
		newIdentity,
	);

	const change: KindChange = {
		kind: "table",
		operation: "alter",
		identity: oldIdentity,
		previous: null,
		next: null,
		notes: [`renamed to "${spec.newName}"`],
	};

	return {
		objects: withForeignKeyTargets,
		statements: [
			...state.statements,
			renderTableRename(spec),
			...indexResult.statements,
			...foreignKeyResult.statements,
		],
		changes: [...state.changes, change],
		tableNameByOldKey: new Map([
			...state.tableNameByOldKey,
			[oldIdentity, spec.newName],
		]),
	};
};

const applyColumnRename = (
	state: RewriteState,
	spec: ColumnRenameSpec,
): RewriteState => {
	const effectiveTableName =
		state.tableNameByOldKey.get(
			tableIdentity(spec.schemaName, spec.tableName),
		) ?? spec.tableName;
	const identity = tableIdentity(spec.schemaName, effectiveTableName);
	const key = `${TABLE_PREFIX}${identity}`;
	const raw = getObject(state.objects, key);
	if (raw === undefined) {
		return state;
	}
	const tableSnapshot = asTableSnapshot(raw);

	const rewrittenColumns = tableSnapshot.columns.map((column) => {
		if (column.name !== spec.oldName) {
			return column;
		}
		return { ...column, name: spec.newName };
	});
	const indexResult = rewriteIndexesForRename(
		spec.schemaName,
		effectiveTableName,
		effectiveTableName,
		spec.oldName,
		spec.newName,
		tableSnapshot.indexes,
	);
	const foreignKeyResult = rewriteForeignKeysForRename(
		spec.schemaName,
		effectiveTableName,
		effectiveTableName,
		spec.oldName,
		spec.newName,
		tableSnapshot.foreignKeys,
	);

	const renamedNode: TableSnapshot = {
		...tableSnapshot,
		columns: rewrittenColumns,
		indexes: indexResult.indexes,
		foreignKeys: foreignKeyResult.foreignKeys,
	};

	const withTable = setKey(state.objects, key, renamedNode);
	const withForeignKeyReferences = rewriteForeignKeyReferenceColumn(
		withTable,
		identity,
		spec.oldName,
		spec.newName,
	);

	const change: KindChange = {
		kind: "table",
		operation: "alter",
		identity,
		previous: null,
		next: null,
		notes: [`column "${spec.oldName}" renamed to "${spec.newName}"`],
	};

	return {
		objects: withForeignKeyReferences,
		statements: [
			...state.statements,
			renderColumnRename({ ...spec, tableName: effectiveTableName }),
			...indexResult.statements,
			...foreignKeyResult.statements,
		],
		changes: [...state.changes, change],
		tableNameByOldKey: state.tableNameByOldKey,
	};
};

/** A rename spec's target identity, for deterministic (compareKeys) ordering — independent of argv input order. */
const renameSpecTargetIdentity = (spec: RenameSpec): string => {
	if (spec.target === "table") {
		return `${tableIdentity(spec.schemaName, spec.oldName)}`;
	}
	return `${tableIdentity(spec.schemaName, spec.tableName)}.${spec.oldName}`;
};

const applyRenameSpecs = (
	objects: ObjectsRecord,
	validSpecs: ReadonlyArray<RenameSpec>,
): {
	readonly objects: ObjectsRecord;
	readonly statements: ReadonlyArray<string>;
	readonly changes: ReadonlyArray<KindChange>;
} => {
	const byTargetIdentity = (a: RenameSpec, b: RenameSpec): number =>
		compareKeys(renameSpecTargetIdentity(a), renameSpecTargetIdentity(b));
	const tableRenames = validSpecs
		.filter((spec): spec is TableRenameSpec => spec.target === "table")
		.sort(byTargetIdentity);
	const columnRenames = validSpecs
		.filter((spec): spec is ColumnRenameSpec => spec.target === "column")
		.sort(byTargetIdentity);

	const initial: RewriteState = {
		objects,
		statements: [],
		changes: [],
		tableNameByOldKey: new Map(),
	};

	const afterTableRenames = tableRenames.reduce(applyTableRename, initial);
	const afterColumnRenames = columnRenames.reduce(
		applyColumnRename,
		afterTableRenames,
	);

	return {
		objects: afterColumnRenames.objects,
		statements: afterColumnRenames.statements,
		changes: afterColumnRenames.changes,
	};
};

// --- Step 5: residual ambiguity ----------------------------------------

const consumedColumnNamesByTable = (
	validSpecs: ReadonlyArray<RenameSpec>,
	validDrops: ReadonlyArray<ConfirmDropSpec>,
): ReadonlyMap<
	string,
	{ readonly dropped: ReadonlySet<string>; readonly added: ReadonlySet<string> }
> => {
	const columnRenames = validSpecs.filter(
		(spec): spec is ColumnRenameSpec => spec.target === "column",
	);
	const entries = [
		...columnRenames.map((spec) => ({
			identity: tableIdentity(spec.schemaName, spec.tableName),
			dropped: spec.oldName,
			added: spec.newName,
		})),
		...validDrops
			.filter(
				(spec): spec is Extract<ConfirmDropSpec, { target: "column" }> =>
					spec.target === "column",
			)
			.map((spec) => ({
				identity: tableIdentity(spec.schemaName, spec.tableName),
				dropped: spec.columnName,
				added: null,
			})),
	];
	return entries.reduce((acc, entry) => {
		const existing = acc.get(entry.identity) ?? {
			dropped: new Set<string>(),
			added: new Set<string>(),
		};
		const dropped = new Set(existing.dropped);
		dropped.add(entry.dropped);
		const added = new Set(existing.added);
		if (entry.added !== null) {
			added.add(entry.added);
		}
		acc.set(entry.identity, { dropped, added });
		return acc;
	}, new Map<string, { dropped: Set<string>; added: Set<string> }>());
};

const consumedTableNamesBySchema = (
	validSpecs: ReadonlyArray<RenameSpec>,
	validDrops: ReadonlyArray<ConfirmDropSpec>,
): ReadonlyMap<
	string,
	{ readonly dropped: ReadonlySet<string>; readonly added: ReadonlySet<string> }
> => {
	const tableRenames = validSpecs.filter(
		(spec): spec is TableRenameSpec => spec.target === "table",
	);
	const entries = [
		...tableRenames.map((spec) => ({
			schemaName: spec.schemaName,
			dropped: spec.oldName,
			added: spec.newName,
		})),
		...validDrops
			.filter(
				(spec): spec is Extract<ConfirmDropSpec, { target: "table" }> =>
					spec.target === "table",
			)
			.map((spec) => ({
				schemaName: spec.schemaName,
				dropped: spec.tableName,
				added: null,
			})),
	];
	return entries.reduce((acc, entry) => {
		const existing = acc.get(entry.schemaName) ?? {
			dropped: new Set<string>(),
			added: new Set<string>(),
		};
		const dropped = new Set(existing.dropped);
		dropped.add(entry.dropped);
		const added = new Set(existing.added);
		if (entry.added !== null) {
			added.add(entry.added);
		}
		acc.set(entry.schemaName, { dropped, added });
		return acc;
	}, new Map<string, { dropped: Set<string>; added: Set<string> }>());
};

const residualColumnAmbiguities = (
	tableColumnSets: TableColumnSets,
	consumed: ReadonlyMap<
		string,
		{
			readonly dropped: ReadonlySet<string>;
			readonly added: ReadonlySet<string>;
		}
	>,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): ReadonlyArray<HejbroError> =>
	Array.from(tableColumnSets.entries())
		.sort((a, b) => compareKeys(a[0], b[0]))
		.flatMap(([identity, sets]) => {
			const consumedSets = consumed.get(identity) ?? {
				dropped: new Set<string>(),
				added: new Set<string>(),
			};
			const residualDropped = setDifference(sets.dropped, consumedSets.dropped);
			const residualAdded = setDifference(sets.added, consumedSets.added);
			if (residualDropped.size === 0 || residualAdded.size === 0) {
				return [];
			}
			const declaredAt = declaredAtByIdentity.get(identity) ?? null;
			return [
				hejbroError(
					"ambiguous-column-rename",
					`table "${identity}" both drops (${Array.from(residualDropped).sort(compareKeys).join(", ")}) and adds (${Array.from(residualAdded).sort(compareKeys).join(", ")}) columns in this generate run — hejbro can't tell whether this is a rename or an unrelated drop+add. Next: resolve each pair with --rename ${identity}.<old>=<new>, or silence it with --confirm-drop ${identity}.<old> and use two generate runs to add the new column (expand–contract).`,
					declaredAt,
				),
			];
		});

const residualTableAmbiguities = (
	schemaTableSets: SchemaTableSets,
	consumed: ReadonlyMap<
		string,
		{
			readonly dropped: ReadonlySet<string>;
			readonly added: ReadonlySet<string>;
		}
	>,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): ReadonlyArray<HejbroError> =>
	Array.from(schemaTableSets.entries())
		.sort((a, b) => compareKeys(a[0], b[0]))
		.flatMap(([schemaName, sets]) => {
			const consumedSets = consumed.get(schemaName) ?? {
				dropped: new Set<string>(),
				added: new Set<string>(),
			};
			const residualDropped = setDifference(sets.dropped, consumedSets.dropped);
			const residualAdded = setDifference(sets.added, consumedSets.added);
			if (residualDropped.size === 0 || residualAdded.size === 0) {
				return [];
			}
			const addedNames = Array.from(residualAdded).sort(compareKeys);
			const declaredAt =
				declaredAtByIdentity.get(
					tableIdentity(schemaName, addedNames[0] ?? ""),
				) ?? null;
			return [
				hejbroError(
					"ambiguous-table-rename",
					`schema "${schemaName}" both drops (${Array.from(residualDropped).sort(compareKeys).join(", ")}) and adds (${addedNames.join(", ")}) tables in this generate run — hejbro can't tell whether this is a rename or an unrelated drop+add. Next: resolve each pair with --rename ${schemaName}.<old>=<new>, or silence it with --confirm-drop ${schemaName}.<old> and use two generate runs to add the new table (expand–contract).`,
					declaredAt,
				),
			];
		});

/**
 * Resolves `--rename`/`--confirm-drop` flags against a `previous`→`next`
 * snapshot pair (decision D32, rule A): validates each flag, applies valid
 * renames to `previous` (including the derived index/FK name drift guard,
 * algorithm step 4), and reports any residual same-table/-schema drop+add
 * pair left unresolved as a batch of diagnostics.
 */
export const planRenames = (options: {
	readonly previous: Snapshot;
	readonly next: Snapshot;
	readonly renames: ReadonlyArray<RenameSpec>;
	readonly confirmedDrops: ReadonlyArray<ConfirmDropSpec>;
	readonly declaredAtByIdentity: ReadonlyMap<string, string | null>;
}): RenamePlan => {
	const previousTables = tableEntries(options.previous.objects);
	const nextTables = tableEntries(options.next.objects);
	const schemaTableSets = computeSchemaTableSets(previousTables, nextTables);
	const renamedPairings = tableRenamePairings(options.renames, schemaTableSets);
	const tableColumnSets = computeTableColumnSets(
		previousTables,
		nextTables,
		renamedPairings,
	);

	const renameResult = partitionRenameSpecs(
		options.renames,
		schemaTableSets,
		tableColumnSets,
		options.declaredAtByIdentity,
	);
	const dropResult = partitionConfirmDrops(
		options.confirmedDrops,
		schemaTableSets,
		tableColumnSets,
	);

	const applied = applyRenameSpecs(
		options.previous.objects,
		renameResult.validSpecs,
	);

	const consumedColumns = consumedColumnNamesByTable(
		renameResult.validSpecs,
		dropResult.validDrops,
	);
	const consumedTables = consumedTableNamesBySchema(
		renameResult.validSpecs,
		dropResult.validDrops,
	);

	const columnAmbiguities = residualColumnAmbiguities(
		tableColumnSets,
		consumedColumns,
		options.declaredAtByIdentity,
	);
	const tableAmbiguities = residualTableAmbiguities(
		schemaTableSets,
		consumedTables,
		options.declaredAtByIdentity,
	);

	const errors = [
		...renameResult.errors,
		...dropResult.errors,
		...tableAmbiguities,
		...columnAmbiguities,
	];

	const rewrittenPrevious: Snapshot = {
		...options.previous,
		objects: applied.objects,
	};

	return {
		rewrittenPrevious,
		renameStatements: applied.statements,
		renameChanges: [...applied.changes].sort((a, b) =>
			compareKeys(a.identity, b.identity),
		),
		errors,
	};
};
