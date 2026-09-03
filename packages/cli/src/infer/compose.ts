import type { HejbroInput, SchemaDeclaration, Snapshot } from "@hejbro/core";
import {
	schema as declareSchema,
	emptySnapshot,
	generateMigration,
	isSqlName,
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
	OmittedForeignKey,
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
import type {
	ExistingTableHandle,
	InferredForeignKey,
	InferredForeignKeyTargetColumn,
	InferredTableFacts,
} from "./table";
import {
	buildExistingTableHandle,
	inferTable,
	isExpressibleName,
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
 * `toSnakeCase(tsKey) === sqlName` -- the exact fact `table()` itself
 * derives a column's SQL name from its key by (CI-G1-R1-06 (C)/
 * CI-G1-R1-08 (C)): a guessed key that does not survive this round
 * trip cannot express its own source column's spelling. Necessary, not
 * sufficient (D106 R5-B2): a name can round-trip and still fail D36 --
 * `"_id"` is its own round-trip fixed point (`toSnakeCase` never
 * strips a leading `_`) but `table()`'s own `assertSqlName` rejects it
 * (`^[a-z]`, not `^[a-z_]`) three frames later. {@link isNameDeclarable}
 * is the actual gate; this predicate alone underestimates what
 * `undeclarableNameColumnsFor` must catch.
 */
const isNameRoundTrippable = (sqlName: string, tsKey: string): boolean =>
	toSnakeCase(tsKey) === sqlName;

/**
 * D106 R5-B2: whether a column can actually reach a declaration --
 * round-trippable *and* a name `table()`'s own `assertSqlName` (D36)
 * would accept, checked here with the same rule `@hejbro/core` itself
 * enforces (`isSqlName`, exported for exactly this) rather than a
 * second, hand-rolled copy of it. Two different rules answering "can
 * this be declared" is the gap this round's own findings (R5-B1,
 * R5-B2) both trace to.
 */
export const isNameDeclarable = (sqlName: string, tsKey: string): boolean =>
	isNameRoundTrippable(sqlName, tsKey) && isSqlName(sqlName);

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
			isNameDeclarable(column.sqlName, column.tsKey),
		),
	}));

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
};

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
 */
export const partitionForeignKeys = (
	tables: ReadonlyArray<InferredTableFacts>,
): ForeignKeyPartition => {
	const isCarryable = (fk: InferredForeignKey): boolean =>
		isExpressibleName(fk.targetSchema) && isExpressibleName(fk.targetTable);
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
			foreignKeys: facts.foreignKeys.filter((fk) => isCarryable(fk)),
		})),
		omittedForeignKeys,
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
	const foreignKeyPartition = partitionForeignKeys(mergedTables);
	const tablesWithReachableForeignKeys = foreignKeyPartition.tables;
	const outOfScopeHandles = outOfScopeHandlesFor(
		tablesWithReachableForeignKeys,
		survivingTableIdentities,
	);

	const snapshotTables = tablesExcludingUndeclarableNames(
		tablesWithReachableForeignKeys,
	);
	const built = snapshotTables.map((table) =>
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
		),
		nextvalDefaults: detectNextvalDefaultApproximations(
			tablesWithReachableForeignKeys,
		),
		foreignKeyNameApproximations: detectForeignKeyNameApproximations(
			tablesWithReachableForeignKeys,
		),
		undeclarableNameColumns: undeclarableNameColumnsFor(
			tablesWithReachableForeignKeys,
		),
		omittedSchemas: schemaPartition.omittedSchemas,
		omittedTables,
		omittedIndexes: built.flatMap((result) => result.omittedIndexes),
		omittedChecks: built.flatMap((result) => result.omittedChecks),
		omittedForeignKeys: foreignKeyPartition.omittedForeignKeys,
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
