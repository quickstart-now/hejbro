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
import type { UndeclarableNameColumn } from "./loss-report";
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
import { inferTable } from "./table";

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
	const catalog = filterCatalogToSchemas(rawCatalog, options.schemas);
	const inferenceCatalog = filterInferenceCatalogToSchemas(
		rawInferenceCatalog,
		options.schemas,
	);

	// One SchemaDeclaration instance per name, shared by every reference to
	// it (a table's own `.schema`, an enum's own `.schema`) and declared
	// exactly once in the array generateMigration reads.
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
	const mergedTables = mergeTableFacts(
		catalog,
		inferenceCatalog,
		enums.byIdentity,
		schemaFor,
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
	});

	return {
		snapshot: migration.snapshot,
		description,
		lossReport,
		sql: migration.sql,
	};
};
