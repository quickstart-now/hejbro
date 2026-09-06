import type { HejbroInput, SchemaDeclaration, Snapshot } from "@hejbro/core";
import {
	schema as declareSchema,
	emptySnapshot,
	generateMigration,
} from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import type { Catalog, EnumRow } from "../check/catalog";
import { readCatalog } from "../check/catalog";
import { compareCodeUnits } from "../compare-code-units";
import { tablesInSnapshot } from "../contract/read-snapshot";
import { mergeTableFacts } from "./adapter";
import type { InferenceCatalog } from "./catalog";
import { readInferenceCatalog } from "./catalog";
import type { CatalogDescription } from "./description";
import { describeCatalog } from "./description";
import type {
	MemberAxis,
	OmittedEnum,
	OmittedForeignKey,
	OmittedForeignKeyColumn,
	OmittedPrimaryKey,
	OmittedSchema,
	OmittedTable,
	OmittedTableMemberAtColumn,
	UndeclarableNameColumn,
} from "./loss-report";
import {
	buildLossReport,
	detectForeignKeyNameApproximations,
	detectNextvalDefaultApproximations,
	detectPrimaryKeyNameApproximations,
	detectUniqueIndexApproximations,
} from "./loss-report";
import {
	inferEnums,
	inferRoleNames,
	notInferredSummary,
	standaloneSequences,
} from "./rest";
import type {
	ExistingTableHandle,
	InferredCheck,
	InferredForeignKey,
	InferredForeignKeyTargetColumn,
	InferredIndex,
	InferredTableFacts,
} from "./table";
import {
	buildExistingTableHandle,
	inferTable,
	isExpressibleName,
	isNameDeclarable,
	isNameRoundTrippable,
} from "./table";

export type InferSourceCommand = "import" | "pull";

export type InferCatalogOptions = {
	readonly session: DriverSession;
	/**
	 * Which schemas to read -- required, no default. Which schemas a
	 * reading covers is the calling command's own decision (`import`'s
	 * own argument, `pull`'s own), never this composition's to assume;
	 * giving it a default here would let `import` and `pull` silently
	 * drift onto different defaults (the same reason `check/driver.ts`
	 * requires `commandName`/`codes` with no default of their own).
	 */
	readonly schemas: ReadonlyArray<string>;
	readonly command: InferSourceCommand;
};

export type InferCatalogResult = {
	readonly snapshot: Snapshot;
	readonly description: CatalogDescription;
	readonly lossReport: ReadonlyArray<string>;
	/**
	 * The DDL that creates this reading's own snapshot from an empty
	 * database (CI-G4-R1-04) -- `generateMigration` already computes this
	 * internally; exposed rather than left for `pull` to recompute a
	 * second time from the same declarations (the exact "computed twice,
	 * drifts quietly" shape this change has already paid for once).
	 */
	readonly sql: string;
	/**
	 * Every requested schema `partitionSchemas` excluded for an
	 * inexpressible name (D106 R4-B4/#707) -- `import`'s own N7
	 * empty-schema line ("nothing to infer in schema X") is false for one
	 * of these: there *was* something, hejbro just could not name it, and
	 * the `Omitted: schema …` loss-report line already says so. Named
	 * here, structurally, rather than left for a caller to re-parse out
	 * of `lossReport`'s own text.
	 */
	readonly omittedSchemaNames: ReadonlyArray<string>;
};

const bySchema = <T extends { readonly schema: string }>(
	rows: ReadonlyArray<T>,
	included: ReadonlySet<string>,
): ReadonlyArray<T> => rows.filter((row) => included.has(row.schema));

/** `Catalog`'s own arrays, narrowed to `schemas` -- every array but `extensions` (database-wide, no schema of its own) carries a `schema` field to filter on. */
const filterCatalogToSchemas = (
	catalog: Catalog,
	schemas: ReadonlyArray<string>,
): Catalog => {
	const included = new Set(schemas);
	return {
		schemas: catalog.schemas.filter((row) => included.has(row.schema)),
		tables: bySchema(catalog.tables, included),
		columns: bySchema(catalog.columns, included),
		constraints: bySchema(catalog.constraints, included),
		indexes: bySchema(catalog.indexes, included),
		enums: bySchema(catalog.enums, included),
		sequences: bySchema(catalog.sequences, included),
		functions: bySchema(catalog.functions, included),
		views: bySchema(catalog.views, included),
		policies: bySchema(catalog.policies, included),
		triggers: bySchema(catalog.triggers, included),
		tableGrants: bySchema(catalog.tableGrants, included),
		schemaUsageGrants: bySchema(catalog.schemaUsageGrants, included),
		defaultTableGrants: bySchema(catalog.defaultTableGrants, included),
		extensions: catalog.extensions,
	};
};

/** `InferenceCatalog`'s own arrays, narrowed to `schemas` -- every one carries the reading table's (or, for enums, the type's) own schema. */
const filterInferenceCatalogToSchemas = (
	inferenceCatalog: InferenceCatalog,
	schemas: ReadonlyArray<string>,
): InferenceCatalog => {
	const included = new Set(schemas);
	return {
		columnDetails: bySchema(inferenceCatalog.columnDetails, included),
		foreignKeyDetails: bySchema(inferenceCatalog.foreignKeyDetails, included),
		checkExpressions: bySchema(inferenceCatalog.checkExpressions, included),
		indexDetails: bySchema(inferenceCatalog.indexDetails, included),
		enumLabels: bySchema(inferenceCatalog.enumLabels, included),
		sequenceOwnership: bySchema(inferenceCatalog.sequenceOwnership, included),
	};
};

/**
 * Neither command's snapshot can carry a column under a name the
 * database does not have (CI-G1-R1-16): `contract/emit.ts`'s own rule
 * ("a table fact with no matching snapshot node is dropped, not
 * guessed at") means `pull`'s contract would silently declare a
 * column under the wrong name if the snapshot carried it -- excluded
 * here for both commands, `command` no longer branches this half.
 * `enumOmittedColumnIdentities` (712/R3) widens the same exclusion to a
 * column whose own name is fine but whose *type* is an omitted enum --
 * a type node can only ever reference a declared enum, so this column
 * must never reach `inferTable` either (it would otherwise surface a
 * second time as a plain type loss, D2's forbidden double report).
 */
const tablesExcludingUndeclarableNames = (
	tables: ReadonlyArray<InferredTableFacts>,
	enumOmittedColumnIdentities: ReadonlySet<string>,
): ReadonlyArray<InferredTableFacts> =>
	tables.map((table) => ({
		...table,
		columns: table.columns.filter((column) => {
			if (!isNameDeclarable(column.sqlName, column.tsKey)) {
				return false;
			}
			return !enumOmittedColumnIdentities.has(
				`${table.schema.schemaName}.${table.tableName}.${column.sqlName}`,
			);
		}),
	}));

/**
 * Every column an index depends on -- its key list plus any column its
 * partial predicate or an expression key's own text names -- read from
 * `index.referencedColumns` (`pg_depend`'s own auto dependency, threaded
 * through `infer/catalog.ts`), never scanned from `predicate`/
 * `columns[].text` (712/R10 B#1, review round 2 LL2: a string literal
 * reading the same bare text as a column name never appears in
 * `pg_depend`, measured live, so a text scan's false-positive risk never
 * arises here). A composite index that names even one omitted column is
 * dropped whole (J6: it cannot be declared with only some of its keys).
 */
const indexOmittedColumnIdentities = (
	schema: string,
	table: string,
	index: InferredIndex,
	omittedColumnIdentities: ReadonlySet<string>,
): ReadonlyArray<string> =>
	index.referencedColumns
		.map((column) => `${schema}.${table}.${column}`)
		.filter((identity) => omittedColumnIdentities.has(identity));

/**
 * 712/R10: which of a check constraint's own columns are omitted --
 * read from `pg_constraint.conkey` (`check/catalog.ts`'s own
 * `ConstraintRow.columns`, threaded through by `adapter.ts`'s
 * `checksFor`), never from scanning the expression's own text. Measured
 * live (postgres:17.11): a string literal reading the same bare text as
 * a column name (`check (kind = 'state2')`) never appears in `conkey`,
 * so the catalog's own list is authoritative where a text match would
 * have false-positived.
 */
const checkOmittedColumnIdentities = (
	schema: string,
	table: string,
	check: InferredCheck,
	omittedColumnIdentities: ReadonlySet<string>,
): ReadonlyArray<string> =>
	check.columns
		.map((columnName) => `${schema}.${table}.${columnName}`)
		.filter((identity) => omittedColumnIdentities.has(identity));

/**
 * 712/R10 B#1: which single column a multi-column member's own line
 * names, and that column's own cause -- the first by code point when
 * several were omitted at once (a composite index, J6), the same
 * "pick one, deterministically" shape 712/R9 already settled for a
 * foreign key lost at both ends.
 */
const firstOffendingColumn = (
	columnIdentities: ReadonlyArray<string>,
	columnOmissionCauses: ReadonlyMap<string, ColumnOmissionCause>,
):
	| Pick<
			OmittedTableMemberAtColumn,
			"columnIdentity" | "cause" | "enumIdentity"
	  >
	| undefined => {
	const [first] = [...columnIdentities].sort(compareCodeUnits);
	if (first === undefined) {
		return undefined;
	}
	const cause = columnOmissionCauses.get(first);
	if (cause === undefined) {
		return undefined;
	}
	if (cause.cause === "enum") {
		return {
			columnIdentity: first,
			cause: "enum",
			enumIdentity: cause.enumIdentity,
		};
	}
	return { columnIdentity: first, cause: "name" };
};

export type PrimaryKeyExclusionResult = {
	readonly tables: ReadonlyArray<InferredTableFacts>;
	readonly omittedPrimaryKeys: ReadonlyArray<OmittedPrimaryKey>;
};

/**
 * Review round 2 N#7 (712/R10 execution): a primary key that names an
 * already-omitted column is excluded *whole*, before {@link
 * tablesExcludingUndeclarableNames} ever drops that column from the
 * table -- a partial key is a different constraint (Postgres itself
 * would emit `primary key (<survivors>)`, never the catalog's own
 * composite key), so every surviving member's own `isPrimaryKey` is
 * cleared too, and the table ends up with no primary key at all rather
 * than a narrower one. Read against `table.columns` exactly as `adapter.ts`
 * built it (before column-stripping), since a member already dropped by
 * that step would otherwise look, from here, like it was never part of
 * the key in the first place. `primaryKeyNamesByTable` supplies the
 * constraint's own catalog name (never a derived one -- an omitted key is
 * never approximated), read once from `catalog.constraints` the same way
 * {@link excludeMembersReferencingOmittedColumns}'s own
 * `uniqueConstraintIdentities` is.
 */
const excludePrimaryKeysReferencingOmittedColumns = (
	tables: ReadonlyArray<InferredTableFacts>,
	columnOmissionCauses: ReadonlyMap<string, ColumnOmissionCause>,
	primaryKeyNamesByTable: ReadonlyMap<string, string>,
): PrimaryKeyExclusionResult => {
	const perTable = tables.map((table) => {
		const identity = `${table.schema.schemaName}.${table.tableName}`;
		const pkColumnIdentities = table.columns
			.filter((column) => column.isPrimaryKey)
			.map((column) => `${identity}.${column.sqlName}`);
		const omittedPkColumnIdentities = pkColumnIdentities.filter(
			(columnIdentity) => columnOmissionCauses.has(columnIdentity),
		);
		const offending = firstOffendingColumn(
			omittedPkColumnIdentities,
			columnOmissionCauses,
		);
		const name = primaryKeyNamesByTable.get(identity);
		if (offending === undefined || name === undefined) {
			return { table, omittedPrimaryKey: undefined };
		}
		return {
			table: {
				...table,
				columns: table.columns.map((column) => ({
					...column,
					isPrimaryKey: false,
				})),
			},
			omittedPrimaryKey: {
				schema: table.schema.schemaName,
				table: table.tableName,
				name,
				...offending,
			},
		};
	});
	return {
		tables: perTable.map((entry) => entry.table),
		omittedPrimaryKeys: perTable.flatMap((entry) => {
			if (entry.omittedPrimaryKey === undefined) {
				return [];
			}
			return [entry.omittedPrimaryKey];
		}),
	};
};

/**
 * Review round 2 MM3/NN2 (lead-approved wording): which of an index's
 * own column-bearing positions named the chosen offending column --
 * checked key list first (Postgres itself never lets a UNIQUE
 * constraint's or a primary key's own column carry a predicate or an
 * expression, so a constraint-backed index's offending column is always
 * found here). Once the column is not a key, a plain index carrying
 * *both* a predicate and an expression key names both: `pg_depend`
 * records only that the index depends on the column, never which of
 * the two clauses introduced that dependency (measured live: a
 * predicate's and an expression's own referenced columns arrive on the
 * same `deptype = 'a'` row shape, with no clause tag), so picking one
 * over the other would misattribute the cause the way 712/R8's own B#2
 * already guards against for a two-cause column -- named indeterminate
 * only when it actually is (a predicate-only or expression-only index
 * still gets its own single-clause wording). `index` is `undefined` for
 * a check constraint, whose axis is always `"key"` -- unread, since
 * `memberReasonClause` never asks a check for its axis.
 */
const memberAxisFor = (
	index: InferredIndex | undefined,
	columnIdentity: string,
	schema: string,
	table: string,
): MemberAxis => {
	if (index === undefined) {
		return "key";
	}
	const isKeyColumn = index.columns.some(
		(column) =>
			column.column !== null &&
			`${schema}.${table}.${column.column}` === columnIdentity,
	);
	if (isKeyColumn) {
		return "key";
	}
	const hasExpressionKey = index.columns.some(
		(column) => column.column === null,
	);
	if (index.predicate !== null && hasExpressionKey) {
		return "expressionOrPredicate";
	}
	if (index.predicate !== null) {
		return "predicate";
	}
	return "expression";
};

export type MemberExclusionResult = {
	readonly tables: ReadonlyArray<InferredTableFacts>;
	readonly omittedIndexesAtColumn: ReadonlyArray<OmittedTableMemberAtColumn>;
	readonly omittedChecksAtColumn: ReadonlyArray<OmittedTableMemberAtColumn>;
	readonly omittedUniqueConstraintsAtColumn: ReadonlyArray<OmittedTableMemberAtColumn>;
};

/**
 * Runs after {@link tablesExcludingUndeclarableNames}: that step has
 * already dropped every omitted column itself, so an index or check
 * still naming one here is exactly the object B#1 needs excluded too.
 * `uniqueConstraintIdentities` tells an ordinary index apart from one
 * backing a UNIQUE constraint (both arrive here as `InferredIndex`,
 * `check/catalog.ts`'s own `constraints` reading is the only place that
 * knows which) -- the loss report names the two differently (712/R10).
 */
const excludeMembersReferencingOmittedColumns = (
	tables: ReadonlyArray<InferredTableFacts>,
	columnOmissionCauses: ReadonlyMap<string, ColumnOmissionCause>,
	uniqueConstraintIdentities: ReadonlySet<string>,
): MemberExclusionResult => {
	const omittedColumnIdentities = new Set(columnOmissionCauses.keys());

	const perTable = tables.map((table) => {
		const indexResults = table.indexes.map((index) => ({
			index,
			columnIdentities: indexOmittedColumnIdentities(
				table.schema.schemaName,
				table.tableName,
				index,
				omittedColumnIdentities,
			),
		}));
		const checkResults = table.checks.map((check) => ({
			check,
			columnIdentities: checkOmittedColumnIdentities(
				table.schema.schemaName,
				table.tableName,
				check,
				omittedColumnIdentities,
			),
		}));

		const droppedIndexEntries = indexResults.filter(
			(entry) => entry.columnIdentities.length > 0,
		);
		const isUniqueConstraint = (indexName: string): boolean =>
			uniqueConstraintIdentities.has(
				`${table.schema.schemaName}.${table.tableName}.${indexName}`,
			);
		/**
		 * `index` is passed for an index or a UNIQUE constraint (both back
		 * onto an `InferredIndex`, MM3) so the axis is derived from the
		 * same object the offending column itself was found on, never
		 * recomputed a second way -- absent for a check constraint, whose
		 * axis is always `"key"` (unread: `memberReasonClause` never asks
		 * a check for its axis).
		 */
		const memberEntryFor = (
			sqlName: string,
			columnIdentities: ReadonlyArray<string>,
			index?: InferredIndex,
		): ReadonlyArray<OmittedTableMemberAtColumn> => {
			const offending = firstOffendingColumn(
				columnIdentities,
				columnOmissionCauses,
			);
			if (offending === undefined) {
				return [];
			}
			const axis = memberAxisFor(
				index,
				offending.columnIdentity,
				table.schema.schemaName,
				table.tableName,
			);
			return [
				{
					schema: table.schema.schemaName,
					table: table.tableName,
					sqlName,
					axis,
					...offending,
				},
			];
		};

		return {
			table: {
				...table,
				indexes: indexResults
					.filter((entry) => entry.columnIdentities.length === 0)
					.map((entry) => entry.index),
				checks: checkResults
					.filter((entry) => entry.columnIdentities.length === 0)
					.map((entry) => entry.check),
			},
			omittedIndexesAtColumn: droppedIndexEntries
				.filter((entry) => !isUniqueConstraint(entry.index.name))
				.flatMap((entry) =>
					memberEntryFor(entry.index.name, entry.columnIdentities, entry.index),
				),
			omittedUniqueConstraintsAtColumn: droppedIndexEntries
				.filter((entry) => isUniqueConstraint(entry.index.name))
				.flatMap((entry) =>
					memberEntryFor(entry.index.name, entry.columnIdentities, entry.index),
				),
			omittedChecksAtColumn: checkResults
				.filter((entry) => entry.columnIdentities.length > 0)
				.flatMap((entry) =>
					memberEntryFor(entry.check.name, entry.columnIdentities),
				),
		};
	});

	return {
		tables: perTable.map((entry) => entry.table),
		omittedIndexesAtColumn: perTable.flatMap(
			(entry) => entry.omittedIndexesAtColumn,
		),
		omittedChecksAtColumn: perTable.flatMap(
			(entry) => entry.omittedChecksAtColumn,
		),
		omittedUniqueConstraintsAtColumn: perTable.flatMap(
			(entry) => entry.omittedUniqueConstraintsAtColumn,
		),
	};
};

/**
 * D106 R6-N1: which half of `isNameDeclarable` failed, set here where
 * both halves are already in hand rather than re-derived in the
 * renderer -- only ever called once that check has already failed, so
 * `!isNameRoundTrippable` alone tells the two causes apart exhaustively
 * (the round-trippable-but-D36-rejected case is everything left over).
 */
const undeclarableColumnCause = (
	sqlName: string,
	tsKey: string,
): UndeclarableNameColumn["cause"] => {
	if (!isNameRoundTrippable(sqlName, tsKey)) {
		return "noDeclarationKey";
	}
	return "identifierRuleRejects";
};

/** Named in the loss report for both commands (CI-G1-R1-16) -- only the consequence sentence `buildLossReport` renders differs by command. */
const undeclarableNameColumnsFor = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlyArray<UndeclarableNameColumn> =>
	tables.flatMap((table) =>
		table.columns
			.filter((column) => !isNameDeclarable(column.sqlName, column.tsKey))
			.map((column) => ({
				schema: table.schema.schemaName,
				table: table.tableName,
				sqlName: column.sqlName,
				cause: undeclarableColumnCause(column.sqlName, column.tsKey),
			})),
	);

export type SchemaPartition = {
	/** Every schema row whose own name round-trips through the DSL's D36 rule -- safe to pass to `declareSchema`. */
	readonly expressibleNames: ReadonlyArray<string>;
	readonly omittedSchemas: ReadonlyArray<OmittedSchema>;
};

/**
 * D106 R4-B1: splits the requested schemas into the ones `declareSchema`
 * can carry and the ones it would throw `invalid-sql-name` on -- read
 * before any `declareSchema` call, not caught around one, so a
 * misnamed schema never reaches it and the reading never aborts.
 * Everything the omitted schema holds (tables, enums, sequences) is
 * excluded downstream by narrowing the catalog to `expressibleNames`
 * a second time, the same `filterCatalogToSchemas`/
 * `filterInferenceCatalogToSchemas` helpers already use for the
 * `--schema` flag itself.
 */
export const partitionSchemas = (catalog: Catalog): SchemaPartition => ({
	expressibleNames: catalog.schemas
		.filter((row) => isExpressibleName(row.schema))
		.map((row) => row.schema),
	omittedSchemas: catalog.schemas
		.filter((row) => !isExpressibleName(row.schema))
		.map((row) => ({ sqlName: row.schema })),
});

export type EnumPartition = {
	/** Every enum row whose own catalog name is a valid hejbro SQL identifier -- safe to pass to `inferEnums`/`pgEnum`. */
	readonly expressibleEnums: ReadonlyArray<EnumRow>;
	readonly omittedEnums: ReadonlyArray<EnumRow>;
};

/**
 * 712/R3 (D36): `pgEnum` asserts nothing about its own name, so a
 * catalog name D36 rejects would otherwise reach the snapshot, the
 * starter and the emitted DDL unchanged -- filtered here, before
 * `inferEnums` ever calls `pgEnum`, the same reason {@link
 * partitionSchemas}/{@link partitionTables} filter ahead of their own
 * constructors. An enum has no TypeScript key of its own (unlike a
 * column), so `isExpressibleName` alone settles it -- no round-trip
 * half to ask.
 */
export const partitionEnums = (catalog: Catalog): EnumPartition => ({
	expressibleEnums: catalog.enums.filter((row) => isExpressibleName(row.name)),
	omittedEnums: catalog.enums.filter((row) => !isExpressibleName(row.name)),
});

/** A table's identity alone, before `withInventorySignal` below can say whether `check` will keep naming it (that needs the final declared schema/enum set, not yet known at partition time). */
export type TableNameOmission = {
	readonly schema: string;
	readonly sqlName: string;
};

export type TablePartition = {
	readonly tables: ReadonlyArray<InferredTableFacts>;
	readonly omittedTables: ReadonlyArray<TableNameOmission>;
};

/**
 * D106 R4-B1: a table whose own catalog name `table()` cannot express
 * takes everything it holds with it (columns, checks, indexes, foreign
 * keys) -- filtered here, before `inferTable` ever calls `table()`, for
 * the same reason {@link partitionSchemas} filters ahead of
 * `declareSchema`.
 */
export const partitionTables = (
	tables: ReadonlyArray<InferredTableFacts>,
): TablePartition => ({
	tables: tables.filter((table) => isExpressibleName(table.tableName)),
	omittedTables: tables
		.filter((table) => !isExpressibleName(table.tableName))
		.map((table) => ({
			schema: table.schema.schemaName,
			sqlName: table.tableName,
		})),
});

/**
 * D106 R4-B1/#707: whether `check`'s own inventory will keep naming an
 * omitted table as unmanaged depends on whether its own schema still
 * holds another declared table or enum (`check/inventory.ts`'s own
 * `declaredSchemaNames` rule, mirrored here rather than imported -- that
 * module reads a built `Snapshot`, not the pre-snapshot facts this
 * reading has at this point). `false` when the omitted table was the
 * only thing its schema would have declared.
 */
export const withInventorySignal = (
	omittedTables: ReadonlyArray<TableNameOmission>,
	schemasWithOtherDeclarations: ReadonlySet<string>,
): ReadonlyArray<OmittedTable> =>
	omittedTables.map((table) => ({
		...table,
		stillReportedInInventory: schemasWithOtherDeclarations.has(table.schema),
	}));

/**
 * Whether the target was left out because its own table name was
 * inexpressible, or because its whole schema was -- the schema check
 * first, since a schema-level omission already explains why the table
 * under it can never be named either. (A self-reference never reaches
 * this: the table holding it already passed {@link partitionTables},
 * so its own schema and table names are both expressible.)
 */
const targetKindFor = (
	fk: InferredForeignKey,
): OmittedForeignKey["targetKind"] => {
	if (!isExpressibleName(fk.targetSchema)) {
		return "schema";
	}
	return "table";
};

const targetIdentifierFor = (
	fk: InferredForeignKey,
	targetKind: OmittedForeignKey["targetKind"],
): string => {
	if (targetKind === "schema") {
		return fk.targetSchema;
	}
	return `${fk.targetSchema}.${fk.targetTable}`;
};

export type ForeignKeyPartition = {
	readonly tables: ReadonlyArray<InferredTableFacts>;
	readonly omittedForeignKeys: ReadonlyArray<OmittedForeignKey>;
	readonly omittedForeignKeysByColumn: ReadonlyArray<OmittedForeignKeyColumn>;
};

/**
 * Which rule excluded a column, and (712/R8) the enum's own identity
 * when that rule is D36 on the *enum's* name rather than the column's --
 * the one lookup a foreign key at that column consults for its own
 * omission line's cause.
 */
export type ColumnOmissionCause =
	| { readonly cause: "name" }
	| { readonly cause: "enum"; readonly enumIdentity: string };

/**
 * D106 R6-B1: a foreign key is omitted for exactly the reason every
 * other object in this module is -- its own name (here, its *target*'s
 * own schema and table names) is not one a declaration can carry.
 * Whether the target's schema was ever named on `--schema` is a
 * different question, and not this function's to ask: a target this
 * run simply never read is not omitted -- it is kept, and
 * `declare-emit/emit.ts`'s own `mustDeferForeignKey` declares it
 * against an `existingTable` handle instead of a real cross-file
 * import, because there is no file to import it from. Checking the
 * target's own names, rather than membership in a surviving-table set,
 * is what tells the two cases apart (D106 R6-B1: the survivor-set
 * check could not).
 *
 * #873 widens this to a second, independent axis: a foreign key whose
 * own name is fine (both schema and table) can still name a column,
 * on either end, that a *different* rule (D36 on the column's own
 * name) already excluded -- writing it anyway is what left the starter
 * declaration referencing a column that does not exist on either
 * table's own object. `survivingTableIdentities` tells a target this
 * run never read (whose own columns are simply unknown) apart from one
 * that survived minus the very column this foreign key needs -- only
 * the latter costs the foreign key.
 */
export const partitionForeignKeys = (
	tables: ReadonlyArray<InferredTableFacts>,
	survivingTableIdentities: ReadonlySet<string>,
	columnOmissionCauses: ReadonlyMap<string, ColumnOmissionCause>,
): ForeignKeyPartition => {
	const isCarryable = (fk: InferredForeignKey): boolean =>
		isExpressibleName(fk.targetSchema) && isExpressibleName(fk.targetTable);

	/** 712/R8: an entry only when `identity` was actually excluded -- `flatMap`'s own empty-array-drops-the-row idiom stands in for a filter+map pair that would otherwise re-look-up the same cause twice. */
	const omissionEntryFor = (
		facts: InferredTableFacts,
		fk: InferredForeignKey,
		identity: string,
		end: OmittedForeignKeyColumn["end"],
	): ReadonlyArray<OmittedForeignKeyColumn> => {
		const cause = columnOmissionCauses.get(identity);
		if (cause === undefined) {
			return [];
		}
		if (cause.cause === "enum") {
			return [
				{
					schema: facts.schema.schemaName,
					table: facts.tableName,
					name: fk.name,
					columnIdentity: identity,
					end,
					cause: "enum",
					enumIdentity: cause.enumIdentity,
				},
			];
		}
		return [
			{
				schema: facts.schema.schemaName,
				table: facts.tableName,
				name: fk.name,
				columnIdentity: identity,
				end,
				cause: "name",
			},
		];
	};

	const columnOmissionsFor = (
		facts: InferredTableFacts,
		fk: InferredForeignKey,
	): ReadonlyArray<OmittedForeignKeyColumn> => {
		const sourceOmissions = fk.sourceColumns
			.map(
				(column) => `${facts.schema.schemaName}.${facts.tableName}.${column}`,
			)
			.flatMap((identity) => omissionEntryFor(facts, fk, identity, "source"));
		const targetSurvives = survivingTableIdentities.has(
			`${fk.targetSchema}.${fk.targetTable}`,
		);
		if (!targetSurvives) {
			return sourceOmissions;
		}
		const targetOmissions = fk.targetColumns
			.map((column) => `${fk.targetSchema}.${fk.targetTable}.${column.sqlName}`)
			.flatMap((identity) => omissionEntryFor(facts, fk, identity, "target"));
		return [...sourceOmissions, ...targetOmissions];
	};

	const omittedForeignKeysByColumn = tables.flatMap((facts) =>
		facts.foreignKeys
			.filter((fk) => isCarryable(fk))
			.flatMap((fk) => columnOmissionsFor(facts, fk)),
	);
	const omittedByColumnKeys = new Set(
		omittedForeignKeysByColumn.map(
			(entry) => `${entry.schema}.${entry.table}.${entry.name}`,
		),
	);
	const isKeptByColumnCheck = (
		facts: InferredTableFacts,
		fk: InferredForeignKey,
	): boolean =>
		!omittedByColumnKeys.has(
			`${facts.schema.schemaName}.${facts.tableName}.${fk.name}`,
		);

	const omittedForeignKeys = tables.flatMap((facts) =>
		facts.foreignKeys
			.filter((fk) => !isCarryable(fk))
			.map((fk) => {
				const targetKind = targetKindFor(fk);
				return {
					schema: facts.schema.schemaName,
					table: facts.tableName,
					name: fk.name,
					targetKind,
					target: targetIdentifierFor(fk, targetKind),
				};
			}),
	);
	return {
		tables: tables.map((facts) => ({
			...facts,
			foreignKeys: facts.foreignKeys.filter(
				(fk) => isCarryable(fk) && isKeptByColumnCheck(facts, fk),
			),
		})),
		omittedForeignKeys,
		omittedForeignKeysByColumn,
	};
};

type OutOfScopeTarget = {
	readonly targetSchema: string;
	readonly targetTable: string;
	readonly columnsBySqlName: Map<string, InferredForeignKeyTargetColumn>;
};

/**
 * D106 R6-B1 commit 5.5 (owner ruling D): `import` and `pull` used to
 * build two different snapshots from one reading -- a loaded starter
 * file has an existing-table node for a target this run never read
 * (its own text declares the handle), `pull` never loads that text, so
 * its snapshot had none, and `contract/tables.ts`'s own
 * `findTableInSnapshot` returned `null`. The fix is the reading itself
 * carries the handle, so both consumers see the same snapshot -- one
 * `existingTable` handle per out-of-scope *identity*, not per foreign
 * key (two keys into one target must resolve to the one object that
 * gets declared, never two objects sharing an identity), built from
 * the union of every such foreign key's own `targetColumns`.
 */
export const outOfScopeHandlesFor = (
	tables: ReadonlyArray<InferredTableFacts>,
	survivingTableIdentities: ReadonlySet<string>,
): ReadonlyMap<string, ExistingTableHandle> => {
	const targets = tables
		.flatMap((facts) => facts.foreignKeys)
		.filter(
			(fk) =>
				!survivingTableIdentities.has(`${fk.targetSchema}.${fk.targetTable}`),
		)
		.reduce((map, fk) => {
			const identity = `${fk.targetSchema}.${fk.targetTable}`;
			const target: OutOfScopeTarget = map.get(identity) ?? {
				targetSchema: fk.targetSchema,
				targetTable: fk.targetTable,
				columnsBySqlName: new Map(),
			};
			fk.targetColumns.forEach((column) => {
				target.columnsBySqlName.set(column.sqlName, column);
			});
			map.set(identity, target);
			return map;
		}, new Map<string, OutOfScopeTarget>());
	return new Map(
		[...targets.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([identity, target]) => [
				identity,
				buildExistingTableHandle(target.targetSchema, target.targetTable, [
					...target.columnsBySqlName.values(),
				]),
			]),
	);
};

/**
 * The single entry point over every `infer/` part (CI-G1-R1-14): one
 * session and a required schema list in, `{ snapshot, description,
 * lossReport }` out. `import` and `pull` both call this rather than
 * each assembling the parts themselves -- exactly the risk the lead's
 * own measurement named: two independent assemblies drift the moment
 * one of them changes and the other doesn't.
 */
export const inferFromCatalog = async (
	options: InferCatalogOptions,
): Promise<InferCatalogResult> => {
	const [rawCatalog, rawInferenceCatalog] = await Promise.all([
		readCatalog(options.session),
		readInferenceCatalog(options.session),
	]);
	const requestedCatalog = filterCatalogToSchemas(rawCatalog, options.schemas);
	const requestedInferenceCatalog = filterInferenceCatalogToSchemas(
		rawInferenceCatalog,
		options.schemas,
	);

	// D106 R4-B1: a schema whose own name `declareSchema` cannot express
	// (and everything it holds) is excluded before any declaration is
	// built, by narrowing the requested catalog a second time -- the same
	// helpers the `--schema` flag itself already uses.
	const schemaPartition = partitionSchemas(requestedCatalog);
	const catalog = filterCatalogToSchemas(
		requestedCatalog,
		schemaPartition.expressibleNames,
	);
	const inferenceCatalog = filterInferenceCatalogToSchemas(
		requestedInferenceCatalog,
		schemaPartition.expressibleNames,
	);

	// One SchemaDeclaration instance per name, shared by every reference to
	// it (a table's own `.schema`, an enum's own `.schema`) and declared
	// exactly once in the array generateMigration reads. Every name here
	// already passed `partitionSchemas`, so `declareSchema` never throws.
	const schemasByName = new Map<string, SchemaDeclaration>(
		catalog.schemas.map((row) => [row.schema, declareSchema(row.schema)]),
	);
	const schemaFor = (name: string): SchemaDeclaration => {
		const found = schemasByName.get(name);
		if (found !== undefined) {
			return found;
		}
		return declareSchema(name);
	};

	// 712/R3: a catalog name D36 rejects never reaches `pgEnum` -- filtered
	// before `inferEnums` calls it, the same reason `partitionSchemas`
	// filters ahead of `declareSchema`.
	const enumPartition = partitionEnums(catalog);
	const enums = inferEnums(
		enumPartition.expressibleEnums,
		inferenceCatalog.enumLabels,
		schemaFor,
	);
	const allMergedTables = mergeTableFacts(
		catalog,
		inferenceCatalog,
		enums.byIdentity,
		schemaFor,
	);
	const tablePartition = partitionTables(allMergedTables);
	const mergedTables = tablePartition.tables;
	/**
	 * D106 R5: the single "which tables actually survived" identity set
	 * every later step that must agree on it reads -- `mergedTables`
	 * itself, named once here rather than re-derived per caller. R5-B1
	 * and R5-N2 both trace to a caller that judged survival its own way
	 * (a foreign key's target existing regardless of whether the reading
	 * kept it; a UNIQUE constraint read off unfiltered catalog rows) --
	 * one set, read by both, closes both the same way.
	 */
	const survivingTableIdentities = new Set(
		mergedTables.map(
			(table) => `${table.schema.schemaName}.${table.tableName}`,
		),
	);
	// #707: a schema an omitted table's own report line names as still
	// scanned by `check`'s inventory needs another surviving declared
	// table or enum in that same schema -- computed from the survivors,
	// not from `allMergedTables`, since the omitted table itself must
	// never count as its own "other" declaration.
	const schemasWithOtherDeclarations = new Set([
		...mergedTables.map((table) => table.schema.schemaName),
		...enums.declarations.map((decl) => decl.schema.schemaName),
	]);
	const omittedTables = withInventorySignal(
		tablePartition.omittedTables,
		schemasWithOtherDeclarations,
	);
	// #873: computed once, ahead of the foreign-key partition below (which
	// needs it) and reused for the loss report's own enumeration (which
	// used to re-derive it a second time, later) -- the same judgment,
	// asked once.
	const undeclarableColumns = undeclarableNameColumnsFor(mergedTables);
	// 712/R3: a column typed by an omitted enum -- its own name may well
	// be fine, but its type node can only ever reference a declared enum,
	// so it is excluded the same way an undeclarable-name column is (and
	// folded into the same `columnOmissionCauses` map a foreign key at
	// that column already checks, D2's own reuse of task 1.3's rule). The
	// omitted enum's own type identity is read from the raw catalog row
	// (`baseTypeKind`/`baseTypeSchema`/`baseTypeName`), never re-derived.
	const omittedEnumIdentities = new Set(
		enumPartition.omittedEnums.map((row) => `${row.schema}.${row.name}`),
	);
	const columnRowsByIdentity = new Map(
		catalog.columns.map(
			(row) => [`${row.schema}.${row.table}.${row.name}`, row] as const,
		),
	);
	const enumOmittedColumns = mergedTables.flatMap((table) =>
		table.columns.flatMap((column) => {
			const row = columnRowsByIdentity.get(
				`${table.schema.schemaName}.${table.tableName}.${column.sqlName}`,
			);
			if (
				row === undefined ||
				row.baseTypeKind !== "e" ||
				row.baseTypeSchema === null ||
				row.baseTypeName === null ||
				!omittedEnumIdentities.has(`${row.baseTypeSchema}.${row.baseTypeName}`)
			) {
				return [];
			}
			// D2: a column already omitted for its own name is reported by
			// that column's own line, never by the enum's line too.
			if (!isNameDeclarable(column.sqlName, column.tsKey)) {
				return [];
			}
			return [
				{
					enumSchema: row.baseTypeSchema,
					enumName: row.baseTypeName,
					schema: table.schema.schemaName,
					table: table.tableName,
					sqlName: column.sqlName,
				},
			];
		}),
	);
	const enumOmittedColumnIdentities = new Set(
		enumOmittedColumns.map(
			(column) => `${column.schema}.${column.table}.${column.sqlName}`,
		),
	);
	// 712/R10 B#2: a column already reported for its own name
	// (`undeclarableColumns`) that is *also* typed by an omitted enum --
	// the D2 guard above keeps a two-cause column off the enum's own
	// line, but the column's own line now names both, since renaming it
	// alone only moves it to the enum's line (its type still cannot be
	// declared).
	const twoCauseEnumIdentityByColumn = new Map<string, string>(
		undeclarableColumns.flatMap((column) => {
			const row = columnRowsByIdentity.get(
				`${column.schema}.${column.table}.${column.sqlName}`,
			);
			if (
				row === undefined ||
				row.baseTypeKind !== "e" ||
				row.baseTypeSchema === null ||
				row.baseTypeName === null ||
				!omittedEnumIdentities.has(`${row.baseTypeSchema}.${row.baseTypeName}`)
			) {
				return [];
			}
			return [
				[
					`${column.schema}.${column.table}.${column.sqlName}`,
					`${row.baseTypeSchema}.${row.baseTypeName}`,
				] as const,
			];
		}),
	);
	const omittedEnums: ReadonlyArray<OmittedEnum> =
		enumPartition.omittedEnums.map((enumRow) => ({
			schema: enumRow.schema,
			sqlName: enumRow.name,
			columns: enumOmittedColumns
				.filter(
					(column) =>
						column.enumSchema === enumRow.schema &&
						column.enumName === enumRow.name,
				)
				.map((column) => ({
					schema: column.schema,
					table: column.table,
					sqlName: column.sqlName,
				})),
		}));
	// 712/R8: which rule excluded a column, threaded through to the
	// foreign-key partition so its own omission line can follow the same
	// cause -- name and enum causes never collide on one column identity
	// (D2, `enumOmittedColumns`'s own `isNameDeclarable` guard above), so
	// this spread order never needs to break a tie.
	const columnOmissionCauses = new Map<string, ColumnOmissionCause>([
		...undeclarableColumns.map(
			(column) =>
				[
					`${column.schema}.${column.table}.${column.sqlName}`,
					{ cause: "name" as const },
				] as const,
		),
		...enumOmittedColumns.map(
			(column) =>
				[
					`${column.schema}.${column.table}.${column.sqlName}`,
					{
						cause: "enum" as const,
						enumIdentity: `${column.enumSchema}.${column.enumName}`,
					},
				] as const,
		),
	]);
	// B#1 (live review): the same unified set every index/check/unique
	// exclusion below reads -- never re-derived per caller.
	const omittedColumnIdentities = new Set(columnOmissionCauses.keys());
	// 712/R10 B#1: which excluded index is really a UNIQUE constraint's
	// own backing index -- the loss report names the two differently, and
	// only the raw catalog's own `constraints` reading (never
	// `indexDetails`, which carries both alike) knows which is which.
	const uniqueConstraintIdentities = new Set(
		catalog.constraints
			.filter((row) => row.type === "u")
			.map((row) => `${row.schema}.${row.table}.${row.name}`),
	);

	const foreignKeyPartition = partitionForeignKeys(
		mergedTables,
		survivingTableIdentities,
		columnOmissionCauses,
	);
	const tablesWithReachableForeignKeys = foreignKeyPartition.tables;
	const outOfScopeHandles = outOfScopeHandlesFor(
		tablesWithReachableForeignKeys,
		survivingTableIdentities,
	);

	// 712/R10 execution (N#7): the catalog's own primary-key constraint
	// name per table, read once here -- an omitted key is never
	// approximated, so this is never the derived name a mismatch would
	// otherwise print.
	const primaryKeyNamesByTable = new Map(
		catalog.constraints
			.filter((row) => row.type === "p")
			.map((row) => [`${row.schema}.${row.table}`, row.name] as const),
	);
	const primaryKeyExclusion = excludePrimaryKeysReferencingOmittedColumns(
		tablesWithReachableForeignKeys,
		columnOmissionCauses,
		primaryKeyNamesByTable,
	);
	const snapshotTables = tablesExcludingUndeclarableNames(
		primaryKeyExclusion.tables,
		enumOmittedColumnIdentities,
	);
	const memberExclusion = excludeMembersReferencingOmittedColumns(
		snapshotTables,
		columnOmissionCauses,
		uniqueConstraintIdentities,
	);
	const built = memberExclusion.tables.map((table) =>
		inferTable(table, outOfScopeHandles),
	);
	const typeLosses = built.flatMap((result) => result.losses);
	const declarations: ReadonlyArray<HejbroInput> = [
		...schemasByName.values(),
		...enums.declarations,
		...built.map((result) => result.table),
		...[...outOfScopeHandles.values()].map((handle) => handle.table),
	];
	const migration = generateMigration({
		declarations,
		previousSnapshot: emptySnapshot,
	});

	const description = describeCatalog(catalog, inferenceCatalog);
	const lossReport = buildLossReport({
		command: options.command,
		roleNames: inferRoleNames(catalog),
		notInferred: notInferredSummary(catalog),
		standaloneSequences: standaloneSequences(catalog, inferenceCatalog),
		typeLosses,
		uniqueIndexApproximations: detectUniqueIndexApproximations(
			catalog,
			survivingTableIdentities,
			omittedColumnIdentities,
		),
		nextvalDefaults: detectNextvalDefaultApproximations(
			tablesWithReachableForeignKeys,
		),
		foreignKeyNameApproximations: detectForeignKeyNameApproximations(
			tablesWithReachableForeignKeys,
		),
		// 712/R7: measured against the snapshot core itself just built, never
		// a second, local re-implementation of the derivation rule.
		primaryKeyNameApproximations: detectPrimaryKeyNameApproximations(
			catalog,
			tablesInSnapshot(migration.snapshot),
		),
		undeclarableNameColumns: undeclarableColumns.map((column) => {
			const enumIdentity = twoCauseEnumIdentityByColumn.get(
				`${column.schema}.${column.table}.${column.sqlName}`,
			);
			if (enumIdentity === undefined) {
				return column;
			}
			return { ...column, enumIdentity };
		}),
		omittedSchemas: schemaPartition.omittedSchemas,
		omittedTables,
		omittedEnums,
		omittedIndexes: built.flatMap((result) => result.omittedIndexes),
		omittedChecks: built.flatMap((result) => result.omittedChecks),
		omittedForeignKeys: foreignKeyPartition.omittedForeignKeys,
		omittedForeignKeysByColumn: foreignKeyPartition.omittedForeignKeysByColumn,
		omittedIndexesAtColumn: memberExclusion.omittedIndexesAtColumn,
		omittedChecksAtColumn: memberExclusion.omittedChecksAtColumn,
		omittedUniqueConstraintsAtColumn:
			memberExclusion.omittedUniqueConstraintsAtColumn,
		omittedPrimaryKeys: primaryKeyExclusion.omittedPrimaryKeys,
	});

	return {
		snapshot: migration.snapshot,
		description,
		lossReport,
		sql: migration.sql,
		omittedSchemaNames: schemaPartition.omittedSchemas.map(
			(schema) => schema.sqlName,
		),
	};
};
