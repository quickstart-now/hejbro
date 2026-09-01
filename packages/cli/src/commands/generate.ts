import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	BannerHashes,
	ConfirmDropSpec,
	Diagnostic as CoreDiagnostic,
	HejbroError,
	RenameAmbiguity,
	RenameSpec,
	Snapshot,
} from "@hejbro/core";
import {
	deriveSlug,
	generateMigrations,
	hejbroError,
	migrationFileName,
	parseSnapshot,
	renderSnapshot,
	requiredKeysByKind,
	throwHejbroError,
} from "@hejbro/core";
import { defineCommand } from "citty";
import { requireConfigFields } from "../config-required";
import type { Diagnostic } from "../diagnostics";
import {
	fromHejbroError,
	fromWarning,
	renderDiagnostics,
} from "../diagnostics";
import { asHejbroError } from "../errors";
import { buildExportDescription } from "../export/description";
import { buildSquashedSql } from "../export/squash";
import { writeExport } from "../export/write";
import {
	normalizeEqualsFlags,
	parseConfirmDropFlag,
	parseRenameFlag,
} from "../flags";
import { sha256Hex } from "../hash";
import { identityFromMessage } from "../identity";
import { loadConfig, loadDeclarations, ONBOARDING_EXAMPLE } from "../loader";
import { buildRegistry, configValidators } from "../presets";
import { buildAmbiguityDiagnostic } from "../rename-diagnostics";
import { listMigrationFiles, readSnapshotFileText } from "../snapshot-file";
import { CLI_VERSION } from "../version";

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
	export: {
		type: "boolean",
		description:
			"write a schema export (description, squashed SQL, format record) into .hejbro/export/ alongside the migration (opt-in)",
	},
} as const;

/**
 * The `GENERATE_ARGS` keys a baseline can never use (#445, nit; review
 * R-b): a baseline diffs against an empty snapshot, so nothing exists yet
 * to rename or drop. The one list both `BASELINE_ARGS` (the `--help`
 * surface, below) and `BASELINE_INAPPLICABLE_FLAGS` (the pre-parse
 * refusal) derive from, so the two can never drift into naming different
 * sets of flags.
 */
const BASELINE_EXCLUDED_ARG_KEYS: ReadonlyArray<keyof typeof GENERATE_ARGS> = [
	"rename",
	"confirm-drop",
];

/** `hejbro baseline`'s own `--help` args: {@link GENERATE_ARGS} minus {@link BASELINE_EXCLUDED_ARG_KEYS}, so the descriptions above stay the single source citty renders for both commands. */
const BASELINE_ARGS = Object.fromEntries(
	Object.entries(GENERATE_ARGS).filter(
		([key]) =>
			!(BASELINE_EXCLUDED_ARG_KEYS as ReadonlyArray<string>).includes(key),
	),
) as Omit<typeof GENERATE_ARGS, (typeof BASELINE_EXCLUDED_ARG_KEYS)[number]>;

/** {@link BASELINE_EXCLUDED_ARG_KEYS}, spelled as the `--`-prefixed tokens `rawArgs` actually carries. */
const BASELINE_INAPPLICABLE_FLAGS: ReadonlyArray<string> =
	BASELINE_EXCLUDED_ARG_KEYS.map((key) => `--${key}`);

/**
 * Pre-parse intercept (#445, nit): catches `--rename`/`--confirm-drop` on
 * `rawArgs` directly, before either flag's value is ever parsed into a
 * `RenameSpec`/`ConfirmDropSpec` and before config/declarations load --
 * the lead explicitly rejected letting citty's own unknown-flag dump do
 * this job (its message doesn't say why the flag is inapplicable, or what
 * to run instead).
 */
const assertBaselineFlagsApplicable = (
	mode: GenerateMode,
	rawArgs: ReadonlyArray<string>,
): void => {
	if (mode !== "baseline") {
		return;
	}
	const disallowed = BASELINE_INAPPLICABLE_FLAGS.find((flag) =>
		rawArgs.includes(flag),
	);
	if (disallowed === undefined) {
		return;
	}
	// #445 review B5: the message has exactly one quoted substring -- the
	// solution command -- and identityFromMessage takes the first quoted
	// substring as the diagnostic's own identity (matches
	// error[config-not-found]: hejbro.config.ts's own convention).
	// Backtick-quoting the command instead (repo convention for a command
	// name, loader.ts's own `` `hejbro init` ``) leaves no quoted
	// substring at all, so the identity falls through to fallbackIdentity
	// (the config path) instead. Kept as a comment ABOVE this call, not
	// between its two arguments: check-next-marker.mjs's argument scan is
	// text-based, not a real parser, and a comma anywhere in an inline
	// comment between the code and message arguments (as this one used to
	// have, in "command name, loader.ts's own") splits them wrong, hiding
	// a real "Next:" clause from the gate.
	throwHejbroError(
		"baseline-flag-not-applicable",
		`baseline does not accept ${disallowed}: a baseline diffs against an empty snapshot, so there is nothing to rename and nothing to drop. Next: run \`hejbro generate\` instead to record a change to an already-adopted project.`,
	);
};

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

/** The identity to report for a fatal `catch`-level error: the snapshot's
 * own path for a malformed-snapshot failure (there's no declaration to
 * point at), `fallbackIdentity` otherwise. */
const identityForGenerateError = (
	error: HejbroError,
	snapshotPath: string,
	fallbackIdentity: string,
): string => {
	if (error.code === "malformed-snapshot-node") {
		return snapshotPath;
	}
	return fallbackIdentity;
};

const toDiagnostic = (
	error: HejbroError,
	fallbackIdentity: string,
	cwd: string,
): Diagnostic =>
	fromHejbroError(
		// Rebuilt via the factory, not `{ ...error, declaredAt: ... }` —
		// `HejbroError` is an `Error` subclass, and `Error.prototype.message`
		// is own-but-non-enumerable, so an object spread silently drops it
		// (empirically confirmed; caught by test/golden.test.ts's exact-text
		// pins once HejbroError became a class). The factory's signature
		// also means a future field addition fails to compile here instead
		// of failing silently the same way.
		hejbroError(
			error.code,
			error.message,
			relativizeDeclaredAt(error.declaredAt, cwd),
		),
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

/** `["${N} warning(s) — see below"]` when there are warnings, else `[]` — inserted into stdout right after the `wrote <file>` line (O3), so a stdout-only consumer still learns warnings exist. */
const warningSummaryLines = (
	warnings: ReadonlyArray<CoreDiagnostic>,
): ReadonlyArray<string> => {
	if (warnings.length === 0) {
		return [];
	}
	return [`${warnings.length} warning(s) — see below`];
};

/** Renders every preset validator warning to the stderr block generate prints alongside its success stdout (O3, D55) — `null` when there are none. Exit code stays 0: warnings never block generation. */
const warningStderr = (
	warnings: ReadonlyArray<CoreDiagnostic>,
	fallbackIdentity: string,
): string | null => {
	if (warnings.length === 0) {
		return null;
	}
	return renderDiagnostics(
		warnings.map((warning) =>
			fromWarning(
				warning,
				identityFromMessage(warning.message, fallbackIdentity),
			),
		),
		null,
	);
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
/**
 * What this run is for. `"baseline"` is the brownfield adoption path
 * (#385): the same pipeline, but it refuses to run over an existing chain,
 * marks the emitted migration as already-applied, and reports the adoption
 * steps instead of the usual one-liner. One pipeline, not a second copy —
 * a baseline IS a first migration, and everything about how it is built,
 * hashed and chained has to stay identical or `verify` would reject it.
 */
export type GenerateMode = "generate" | "baseline";

/** Names what makes this project ineligible for a baseline, for the error's own message. */
const baselineBlockerText = (
	migrationCount: number,
	migrationsDir: string,
	previousSnapshotIsEmpty: boolean,
): string => {
	if (previousSnapshotIsEmpty) {
		return `found ${migrationCount} migration(s) in "${migrationsDir}"`;
	}
	if (migrationCount === 0) {
		return "the snapshot already records declared objects";
	}
	return `found ${migrationCount} migration(s) in "${migrationsDir}" and a snapshot that already records declared objects`;
};

/**
 * #445/D2 review R-d: `declarationCount` dropped -- every actual
 * declaration kind (schema, table, grant, ...) contributes at least one
 * object to a diff against an empty snapshot (probed directly: a
 * schema-only and a grant-only declaration set each produced a `create`
 * change), and `assertBaselineIsFirst` above guarantees the snapshot is
 * empty in this mode. There is no declaration set that both parses as a
 * `HejbroInput` and diffs to nothing, so the only way this branch is ever
 * reached is an empty declarations array -- one sentence, not two branches
 * for a state that can't happen.
 *
 * That flat claim rests on a premise, not a proof: every declared kind
 * fans out to at least one snapshot object. It depends on today's kind
 * set staying that way -- a future kind that can legitimately fan out to
 * zero would make this message false, not just incomplete. The one
 * candidate this could plausibly fail on -- `grant(...).to()` called with
 * no role, which contributes no `GrantDeclaration` at all -- is already
 * excluded before it gets here: `dsl/grant.ts`'s `buildRolesStage` throws
 * `grant-missing-roles` at declaration time, so it can never reach
 * `generateMigration`'s `declarations` array as a zero-fanout input.
 */
const throwBaselineNothingToAdopt = (entry: ReadonlyArray<string>): never => {
	const entryPhrase = entry.map((pattern) => `"${pattern}"`).join(", ");
	throwHejbroError(
		"baseline-nothing-to-adopt",
		`baseline found nothing to adopt: your declaration files loaded, but exported no hejbro declarations (schema/table/... calls). Next: check ${entryPhrase} in hejbro.config.ts -- either the entry pattern isn't matching the files you meant, or those files don't actually export their schema/table declarations.`,
	);
};

/** `hejbro baseline` refuses unless the project is at its `init` state: a baseline IS a first migration, and there is nothing to baseline against a chain that already exists. */
const assertBaselineIsFirst = (
	migrationCount: number,
	previousSnapshotIsEmpty: boolean,
	migrationsDir: string,
): void => {
	if (migrationCount === 0 && previousSnapshotIsEmpty) {
		return;
	}
	throwHejbroError(
		"baseline-not-first",
		`baseline only runs on a project with no migrations yet — ${baselineBlockerText(migrationCount, migrationsDir, previousSnapshotIsEmpty)}. Next: a baseline is the FIRST migration of a database hejbro is adopting. To record a change to an already-adopted project, run "hejbro generate" instead.`,
	);
};

type MigrationFileNameOptions = Parameters<typeof migrationFileName>[0];

/**
 * One migration `generateMigrations` returned. Structural, not imported:
 * [G4 rework, #610] `@hejbro/core`'s public surface re-exports only the two
 * entry points themselves, never their result types (the "0 new symbols
 * beyond `generateMigrations` itself" ruling) -- so this reads the shape
 * off the function's own return type instead of naming it.
 */
type GeneratedMigration = ReturnType<
	typeof generateMigrations
>["migrations"][number];

/**
 * [design, task 4.4, generalized for #610] Every migration after the
 * first needs naming options distinct from its predecessors' under every
 * prefix strategy -- measured: `index` is the only one of the three that
 * resolves from a count, so bumping `previousCount` once per predecessor
 * is enough there; `timestamp`/`unix` derive their whole prefix from the
 * clock alone, at one-second resolution, so the clock itself has to move
 * by one second per predecessor instead. `verify` refuses a chain whose
 * migrations share a version -- and does more than fail: chain linearity
 * and the tip check are skipped, so a version collision here would
 * disable the very checks that would describe it.
 */
const fileNameOptionsForIndex = (
	first: MigrationFileNameOptions,
	index: number,
): MigrationFileNameOptions => {
	if (index === 0) {
		return first;
	}
	if (first.strategy === "index") {
		return { ...first, previousCount: first.previousCount + index };
	}
	return {
		...first,
		generatedAt: new Date(first.generatedAt.getTime() + index * 1000),
	};
};

/**
 * `bannerHashes[i].parent` chains from the *previous* migration's own
 * snapshot -- `previousSnapshot` itself for the first migration, the
 * prior migration's own `snapshot` for every one after it -- matching
 * `generateMigrations`' own `bannerHashes` contract (index-aligned, D33's
 * hash chain). Hashing itself stays here; core never hashes.
 */
const bannerHashesForMigrations = (
	previousSnapshot: Snapshot,
	migrations: ReadonlyArray<GeneratedMigration>,
): ReadonlyArray<BannerHashes> =>
	migrations.map((migration, index) => {
		const parentSnapshot = migrations[index - 1]?.snapshot ?? previousSnapshot;
		return {
			parent: `sha256:${sha256Hex(renderSnapshot(parentSnapshot))}`,
			current: `sha256:${sha256Hex(renderSnapshot(migration.snapshot))}`,
		};
	});

type WrittenMigration = {
	readonly relativePath: string;
	readonly sql: string;
};

/**
 * [task 4.3/4.4/4.5, generalized for #610] One relative path + its own
 * SQL (banner included -- `generateMigrations` already assembled it) per
 * migration the run needs -- writing nothing itself (the caller still owns
 * `mkdirSync`/`writeFileSync`, matching the pre-#610 shape).
 */
const buildWrittenMigrations = (
	migrations: ReadonlyArray<GeneratedMigration>,
	migrationsDir: string,
	firstFileNameOptions: MigrationFileNameOptions,
	nameOverride: string | undefined,
): ReadonlyArray<WrittenMigration> =>
	migrations.map((migration, index) => {
		const slug = nameOverride ?? deriveSlug(migration.changes);
		const fileName = migrationFileName({
			...fileNameOptionsForIndex(firstFileNameOptions, index),
			slug,
		});
		return {
			relativePath: join(migrationsDir, fileName),
			sql: migration.sql,
		};
	});

/**
 * The report's opening lines: one `wrote` line per migration the run
 * needed (never just the first -- the pre-#610 split path already printed
 * two). A baseline never reaches more than one: a baseline's every change
 * is a `create` (never `alter`), which `engine/split.ts`'s own condition
 * never splits on. A baseline's lines differ beyond that because the next
 * step differs and getting it wrong is expensive: running a baseline
 * migration against the database it describes fails on the first
 * `create`, and "already exists" is a confusing way to learn that the file
 * was never meant to be run.
 */
const reportHead = (
	mode: GenerateMode,
	declarationCount: number,
	writtenMigrations: ReadonlyArray<WrittenMigration>,
): ReadonlyArray<string> => {
	if (mode === "baseline") {
		const migrationRelativePath = writtenMigrations[0]?.relativePath ?? "";
		return [
			"hejbro baseline",
			`loaded ${declarationCount} declarations`,
			`wrote ${migrationRelativePath}`,
			"",
			"This migration describes objects your database already has.",
			`Next: run \`hejbro migrate\` to register ${migrationRelativePath} as applied without running it, then run \`hejbro check\` to confirm your declarations match the live schema. From here on, \`hejbro generate\` emits only what changes.`,
		];
	}
	return [
		"hejbro generate",
		`loaded ${declarationCount} declarations`,
		...writtenMigrations.map((written) => `wrote ${written.relativePath}`),
	];
};

export const runGenerate = async (
	cwd: string,
	argv: ReadonlyArray<string>,
	now: () => Date = () => new Date(),
	mode: GenerateMode = "generate",
): Promise<GenerateResult> => {
	// Normalized once, here, before anything else sees it: flag-value
	// collection below and the rerun-command suggestion (buildDiagnostics
	// → buildAmbiguityDiagnostic → rerun.ts, fed this same `rawArgs`)
	// both assume `[flag, value]` as two separate tokens — a single
	// `--flag=value` token would otherwise misparse in both places, and
	// in rerun.ts's case, corrupt every pair after it too. One shared
	// normalization point means a flag added later doesn't need its own.
	const rawArgs = normalizeEqualsFlags(argv);
	const parsedArgv = parseGenerateArgv(rawArgs);
	const exportEnabled = rawArgs.includes("--export");
	const fallbackIdentity = parsedArgv.configFlag ?? "hejbro.config.ts";
	try {
		assertBaselineFlagsApplicable(mode, rawArgs);
		const renames: ReadonlyArray<RenameSpec> =
			parsedArgv.renameValues.map(parseRenameFlag);
		const confirmedDrops: ReadonlyArray<ConfirmDropSpec> =
			parsedArgv.confirmDropValues.map(parseConfirmDropFlag);

		const { config, configPath } = await loadConfig(cwd, parsedArgv.configFlag);
		requireConfigFields(config, mode, [
			"migrationsDir",
			"snapshotPath",
			"prefixStrategy",
		]);
		const declarations = await loadDeclarations(configPath, config);

		// Nested, not the outer catch: a `malformed-snapshot-node` error
		// (#26) is about the on-disk snapshot, not `hejbro.config.ts` --
		// once `config` has loaded, `config.snapshotPath` is the correct
		// identity for it, and `config` is only in scope for a catch
		// nested inside this same block (the outer catch also handles
		// config-loading failures, before `config` exists at all).
		try {
			const registry = buildRegistry(config);
			const previousSnapshot = parseSnapshot(
				readSnapshotFileText(cwd, config, mode),
				requiredKeysByKind(registry),
			);
			const validators = configValidators(config);

			if (mode === "baseline") {
				assertBaselineIsFirst(
					listMigrationFiles(join(cwd, config.migrationsDir)).length,
					Object.keys(previousSnapshot.objects).length === 0,
					config.migrationsDir,
				);
			}
			// [task 4.1, generalized for #610] First pass, no `bannerHashes` --
			// learns each migration's own `changes`/`snapshot` (one entry, or
			// two where `engine/split.ts`'s own condition needs a transaction
			// boundary), which is what hashing the chain below needs.
			const firstPass = generateMigrations({
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
			// D106 M2: a repository whose snapshot already matches its
			// declarations must still be able to produce its *first* export --
			// otherwise `generate --export` is a no-op there forever (`baseline
			// --export` is refused once migrations exist), and the schema
			// repository's export directory never comes to exist at all. Reused
			// by both branches below: the no-difference return (this export is
			// the only artifact that run writes) and the ordinary
			// difference-found path further down.
			const writeExportArtifact = (snapshot: Snapshot): void => {
				const description = buildExportDescription(
					declarations,
					declarations.exportNames,
				);
				writeExport(
					cwd,
					{ ...description, snapshot },
					buildSquashedSql(declarations, registry, validators),
				);
			};
			if (!firstPass.hasChanges) {
				if (mode === "baseline") {
					throwBaselineNothingToAdopt(config.entry);
				}
				if (exportEnabled) {
					// No changes means the declared state already matches
					// `previousSnapshot` (`generateMigrations` returns no
					// migrations, and so no snapshot, exactly when there is
					// nothing to diff) -- this is that state's own export.
					writeExportArtifact(previousSnapshot);
				}
				return {
					exitCode: 0,
					stdout: ["no changes — snapshot already matches your declarations."],
					stderr: null,
				};
			}

			const migrationsDirPath = join(cwd, config.migrationsDir);
			const previousCount = listMigrationFiles(migrationsDirPath).length;

			const finalPass = generateMigrations({
				declarations,
				previousSnapshot,
				renames,
				confirmedDrops,
				bannerHashes: bannerHashesForMigrations(
					previousSnapshot,
					firstPass.migrations,
				),
				hejbroVersion: CLI_VERSION,
				baseline: mode === "baseline",
				registry,
				validators,
			});

			const writtenMigrations = buildWrittenMigrations(
				finalPass.migrations,
				config.migrationsDir,
				{
					strategy: config.prefixStrategy,
					generatedAt: now(),
					previousCount,
					slug: "",
				},
				parsedArgv.name,
			);
			// `finalPass.migrations` is never `[]` here: `firstPass.hasChanges`
			// is already `true`, and `finalPass` runs the identical pipeline
			// (same `declarations`/`previousSnapshot`/`renames`/
			// `confirmedDrops`) with only banner metadata added -- metadata
			// `runPipeline`/`planSplit` never read -- so it diffs to the same
			// non-empty `migrations` `firstPass` already proved.
			const finalSnapshot = finalPass.migrations.at(-1)?.snapshot as Snapshot;

			mkdirSync(migrationsDirPath, { recursive: true });
			writtenMigrations.map((written) =>
				writeFileSync(join(cwd, written.relativePath), `${written.sql}\n`),
			);
			writeFileSync(
				join(cwd, config.snapshotPath),
				renderSnapshot(finalSnapshot),
			);
			if (exportEnabled) {
				// Reuses the same last-migration snapshot the write above
				// already derived (`finalPass.migrations` is never `[]`
				// here -- see that constant's own comment) rather than
				// re-deriving it a second way.
				writeExportArtifact(finalSnapshot);
			}

			return {
				exitCode: 0,
				stdout: [
					...reportHead(mode, declarations.length, writtenMigrations),
					...warningSummaryLines(finalPass.warnings),
					...writtenMigrations.map(
						(written) => written.sql.split("\n\n")[0] ?? "",
					),
				],
				stderr: warningStderr(finalPass.warnings, fallbackIdentity),
			};
		} catch (error) {
			const hejbroErr = asHejbroError(error);
			const identity = identityForGenerateError(
				hejbroErr,
				config.snapshotPath,
				fallbackIdentity,
			);
			return errorResult([hejbroErr], [], rawArgs, identity, cwd);
		}
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

const BASELINE_DESCRIPTION =
	"Adopt an existing database: write the first migration as a baseline (already applied) plus its snapshot";

/** The `hejbro baseline` citty subcommand — {@link runGenerate} in `"baseline"` mode (#385). */
export const baselineCommand = defineCommand({
	meta: {
		name: "baseline",
		description: BASELINE_DESCRIPTION,
	},
	args: BASELINE_ARGS,
	run: async (ctx) => {
		const result = await runGenerate(
			process.cwd(),
			ctx.rawArgs,
			() => new Date(),
			"baseline",
		);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
