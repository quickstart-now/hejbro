import { mkdirSync, writeFileSync } from "node:fs";
import { throwHejbroError } from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import { defineCommand } from "citty";
import { currentDatabaseName } from "../apply/reset";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import type { ContractOrigin } from "../contract/emit";
import { emitContract } from "../contract/emit";
import { exportPayloadFromCatalog } from "../contract/from-catalog";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { serializeExportDescription } from "../export/description";
import { collectFlagValues, normalizeEqualsFlags } from "../flags";
import { sha256Hex } from "../hash";
import type { InferCatalogOptions, InferCatalogResult } from "../infer/compose";
import { inferFromCatalog } from "../infer/compose";
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
		return await withCheckConnection(
			dbUrlFlag,
			process.env,
			{
				commandName: "hejbro pull",
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
				const sortedSchemas = [...schemas].sort();
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
						...result.lossReport,
					],
					stderr: null,
				};
			},
			deps.importer,
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
