import type { HejbroInput, SchemaDeclaration, Snapshot } from "@hejbro/core";
import {
	schema as declareSchema,
	emptySnapshot,
	generateMigration,
	toSnakeCase,
} from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import type { Catalog } from "../check/catalog";
import { readCatalog } from "../check/catalog";
import { mergeTableFacts } from "./adapter";
import type { InferenceCatalog } from "./catalog";
import { readInferenceCatalog } from "./catalog";
import type { CatalogDescription } from "./description";
import { describeCatalog } from "./description";
import type {
	OmittedSchema,
	OmittedTable,
	UndeclarableNameColumn,
} from "./loss-report";
import {
	buildLossReport,
	detectForeignKeyNameApproximations,
	detectNextvalDefaultApproximations,
	detectUniqueIndexApproximations,
} from "./loss-report";
import {
	inferEnums,
	inferRoleNames,
	notInferredSummary,
	standaloneSequences,
} from "./rest";
import type { InferredTableFacts } from "./table";
import { inferTable, isExpressibleName } from "./table";

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

/** `toSnakeCase(tsKey) === sqlName` -- the exact fact `table()` itself derives a column's SQL name from its key by (CI-G1-R1-06 (C)/CI-G1-R1-08 (C)): a guessed key that does not survive this round trip cannot express its own source column's spelling. */
const isNameRoundTrippable = (sqlName: string, tsKey: string): boolean =>
	toSnakeCase(tsKey) === sqlName;

/**
 * Neither command's snapshot can carry a column under a name the
 * database does not have (CI-G1-R1-16): `contract/emit.ts`'s own rule
 * ("a table fact with no matching snapshot node is dropped, not
 * guessed at") means `pull`'s contract would silently declare a
 * column under the wrong name if the snapshot carried it -- excluded
 * here for both commands, `command` no longer branches this half.
 */
const tablesExcludingUndeclarableNames = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlyArray<InferredTableFacts> =>
	tables.map((table) => ({
		...table,
		columns: table.columns.filter((column) =>
			isNameRoundTrippable(column.sqlName, column.tsKey),
		),
	}));

/** Named in the loss report for both commands (CI-G1-R1-16) -- only the consequence sentence `buildLossReport` renders differs by command. */
const undeclarableNameColumnsFor = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlyArray<UndeclarableNameColumn> =>
	tables.flatMap((table) =>
		table.columns
			.filter((column) => !isNameRoundTrippable(column.sqlName, column.tsKey))
			.map((column) => ({
				schema: table.schema.schemaName,
				table: table.tableName,
				sqlName: column.sqlName,
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

	const enums = inferEnums(
		catalog.enums,
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

	const snapshotTables = tablesExcludingUndeclarableNames(mergedTables);
	const built = snapshotTables.map((table) => inferTable(table));
	const typeLosses = built.flatMap((result) => result.losses);
	const declarations: ReadonlyArray<HejbroInput> = [
		...schemasByName.values(),
		...enums.declarations,
		...built.map((result) => result.table),
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
		uniqueIndexApproximations: detectUniqueIndexApproximations(catalog),
		nextvalDefaults: detectNextvalDefaultApproximations(mergedTables),
		foreignKeyNameApproximations:
			detectForeignKeyNameApproximations(mergedTables),
		undeclarableNameColumns: undeclarableNameColumnsFor(mergedTables),
		omittedSchemas: schemaPartition.omittedSchemas,
		omittedTables,
		omittedIndexes: built.flatMap((result) => result.omittedIndexes),
		omittedChecks: built.flatMap((result) => result.omittedChecks),
	});

	return {
		snapshot: migration.snapshot,
		description,
		lossReport,
		sql: migration.sql,
	};
};
