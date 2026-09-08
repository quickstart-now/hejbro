import { mkdirSync, writeFileSync } from "node:fs";
import { hejbroError, throwHejbroError } from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import { defineCommand } from "citty";
import { currentDatabaseName } from "../apply/reset";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import type { ContractOrigin } from "../contract/emit";
import { emitContract } from "../contract/emit";
import { exportPayloadFromCatalog } from "../contract/from-catalog";
import {
	enumsInSnapshot,
	sequencesInSnapshot,
	tablesInSnapshot,
} from "../contract/read-snapshot";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { serializeExportDescription } from "../export/description";
import { collectFlagValues, normalizeEqualsFlags } from "../flags";
import { sha256Hex } from "../hash";
import type { InferCatalogOptions, InferCatalogResult } from "../infer/compose";
import { inferFromCatalog } from "../infer/compose";
import { withReportLinesBeforeWayOut } from "../infer/loss-report";
import { loadConfigIfPresent } from "../loader";
import {
	assertLockWritable,
	vendorContractPath,
	vendorDirPath,
	vendorSchemaPath,
	vendorSqlPath,
	writeLock,
} from "../vendor/lock";
import { assertContractDestinationWritable } from "../vendor/write";

const PULL_DESCRIPTION =
	"Read a database's catalog as the marked fallback, into the same destination `hejbro vendor` writes.";

// Mirrors check.ts's/import.ts's own `*_ARGS` -- only `--help` reads this
// block; the real parsing is by hand from `ctx.rawArgs` below.
const PULL_ARGS = {
	"db-url": {
		type: "string",
		description:
			"database connection string (default: DATABASE_URL) -- named --db-url, not --url: pull is a marked fallback from vendor's own git channel",
	},
	schema: {
		type: "string",
		description: "schema to read (repeatable, required, no default)",
	},
} as const;

const lastFlagValue = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): string | undefined => collectFlagValues(rawArgs, flagName).at(-1);

export type PullResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const FIRST_QUOTED_SUBSTRING = /"([^"]+)"/;

/** Same identity-extraction heuristic as check.ts/import.ts's own copies. */
const identityFromMessage = (message: string, fallback: string): string => {
	const match = FIRST_QUOTED_SUBSTRING.exec(message);
	if (match === null) {
		return fallback;
	}
	return match[1] ?? fallback;
};

const FALLBACK_IDENTITY = "hejbro pull";

const errorReport = (error: unknown): PullResult => {
	const pullError = asHejbroError(error);
	const diagnostic = fromHejbroError(
		pullError,
		identityFromMessage(pullError.message, FALLBACK_IDENTITY),
	);
	return {
		exitCode: 1,
		stdout: [],
		stderr: renderDiagnostics([diagnostic], null),
	};
};

const throwMissingSchema = (): never =>
	throwHejbroError(
		"pull-schema-missing",
		"hejbro pull needs at least one \"--schema\" to read, and none was given: a database's schemas include its platform's own (auth, storage, and their neighbours on a hosted Postgres), so there is no default this command can guess. Next: pass one or more --schema <name> flags, most commonly --schema public, then rerun `hejbro pull`.",
	);

/**
 * B2 final (D106 round-1 correction, lead ruling, "pull mirrors
 * import"): which of the requested schemas actually contributed
 * something to the snapshot this reading yields -- read from each
 * object's own `.schema` field (`tablesInSnapshot`/`enumsInSnapshot`/
 * `sequencesInSnapshot`, `contract/read-snapshot.ts`), mirroring
 * `import.ts`'s own `schemasWithInferredObjects` (not shared, since
 * this command's own dependency seam and result shape differ). A
 * schema omitted whole (D36) or one the database never held both
 * produce zero snapshot objects, so this one check subsumes both --
 * the old `omittedSchemaNames`-only filter never caught the second.
 */
const schemasWithInferredObjects = (
	result: InferCatalogResult,
): ReadonlySet<string> =>
	new Set([
		...tablesInSnapshot(result.snapshot).map((t) => t.schema),
		...enumsInSnapshot(result.snapshot).map((e) => e.schema),
		...sequencesInSnapshot(result.snapshot).map((s) => s.schema),
	]);

/**
 * B2 final, mirroring `import.ts`'s own `omittedNamedSchemas`: which of
 * the requested, nothing-contributing schemas held something the
 * reading just could not carry the name of -- distinct from one the
 * database never held at all, since the two earn different refusal
 * codes (`pull-nothing-declarable` vs `pull-nothing-to-infer`, 712/R14).
 */
const omittedNamedSchemas = (
	result: InferCatalogResult,
	schemas: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const omitted = new Set(result.omittedSchemaNames);
	return schemas.filter((schemaName) => omitted.has(schemaName));
};

/** Mirrors `import.ts`'s own `QUOTED_IDENTITY` -- a quoted identity's own leading segment, up to its first `.`. */
const QUOTED_IDENTITY = /"([^"]+)"/g;

/**
 * B2 final, mirroring `import.ts`'s own `schemaHasNamedOmission` (712/R10
 * N#4): a schema that held only objects the loss report already named
 * as omitted (an enum with no expressible name, an index at an omitted
 * column, …) produces zero snapshot objects the same way a genuinely
 * empty schema does -- `schemasWithInferredObjects` cannot tell the two
 * apart, since neither ever reaches the snapshot. Checked against the
 * rendered report itself, the one place that already knows every
 * "Omitted: …" line and the identity each one names.
 */
const schemaHasNamedOmission = (
	lossReport: ReadonlyArray<string>,
	schemaName: string,
): boolean =>
	lossReport
		.filter((line) => line.startsWith("Omitted:"))
		.some((line) =>
			[...line.matchAll(QUOTED_IDENTITY)].some((match) => {
				const identity = match[1];
				return (
					identity !== undefined &&
					(identity === schemaName || identity.startsWith(`${schemaName}.`))
				);
			}),
		);

/**
 * B2 final, mirroring `import.ts`'s own `emptySchemaLines`: a requested
 * schema that produced nothing at all, and is not itself the reason
 * (never omitted whole, and no line already names it), earns a
 * `Not inferred: nothing to infer in schema "X".` line rather than
 * silent exclusion. A schema omitted whole (D36) already carries its
 * own `Omitted: schema …` line (`result.lossReport`, unchanged, shared
 * with `import`) and must never also earn this one.
 */
const emptySchemaLines = (
	result: InferCatalogResult,
	schemas: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const withObjects = schemasWithInferredObjects(result);
	const omitted = new Set(result.omittedSchemaNames);
	return schemas
		.filter((schemaName) => !withObjects.has(schemaName))
		.filter((schemaName) => !omitted.has(schemaName))
		.filter(
			(schemaName) => !schemaHasNamedOmission(result.lossReport, schemaName),
		)
		.map(
			(schemaName) =>
				`Not inferred: nothing to infer in schema "${schemaName}".`,
		);
};

// 712/R14 (new surface, lead-approved: mirrors `import.ts`'s own
// `import-nothing-to-infer` verbatim, only the command name swapped) --
// every named schema produced nothing at all, none of them for a
// nameable-but-omitted reason.
const throwNothingToInfer = (schemas: ReadonlyArray<string>): never =>
	throwHejbroError(
		"pull-nothing-to-infer",
		`hejbro pull found no table, enum, or sequence to infer in schema(s) ${schemas.join(", ")}. Next: confirm the schema name(s) are correct and that the database holds objects in them, then rerun \`hejbro pull\`.`,
	);

/**
 * 712/R14 (new surface, lead-approved: mirrors `import.ts`'s own
 * `nothingDeclarableResult`, "declare" swapped for pull's own "carry
 * into the contract" vocabulary): at least one named schema held
 * something this reading could not carry the name of, and nothing else
 * contributed either, so the pull bundle would otherwise be empty
 * (`pulled X ()`).
 */
const nothingDeclarableResult = (
	lossReport: ReadonlyArray<string>,
	omittedSchemas: ReadonlyArray<string>,
): PullResult => {
	const error = hejbroError(
		"pull-nothing-declarable",
		`hejbro pull found nothing it could carry into the contract in schema(s) ${omittedSchemas.join(", ")}: each one held something, but its own catalog name is not a valid hejbro SQL identifier (see the "Omitted" line(s) above). Next: rename the schema(s) named above in the database, then rerun \`hejbro pull\`.`,
	);
	const diagnostic = fromHejbroError(error, FALLBACK_IDENTITY);
	return {
		exitCode: 1,
		stdout: lossReport,
		stderr: renderDiagnostics([diagnostic], null),
	};
};

/**
 * `pull`'s own dependency seam (mirrors `import.ts`'s `ImportDeps`):
 * `inferCatalog` and `currentDatabaseName` are both replaced in a test,
 * so the connectivity probe still runs against a real (fake) driver but
 * no real catalog query is ever issued. Group 5's own live witness is
 * the one place this seam is never used (CI-G4-R1-01 condition), so the
 * real wiring to `inferFromCatalog`/`currentDatabaseName` is exercised
 * for real there.
 */
export type PullDeps = {
	readonly importer?: CheckDriverImporter;
	readonly inferCatalog?: (
		options: InferCatalogOptions,
	) => Promise<InferCatalogResult>;
	readonly currentDatabaseName?: (driver: Driver) => Promise<string>;
};

/**
 * `hejbro pull`'s own thin orchestration: resolve `--schema`(s) (required,
 * no default -- same reason `import`'s own is), connect exactly as
 * `check` does but under `--db-url` (schema-vendoring spec: pull is a
 * marked *fallback* from vendor's own git channel, so its own flag name
 * says so), infer (`inferFromCatalog`, command `"pull"`), bridge the
 * result into an `ExportPayload` (`exportPayloadFromCatalog`, Group 1's
 * `CatalogDescription` built for exactly this), and write into the SAME
 * destination `hejbro vendor` writes (`vendorContractPath`/
 * `vendorSchemaPath`/`vendorSqlPath`/the lock) -- never a `pull`-owned
 * directory, so `hejbro link` can later swap the same place back to a
 * git origin and `vendor --check`/`outdated` always read one lock
 * regardless of which command wrote it last. Destination protection is
 * `vendor`'s own unchanged rule, reused rather than reinvented: no
 * `--force` flag exists here, so `assertLockWritable`/
 * `assertContractDestinationWritable` are always called with `force:
 * false` (`commands/vendor.ts:271-274`, `:186` -- the same two guards,
 * the same "before any network work" order) -- and with `"hejbro pull"`
 * as their own `commandName` (D106 R3-N2), so a refusal's remedy text
 * never tells this caller to pass a flag it doesn't have.
 */
export const runPull = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
	deps: PullDeps = {},
): Promise<PullResult> => {
	try {
		const normalized = normalizeEqualsFlags(argv);
		const dbUrlFlag = lastFlagValue(normalized, "--db-url");
		const schemas = collectFlagValues(normalized, "--schema");
		if (schemas.length === 0) {
			throwMissingSchema();
		}
		assertLockWritable(cwd, false, "hejbro pull");
		assertContractDestinationWritable(
			vendorContractPath(cwd),
			false,
			"hejbro pull",
		);
		const inferCatalog = deps.inferCatalog ?? inferFromCatalog;
		const readCurrentDatabaseName =
			deps.currentDatabaseName ?? currentDatabaseName;
		// pull never read hejbro.config.ts before this field existed
		// (add-config-driver, #458, lead ruling 458/R2): a project with none
		// yet still runs through the vanilla driver, so absence is never a
		// refusal here.
		const loaded = await loadConfigIfPresent(cwd);
		return await withCheckConnection(
			dbUrlFlag,
			process.env,
			{
				commandName: "hejbro pull",
				connectionFlag: "--db-url",
				codes: {
					connectionMissing: "pull-connection-missing",
					driverMissing: "pull-driver-missing",
					connectionFailed: "pull-connection-failed",
					driverUnclosable: "pull-driver-unclosable",
				},
			},
			async (driver) => {
				const [result, database] = await Promise.all([
					inferCatalog({ session: driver, schemas, command: "pull" }),
					readCurrentDatabaseName(driver),
				]);
				// B2 final (D106 round-1 correction, N11 superseded, lead
				// ruling "pull mirrors import"): the list/lock is exactly the
				// schemas that actually contributed something to the snapshot
				// this reading yields -- a schema omitted whole (D36) and one
				// the database never held both contributed nothing, and
				// neither is one this command actually read. The "pulled …"
				// line and the lock's own `schemas` share this one filtered
				// list, so neither claims a schema that carries nothing.
				const withObjects = schemasWithInferredObjects(result);
				const sortedSchemas = schemas
					.filter((schemaName) => withObjects.has(schemaName))
					.sort();
				// B2 final (712/R14): a requested schema that produced
				// nothing, and is not itself the reason (never omitted whole,
				// no line already names it), earns the same
				// "Not inferred: nothing to infer …" line `import` prints,
				// mirroring `import.ts`'s own `withEmptySchemaLines` -- folded
				// in once, ahead of both the refusal branch below and the
				// success path's own stdout, so both read the same report.
				const resultWithFullReport: InferCatalogResult = {
					...result,
					lossReport: withReportLinesBeforeWayOut(
						result.lossReport,
						"pull",
						emptySchemaLines(result, schemas),
					),
				};
				// 712/R14 (new surface, lead-approved): a pull that reads real
				// database objects but can carry none of them into the
				// contract refuses outright, mirroring `import`'s own
				// `import-nothing-to-infer`/`import-nothing-declarable` split
				// rather than writing an empty `pulled X ()` bundle.
				if (withObjects.size === 0) {
					const namedOmissions = omittedNamedSchemas(result, schemas);
					if (namedOmissions.length === 0) {
						throwNothingToInfer(schemas);
					}
					return nothingDeclarableResult(
						resultWithFullReport.lossReport,
						namedOmissions,
					);
				}
				const payload = exportPayloadFromCatalog(
					result.description,
					result.snapshot,
				);
				const origin: ContractOrigin = {
					source: "database",
					database,
					schemas: sortedSchemas,
				};
				const contractText = emitContract(payload, origin);
				const schemaText = serializeExportDescription(payload);
				const sqlText = `${result.sql}\n`;
				mkdirSync(vendorDirPath(cwd), { recursive: true });
				writeFileSync(vendorSchemaPath(cwd), schemaText);
				writeFileSync(vendorSqlPath(cwd), sqlText);
				writeFileSync(vendorContractPath(cwd), contractText);
				writeLock(cwd, {
					generatedBy: "hejbro pull",
					database,
					schemas: sortedSchemas,
					schemaHash: sha256Hex(schemaText),
					sqlHash: sha256Hex(sqlText),
					contractHash: sha256Hex(contractText),
				});
				return {
					exitCode: 0,
					stdout: [
						`pulled ${database} (${sortedSchemas.join(", ")})`,
						...resultWithFullReport.lossReport,
					],
					stderr: null,
				};
			},
			deps.importer,
			loaded?.config.driver,
		);
	} catch (error) {
		return errorReport(error);
	}
};

/** The `hejbro pull` citty subcommand -- see {@link runPull}. */
export const pullCommand = defineCommand({
	meta: {
		name: "pull",
		description: PULL_DESCRIPTION,
	},
	args: PULL_ARGS,
	run: async (ctx) => {
		const result = await runPull(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
