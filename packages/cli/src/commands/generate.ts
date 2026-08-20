import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ConfirmDropSpec,
	HejbroError,
	RenameAmbiguity,
	RenameSpec,
} from "@hejbro/core";
import {
	deriveSlug,
	generateMigration,
	migrationFileName,
	parseSnapshot,
	renderSnapshot,
} from "@hejbro/core";
import { defineCommand } from "citty";
import type { Diagnostic } from "../diagnostics";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { parseConfirmDropFlag, parseRenameFlag } from "../flags";
import { sha256Hex } from "../hash";
import { loadConfig, loadDeclarations, ONBOARDING_EXAMPLE } from "../loader";
import { buildRegistry, configValidators } from "../presets";
import { buildAmbiguityDiagnostic } from "../rename-diagnostics";
import { listMigrationFiles, readSnapshotFileText } from "../snapshot-file";

/**
 * `hejbro generate --help`'s owner-approved short-form description (④,
 * relayed verbatim) — two paragraphs, embedded blank line kept as given.
 */
const GENERATE_DESCRIPTION = `Diff your TypeScript declarations against the last snapshot and write a
new migration file.

Renames are never confirmed interactively: if hejbro can't tell a
rename from an unrelated drop and add, it exits 1 and prints the exact
--rename/--confirm-drop command to rerun (see below).`;

// citty's declarative arg parsing does not array-ify repeated flags (PR B
// finding) — `--rename`/`--confirm-drop` are parsed by hand from
// `ctx.rawArgs` below; the `args` block exists only so `--help` renders
// these owner-approved one-line descriptions (Task 15).
const GENERATE_ARGS = {
	config: {
		type: "string",
		description: "path to hejbro.config.ts (default: ./hejbro.config.ts)",
	},
	name: {
		type: "string",
		description:
			"migration slug override (default: derived from the first change, e.g. add_posts)",
	},
	rename: {
		type: "string",
		description:
			"confirm a rename: <schema>.<table>.<old>=<new> for a column, or <schema>.<old_table>=<new_table> for a table (repeatable)",
	},
	"confirm-drop": {
		type: "string",
		description:
			"confirm a genuine drop (not a rename): <schema>.<table>.<column>, or <schema>.<table> for a whole table (repeatable)",
	},
} as const;

type ParsedGenerateArgv = {
	readonly configFlag: string | undefined;
	readonly name: string | undefined;
	readonly renameValues: ReadonlyArray<string>;
	readonly confirmDropValues: ReadonlyArray<string>;
};

const collectFlagValues = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): ReadonlyArray<string> =>
	rawArgs.flatMap((token, index) => {
		if (token !== flagName) {
			return [];
		}
		const value = rawArgs[index + 1];
		if (value === undefined) {
			return [];
		}
		return [value];
	});

const lastFlagValue = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): string | undefined => {
	const values = collectFlagValues(rawArgs, flagName);
	return values.at(-1);
};

const parseGenerateArgv = (
	rawArgs: ReadonlyArray<string>,
): ParsedGenerateArgv => ({
	configFlag: lastFlagValue(rawArgs, "--config"),
	name: lastFlagValue(rawArgs, "--name"),
	renameValues: collectFlagValues(rawArgs, "--rename"),
	confirmDropValues: collectFlagValues(rawArgs, "--confirm-drop"),
});

const FIRST_QUOTED_SUBSTRING = /"([^"]+)"/;

/**
 * Interim identity-extraction heuristic: every owner-approved flat message
 * (Task 13/14) leads with the object it's about inside the first `"..."` —
 * a table/schema identity, or a flag value when the message is about a
 * flag. Pending planner/owner confirmation on whether ambiguous-*-rename
 * diagnostics should carry richer structured suggestions (flagged
 * upstream) — this keeps `error[<code>]: <identity>` headers meaningful
 * without requiring core to expose extra structured fields on
 * `HejbroError`, and is cheap to replace once that's decided.
 */
const identityFromMessage = (message: string, fallback: string): string => {
	const match = FIRST_QUOTED_SUBSTRING.exec(message);
	if (match === null) {
		return fallback;
	}
	return match[1] ?? fallback;
};

const FILE_URL_PREFIX = "file://";

/**
 * `declaredAt` (core's `captureDeclarationSite`) is always an absolute
 * path or `file://` URL — V8 stack traces have no notion of "relative to
 * what." Stripping `cwd` here (never in core, which has no cwd concept)
 * keeps the CLI's own "no absolute paths in output" rule (Task 14) — a
 * location outside `cwd` (e.g. a linked package) falls back to the
 * `file://`-stripped absolute path rather than a nonsensical `../../…`.
 */
const stripFileUrlPrefix = (location: string): string => {
	if (location.startsWith(FILE_URL_PREFIX)) {
		return location.slice(FILE_URL_PREFIX.length);
	}
	return location;
};

const relativizeLocation = (location: string, cwd: string): string => {
	const withoutFileUrl = stripFileUrlPrefix(location);
	const cwdPrefix = `${cwd}/`;
	if (withoutFileUrl.startsWith(cwdPrefix)) {
		return withoutFileUrl.slice(cwdPrefix.length);
	}
	return withoutFileUrl;
};

const relativizeDeclaredAt = (
	declaredAt: string | null,
	cwd: string,
): string | null => {
	if (declaredAt === null) {
		return null;
	}
	return relativizeLocation(declaredAt, cwd);
};

const toDiagnostic = (
	error: HejbroError,
	fallbackIdentity: string,
	cwd: string,
): Diagnostic =>
	fromHejbroError(
		{ ...error, declaredAt: relativizeDeclaredAt(error.declaredAt, cwd) },
		identityFromMessage(error.message, fallbackIdentity),
	);

const pluralize = (count: number, noun: string): string => {
	if (count === 1) {
		return `${count} ${noun}`;
	}
	return `${count} ${noun}s`;
};

/** Owner-approved batch summary lines (decision ⑥) — only defined for a batch made entirely of ambiguous-*-rename diagnostics; other multi-error batches get no summary line (no approved text for that case). */
const batchSummary = (errors: ReadonlyArray<HejbroError>): string | null => {
	if (errors.length < 2) {
		return null;
	}
	const columnCount = errors.filter(
		(error) => error.code === "ambiguous-column-rename",
	).length;
	const tableCount = errors.filter(
		(error) => error.code === "ambiguous-table-rename",
	).length;
	if (columnCount + tableCount !== errors.length) {
		return null;
	}
	if (tableCount === 0) {
		return `${columnCount} ambiguous column renames — resolve and rerun \`hejbro generate\`.`;
	}
	if (columnCount === 0) {
		return `${tableCount} ambiguous table renames — resolve and rerun \`hejbro generate\`.`;
	}
	return `${errors.length} ambiguous renames (${pluralize(columnCount, "column")}, ${pluralize(tableCount, "table")}) — resolve and rerun \`hejbro generate\`.`;
};

export type GenerateResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/** Appends the onboarding example (Task 13/14) below the diagnostics when the batch includes `entry-not-found` — the flat message itself never embeds it (owner-approved text), so it's a separate trailing block. */
const withOnboardingExample = (
	rendered: string,
	errors: ReadonlyArray<HejbroError>,
): string => {
	const hasEntryNotFound = errors.some(
		(error) => error.code === "entry-not-found",
	);
	if (!hasEntryNotFound) {
		return rendered;
	}
	return `${rendered}\n\n${ONBOARDING_EXAMPLE}`;
};

const AMBIGUOUS_CODES = new Set([
	"ambiguous-column-rename",
	"ambiguous-table-rename",
]);

/**
 * `ambiguities` is 1:1 with the `ambiguous-*` subset of `errors`, in the
 * same order (core's contract, `RenamePlan.ambiguities`/
 * `GenerateMigrationResult.ambiguities`) — zips them back together by
 * position rather than by re-deriving which error is which.
 */
const ambiguityByErrorIndex = (
	errors: ReadonlyArray<HejbroError>,
	ambiguities: ReadonlyArray<RenameAmbiguity>,
): ReadonlyMap<number, RenameAmbiguity> => {
	const ambiguousErrorIndices = errors
		.map((error, index) => ({ code: error.code, index }))
		.filter(({ code }) => AMBIGUOUS_CODES.has(code))
		.map(({ index }) => index);
	return new Map(
		ambiguousErrorIndices.map((errorIndex, position) => [
			errorIndex,
			ambiguities[position] as RenameAmbiguity,
		]),
	);
};

const buildDiagnostics = (
	errors: ReadonlyArray<HejbroError>,
	ambiguities: ReadonlyArray<RenameAmbiguity>,
	argv: ReadonlyArray<string>,
	fallbackIdentity: string,
	cwd: string,
): ReadonlyArray<Diagnostic> => {
	const byIndex = ambiguityByErrorIndex(errors, ambiguities);
	return errors.map((error, index) => {
		const ambiguity = byIndex.get(index);
		if (ambiguity === undefined) {
			return toDiagnostic(error, fallbackIdentity, cwd);
		}
		return buildAmbiguityDiagnostic(
			ambiguity,
			argv,
			relativizeDeclaredAt(ambiguity.declaredAt, cwd),
		);
	});
};

const errorResult = (
	errors: ReadonlyArray<HejbroError>,
	ambiguities: ReadonlyArray<RenameAmbiguity>,
	argv: ReadonlyArray<string>,
	fallbackIdentity: string,
	cwd: string,
): GenerateResult => {
	const diagnostics = buildDiagnostics(
		errors,
		ambiguities,
		argv,
		fallbackIdentity,
		cwd,
	);
	const rendered = renderDiagnostics(diagnostics, batchSummary(errors));
	return {
		exitCode: 1,
		stdout: [],
		stderr: withOnboardingExample(rendered, errors),
	};
};

const asHejbroError = (error: unknown): HejbroError => {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		"message" in error
	) {
		return error as HejbroError;
	}
	throw error;
};

/**
 * `hejbro generate`'s full flow (Task 13): parse flags → load config +
 * declarations → read the previous snapshot → run `generateMigration`
 * (two-pass — once to get the next snapshot for hashing, once more with
 * the banner hash-chain lines baked in, per the plan) → on ambiguity
 * errors, render diagnostics and exit 1 → on no changes, print the
 * no-changes line and exit 0 → else write the migration file (clock and
 * `previousCount` injected here, never inside core) and overwrite the
 * snapshot, printing a success block that mirrors the banner.
 */
export const runGenerate = async (
	cwd: string,
	rawArgs: ReadonlyArray<string>,
	now: () => Date = () => new Date(),
): Promise<GenerateResult> => {
	const parsedArgv = parseGenerateArgv(rawArgs);
	const fallbackIdentity = parsedArgv.configFlag ?? "hejbro.config.ts";
	try {
		const renames: ReadonlyArray<RenameSpec> =
			parsedArgv.renameValues.map(parseRenameFlag);
		const confirmedDrops: ReadonlyArray<ConfirmDropSpec> =
			parsedArgv.confirmDropValues.map(parseConfirmDropFlag);

		const { config, configPath } = await loadConfig(cwd, parsedArgv.configFlag);
		const declarations = await loadDeclarations(configPath, config);
		const previousSnapshot = parseSnapshot(readSnapshotFileText(cwd, config));
		const registry = buildRegistry(config);
		const validators = configValidators(config);

		const firstPass = generateMigration({
			declarations,
			previousSnapshot,
			renames,
			confirmedDrops,
			registry,
			validators,
		});
		if (firstPass.errors.length > 0) {
			return errorResult(
				firstPass.errors,
				firstPass.ambiguities,
				rawArgs,
				fallbackIdentity,
				cwd,
			);
		}
		if (!firstPass.hasChanges) {
			return {
				exitCode: 0,
				stdout: ["no changes — snapshot already matches your declarations."],
				stderr: null,
			};
		}

		const parentHash = `sha256:${sha256Hex(renderSnapshot(previousSnapshot))}`;
		const currentHash = `sha256:${sha256Hex(renderSnapshot(firstPass.snapshot))}`;
		const finalPass = generateMigration({
			declarations,
			previousSnapshot,
			renames,
			confirmedDrops,
			bannerHashes: { parent: parentHash, current: currentHash },
			registry,
			validators,
		});

		const migrationsDirPath = join(cwd, config.migrationsDir);
		const previousCount = listMigrationFiles(migrationsDirPath).length;
		const slug = parsedArgv.name ?? deriveSlug(finalPass.changes);
		const fileName = migrationFileName({
			strategy: config.prefixStrategy,
			generatedAt: now(),
			previousCount,
			slug,
		});
		mkdirSync(migrationsDirPath, { recursive: true });
		writeFileSync(join(migrationsDirPath, fileName), `${finalPass.sql}\n`);
		writeFileSync(
			join(cwd, config.snapshotPath),
			renderSnapshot(finalPass.snapshot),
		);

		const migrationRelativePath = join(config.migrationsDir, fileName);
		const [banner] = finalPass.sql.split("\n\n");
		return {
			exitCode: 0,
			stdout: [
				"hejbro generate",
				`loaded ${declarations.length} declarations`,
				`wrote ${migrationRelativePath}`,
				banner ?? "",
			],
			stderr: null,
		};
	} catch (error) {
		return errorResult(
			[asHejbroError(error)],
			[],
			rawArgs,
			fallbackIdentity,
			cwd,
		);
	}
};

/** The `hejbro generate` citty subcommand — see {@link runGenerate}. */
export const generateCommand = defineCommand({
	meta: {
		name: "generate",
		description: GENERATE_DESCRIPTION,
	},
	args: GENERATE_ARGS,
	run: async (ctx) => {
		const result = await runGenerate(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
