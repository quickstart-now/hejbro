import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import {
	enumsInSnapshot,
	sequencesInSnapshot,
	tablesInSnapshot,
} from "../contract/read-snapshot";
import type { DeclareEmitFile } from "../declare-emit/emit";
import { emitDeclarationFiles } from "../declare-emit/emit";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { collectFlagValues, normalizeEqualsFlags } from "../flags";
import type { InferCatalogOptions, InferCatalogResult } from "../infer/compose";
import { inferFromCatalog } from "../infer/compose";

const IMPORT_DESCRIPTION =
	"Write one starter declaration file per schema from a live database's catalog.";

// Mirrors check.ts's own `CHECK_ARGS` -- only `--help` reads this block;
// the real parsing is by hand from `ctx.rawArgs` below, since `--schema`
// is repeatable and citty's own `args` schema has no such shape here.
const IMPORT_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
	schema: {
		type: "string",
		description: "schema to read (repeatable, required, no default)",
	},
	out: {
		type: "string",
		description:
			"directory to write starter declaration files into (required, no default)",
	},
} as const;

const lastFlagValue = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): string | undefined => collectFlagValues(rawArgs, flagName).at(-1);

export type ImportResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const FIRST_QUOTED_SUBSTRING = /"([^"]+)"/;

/** Same identity-extraction heuristic as check.ts/verify.ts/generate.ts's own copies. */
const identityFromMessage = (message: string, fallback: string): string => {
	const match = FIRST_QUOTED_SUBSTRING.exec(message);
	if (match === null) {
		return fallback;
	}
	return match[1] ?? fallback;
};

const FALLBACK_IDENTITY = "hejbro import";

const errorReport = (error: unknown): ImportResult => {
	const importError = asHejbroError(error);
	const diagnostic = fromHejbroError(
		importError,
		identityFromMessage(importError.message, FALLBACK_IDENTITY),
	);
	return {
		exitCode: 1,
		stdout: [],
		stderr: renderDiagnostics([diagnostic], null),
	};
};

const throwMissingSchema = (): never =>
	throwHejbroError(
		"import-schema-missing",
		"hejbro import needs at least one \"--schema\" to read, and none was given: a database's schemas include its platform's own (auth, storage, and their neighbours on a hosted Postgres), so there is no default this command can guess. Next: pass one or more --schema <name> flags, most commonly --schema public, then rerun `hejbro import`.",
	);

const throwMissingOut = (): never =>
	throwHejbroError(
		"import-destination-missing",
		'hejbro import needs "--out" to name the directory it writes starter declaration files into, and it was not given. Next: pass --out <directory>, then rerun `hejbro import`.',
	);

/**
 * The set of schema names carrying at least one inferred table, enum or
 * sequence -- read from each object's own `.schema` field (`tablesInSnapshot`/
 * `enumsInSnapshot`/`sequencesInSnapshot`, `contract/read-snapshot.ts`),
 * never by splitting a snapshot key string: a schema name can itself
 * contain a `.` (D106 N6's own fixture, `"a.b"`), so `"table:a.b.widgets"`
 * cannot be split back into schema/table reliably by punctuation alone.
 */
const schemasWithInferredObjects = (
	result: InferCatalogResult,
): ReadonlySet<string> =>
	new Set([
		...tablesInSnapshot(result.snapshot).map((t) => t.schema),
		...enumsInSnapshot(result.snapshot).map((e) => e.schema),
		...sequencesInSnapshot(result.snapshot).map((s) => s.schema),
	]);

const throwNothingToInfer = (schemas: ReadonlyArray<string>): never =>
	throwHejbroError(
		"import-nothing-to-infer",
		`hejbro import found no table, enum, or sequence to infer in schema(s) ${schemas.join(", ")}. Next: confirm the schema name(s) are correct and that the database holds objects in them, then rerun \`hejbro import\`.`,
	);

/**
 * D106 N7: when *some* (not all) named schemas hold nothing, `import`
 * used to write files for the ones that do and say nothing at all about
 * the ones that don't -- neither a file nor a diagnostic named the
 * gap. One line per empty schema; the all-empty case is unchanged
 * (`throwNothingToInfer` above still refuses outright, before any file
 * is written).
 *
 * D106 R4-B4/#707: this line is suppressed for a schema
 * `result.omittedSchemaNames` already names -- "nothing to infer" is
 * false there: there *was* something, hejbro just could not carry its
 * name, and the loss report's own `Omitted: schema …` line already
 * says so with the real reason. Stating both would tell the reader two
 * different stories about the same schema.
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
		.map(
			(schemaName) =>
				`Not inferred: nothing to infer in schema "${schemaName}".`,
		);
};

/**
 * D106 R2-N3: the empty-schema lines used to reach stdout only, so a
 * file's own header carried a strictly smaller report than the run
 * printed. `emptySchemaLines` depends only on `result` and the raw
 * `--schema` list (both known before `emitDeclarationFiles` runs), so
 * folding them into `result.lossReport` here -- before emission -- makes
 * every written file's header carry the same full report the terminal
 * does, with the same one array feeding both.
 */
const withEmptySchemaLines = (
	result: InferCatalogResult,
	schemas: ReadonlyArray<string>,
): InferCatalogResult => ({
	...result,
	lossReport: [...result.lossReport, ...emptySchemaLines(result, schemas)],
});

const targetPath = (out: string, file: DeclareEmitFile): string =>
	join(out, `${file.fileBaseName}.schema.ts`);

/**
 * Groups planned files by the on-disk path they would write to, compared
 * case-insensitively (D106 N6: `safeFileBaseName` folds every character
 * outside `[A-Za-z0-9_-]` to `_`, so schemas like `"a.b"` and `"a b"`
 * both become `a_b`, and a case-insensitive filesystem -- macOS's own
 * default -- also folds `"Users"`/`"users"`). Same `.reduce()`-into-`Map`
 * shape `declare-emit/emit.ts`'s own `groupBySchema` uses.
 */
const groupByPlannedPath = (
	out: string,
	files: ReadonlyArray<DeclareEmitFile>,
): ReadonlyMap<string, ReadonlyArray<DeclareEmitFile>> =>
	files.reduce((map, file) => {
		const key = targetPath(out, file).toLowerCase();
		const existing = map.get(key) ?? [];
		map.set(key, [...existing, file]);
		return map;
	}, new Map<string, ReadonlyArray<DeclareEmitFile>>());

const describeCollisionGroup = (
	out: string,
	group: ReadonlyArray<DeclareEmitFile>,
): string =>
	group
		.map((file) => `"${file.schema}" -> "${targetPath(out, file)}"`)
		.join(", ");

/**
 * Refuses before any file is written if two or more schemas plan to
 * write the same on-disk path (D106 N6) -- without this,
 * `throwIfAnyFileExists` only ever checks a prospective path against
 * disk, never against the *other* prospective paths in the same run, so
 * the second schema's write would silently overwrite the first's.
 */
const throwIfPlannedFilesCollide = (
	out: string,
	files: ReadonlyArray<DeclareEmitFile>,
): void => {
	const collisions = [...groupByPlannedPath(out, files).values()].filter(
		(group) => group.length > 1,
	);
	if (collisions.length === 0) {
		return;
	}
	const described = collisions
		.map((group) => describeCollisionGroup(out, group))
		.join("; ");
	throwHejbroError(
		"import-destination-collision",
		`hejbro import would write more than one schema's starter file to the same path: ${described}. Next: these schema names differ only in characters a file name (or a case-insensitive filesystem) can't tell apart -- rename one of the database schemas, then rerun \`hejbro import\`.`,
	);
};

/** Refuse-before-write (spec: "import never overwrites"): every prospective file is checked against the real, resolved `outDir` before any of them is written; `out` (the raw `--out` value) is only ever used for the report's own display text. */
const throwIfAnyFileExists = (
	out: string,
	outDir: string,
	files: ReadonlyArray<DeclareEmitFile>,
): void => {
	const existing = files
		.filter((file) => existsSync(targetPath(outDir, file)))
		.map((file) => targetPath(out, file));
	if (existing.length === 0) {
		return;
	}
	throwHejbroError(
		"import-destination-exists",
		`hejbro import would overwrite ${existing.length} existing file(s): ${existing.join(", ")}. Next: remove or move the listed file(s) (import never overwrites), then rerun \`hejbro import\`.`,
	);
};

const writeFiles = (
	outDir: string,
	out: string,
	files: ReadonlyArray<DeclareEmitFile>,
): ReadonlyArray<string> => {
	try {
		mkdirSync(outDir, { recursive: true });
		return files.map((file) => {
			writeFileSync(targetPath(outDir, file), file.source);
			return `created ${targetPath(out, file)}`;
		});
	} catch (error) {
		return throwHejbroError(
			"import-destination-unwritable",
			`hejbro import could not write to "${out}": ${(error as Error).message}. Next: confirm the directory is writable, then rerun \`hejbro import\`.`,
		);
	}
};

/**
 * `import`'s own dependency seam (mirrors `check.ts`'s `importer`
 * parameter): a test injects `inferCatalog` to control the inferred
 * result directly, without a real Postgres catalog behind
 * `withCheckConnection`'s fake driver.
 */
export type ImportDeps = {
	readonly importer?: CheckDriverImporter;
	readonly inferCatalog?: (
		options: InferCatalogOptions,
	) => Promise<InferCatalogResult>;
};

/**
 * `hejbro import`'s own thin orchestration: resolve `--schema`(s)/`--out`
 * (both required, no default -- spec: "import writes starter declarations
 * from a database"), connect exactly as `check` does, infer
 * (`inferFromCatalog`, the single entry point Group 1 built), refuse
 * before writing anything if the destination already holds a colliding
 * file or if the named schemas hold nothing to infer, then write every
 * file and print the loss report. Every precondition (`--schema`,
 * `--out`) is checked before opening a connection, matching `check.ts`'s
 * own `requireConfigFields`-before-`withCheckConnection` ordering.
 */
export const runImport = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
	deps: ImportDeps = {},
): Promise<ImportResult> => {
	try {
		const normalized = normalizeEqualsFlags(argv);
		const urlFlag = lastFlagValue(normalized, "--url");
		const schemas = collectFlagValues(normalized, "--schema");
		if (schemas.length === 0) {
			throwMissingSchema();
		}
		const out = lastFlagValue(normalized, "--out") ?? throwMissingOut();
		const outDir = resolve(cwd, out);
		const inferCatalog = deps.inferCatalog ?? inferFromCatalog;
		return await withCheckConnection(
			urlFlag,
			process.env,
			{
				commandName: "hejbro import",
				codes: {
					connectionMissing: "import-connection-missing",
					driverMissing: "import-driver-missing",
					connectionFailed: "import-connection-failed",
				},
			},
			async (driver) => {
				const result = await inferCatalog({
					session: driver,
					schemas,
					command: "import",
				});
				if (schemasWithInferredObjects(result).size === 0) {
					throwNothingToInfer(schemas);
				}
				const resultWithFullReport = withEmptySchemaLines(result, schemas);
				const files = emitDeclarationFiles(resultWithFullReport);
				throwIfPlannedFilesCollide(out, files);
				throwIfAnyFileExists(out, outDir, files);
				const created = writeFiles(outDir, out, files);
				return {
					exitCode: 0,
					stdout: [...created, ...resultWithFullReport.lossReport],
					stderr: null,
				};
			},
			deps.importer,
		);
	} catch (error) {
		return errorReport(error);
	}
};

/** The `hejbro import` citty subcommand -- see {@link runImport}. */
export const importCommand = defineCommand({
	meta: {
		name: "import",
		description: IMPORT_DESCRIPTION,
	},
	args: IMPORT_ARGS,
	run: async (ctx) => {
		const result = await runImport(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
