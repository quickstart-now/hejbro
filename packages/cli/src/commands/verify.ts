import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ChainEntry,
	ChainReport,
	DuplicateVersionGroup,
	HejbroError,
	HejbroInput,
	KindRegistry,
	MigrationPrefixStrategy,
} from "@hejbro/core";
import {
	checkChain,
	emptySnapshot,
	findDuplicateVersionGroups,
	generateMigration,
	hejbroError,
	migrationVersionOf,
	parseBannerHashes,
	parseSnapshot,
	renderMigrationPrefix,
	renderSnapshot,
} from "@hejbro/core";
import { defineCommand } from "citty";
import type { HejbroConfig } from "../config";
import type { Diagnostic } from "../diagnostics";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { sha256Hex } from "../hash";
import { loadConfig, loadDeclarations } from "../loader";
import { buildRegistry } from "../presets";
import { listMigrationFiles, readSnapshotFileText } from "../snapshot-file";

const VERIFY_DESCRIPTION =
	"Check that the checked-in snapshot matches your declarations and that the migration history's hash chain is intact.";

/**
 * Owner-approved verbatim (⑥) — Task 17's `snapshot-stale` and
 * `chain-tip-mismatch` texts, and the `diverged-migrations`/
 * `broken-chain` `Next:` lines below (verify's own framing of
 * `checkChain`'s codes). See `test/verify.test.ts` for the golden pins.
 */
const snapshotStaleMessage = (snapshotPath: string): string =>
	`the checked-in snapshot at "${snapshotPath}" does not match your declarations — either the declarations changed without a new migration, or the snapshot file was hand-edited. Next: run \`hejbro generate\` and commit the result (or, if the snapshot is correct and the declarations are wrong, restore the declarations you meant).`;

const CHAIN_TIP_MISMATCH_MESSAGE =
	"the migration chain's tip hash doesn't match the current snapshot — the last migration's \"snapshot:\" hash and the on-disk snapshot's own hash disagree, which means the snapshot or the last migration file was edited after the last `hejbro generate`. Next: restore the snapshot (and the last migration file, if it was edited) from version control — the snapshot is a derived file and should only ever change through `hejbro generate`.";

/** `<migrationsDir>/<fileName>`, always POSIX-joined (`config.migrationsDir` is a shell-command path fragment here, not a filesystem path Node needs to resolve — `path.join` would use `\` on Windows and break the very command this renders). */
const migrationPath = (migrationsDir: string, fileName: string): string =>
	`${migrationsDir}/${fileName}`;

/**
 * One computed, directly-runnable resolution per candidate: delete every
 * *other* diverged file and regenerate, keeping this one (owner principle,
 * #220 review — "detect, then offer choices with a command already typed
 * out," not prose asking the reader to figure out the command
 * themselves). hejbro can't know which branch's change was meant to win
 * (that's the human call the ambiguity exists to surface), so every
 * candidate gets its own ready-to-run option rather than picking one.
 */
const divergedMigrationsOption = (
	keptName: string,
	allNames: ReadonlyArray<string>,
	migrationsDir: string,
): string => {
	const toDelete = allNames.filter((name) => name !== keptName);
	return `rm ${toDelete.map((name) => migrationPath(migrationsDir, name)).join(" ")} && hejbro generate   # keeps ${keptName}`;
};

const OPTION_LETTERS = "abcdefghijklmnopqrstuvwxyz";

const divergedMigrationsMessage = (
	fileNames: ReadonlyArray<string>,
	migrationsDir: string,
): string => {
	const fileList = fileNames.map((name) => `"${name}"`).join(", ");
	const options = fileNames
		.map((keptName, index) => {
			const letter = OPTION_LETTERS[index] ?? String(index + 1);
			return `  (${letter}) ${divergedMigrationsOption(keptName, fileNames, migrationsDir)}`;
		})
		.join("\n");
	return `the migration chain has diverged: ${fileList} all branch from the same prior snapshot state — this usually happens when two branches each ran \`hejbro generate\` before merging. Next, pick one:\n${options}`;
};

const brokenChainMessage = (fileName: string): string =>
	`the migration chain is broken at "${fileName}" — its parent-snapshot hash doesn't match any earlier migration's snapshot hash. Next: check whether a migration file was deleted, renamed, or hand-edited. Restore it from version control, or if this is intentional, delete every migration after it (they're now orphaned) and rerun \`hejbro generate\`.`;

const chainErrorMessage = (
	report: Extract<ChainReport, { readonly ok: false }>,
	migrationsDir: string,
): string => {
	if (report.code === "diverged-migrations") {
		return divergedMigrationsMessage(report.details, migrationsDir);
	}
	const [fileName] = report.details;
	return brokenChainMessage(fileName ?? "");
};

/**
 * `version` (as `renderMigrationPrefix` would render it) parsed back into
 * the instant it names — `null` for `index` (no clock, and
 * `findDuplicateVersionGroups` never fires for it: structurally
 * monotonic) or a version that doesn't parse as the shape `strategy`
 * expects. Only ever used to compute a *suggested* rename target for the
 * `duplicate-migration-version` diagnostic's `Next:` — never to decide
 * whether the collision itself is real (that's `findDuplicateVersionGroups`
 * alone, on the raw strings).
 */
const parseVersionAsDate = (
	version: string,
	strategy: MigrationPrefixStrategy,
): Date | null => {
	if (strategy === "unix") {
		const seconds = Number(version);
		if (!Number.isFinite(seconds)) {
			return null;
		}
		return new Date(seconds * 1000);
	}
	if (strategy === "timestamp") {
		if (version.length !== 14) {
			return null;
		}
		const year = Number(version.slice(0, 4));
		const month = Number(version.slice(4, 6));
		const day = Number(version.slice(6, 8));
		const hour = Number(version.slice(8, 10));
		const minute = Number(version.slice(10, 12));
		const second = Number(version.slice(12, 14));
		return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
	}
	return null;
};

/** The instant one second after every migration's own version in `fileNames` — `null` when there's nothing to compare against, or `strategy` has no meaningful clock (`index`). */
const nextInstantAfterAll = (
	fileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
): Date | null => {
	const dates = fileNames
		.map((name) => migrationVersionOf(name))
		.filter((version): version is string => version !== null)
		.map((version) => parseVersionAsDate(version, strategy))
		.filter((date): date is Date => date !== null);
	if (dates.length === 0) {
		return null;
	}
	const maxMs = Math.max(...dates.map((date) => date.getTime()));
	return new Date(maxMs + 1000);
};

/** The original slug half of a migration filename (`<version>_<slug>.sql`) — everything after the first `_`, extension included, so a suggested rename keeps it byte-for-byte. */
const slugOf = (fileName: string): string =>
	fileName.slice(fileName.indexOf("_") + 1);

/**
 * Renders `mv <migrationsDir>/<name> <migrationsDir>/<newVersion>_<slug>`
 * for one file, `newVersion` a whole second after `baseInstant` plus
 * `index` seconds — spacing multiple renamed files a second apart so a
 * 3+-way collision's suggestions don't just create a new collision among
 * themselves.
 */
const renameSuggestion = (
	fileName: string,
	baseInstant: Date,
	index: number,
	strategy: MigrationPrefixStrategy,
	migrationsDir: string,
): string => {
	const targetInstant = new Date(baseInstant.getTime() + index * 1000);
	const targetVersion = renderMigrationPrefix({
		strategy,
		generatedAt: targetInstant,
		previousCount: 0,
		slug: "",
	});
	return `mv ${migrationPath(migrationsDir, fileName)} ${migrationPath(migrationsDir, `${targetVersion}_${slugOf(fileName)}`)}`;
};

/**
 * Owner principle (#220 review): detect, then hand back a command already
 * typed out — `Next:` names the one file worth keeping as-is (sorted
 * first, deterministic) and gives a computed `mv` for every other member
 * of the group, spaced a second apart so renaming more than one member at
 * once can't recreate the collision among themselves. `hejbro verify
 * --fix` (a later PR, #220 tracking issue) automates exactly this
 * suggestion; until it exists, `Next:` only ever names the manual `mv`,
 * never a flag that isn't there yet.
 */
const duplicateVersionMessage = (
	group: DuplicateVersionGroup,
	allFileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
	migrationsDir: string,
): string => {
	const fileList = group.fileNames.map((name) => `"${name}"`).join(", ");
	const [kept, ...rest] = group.fileNames;
	const baseInstant = nextInstantAfterAll(allFileNames, strategy);
	const reason = `${group.fileNames.length} migrations share the version "${group.version}" (${fileList}) — Supabase (and any tool that tracks *applied* migrations by this version prefix, not the full filename) can only ever apply one of them; the rest silently never run.`;
	if (kept === undefined || rest.length === 0 || baseInstant === null) {
		// Structurally unreachable: findDuplicateVersionGroups only ever
		// returns groups with 2+ members, and it only ever fires for
		// timestamp/unix versions (index can't collide by construction), both
		// of which parseVersionAsDate handles — kept as a defensive fallback
		// so a future caller misuse degrades to a still-correct, if less
		// actionable, message instead of crashing.
		return `${reason} Next: rename every file in this group but one to a version after the current latest, then rerun \`hejbro verify\`.`;
	}
	const renameCommands = rest
		.map((name, index) =>
			renameSuggestion(name, baseInstant, index, strategy, migrationsDir),
		)
		.join(" && ");
	return `${reason} Next: keep "${kept}" as is; ${renameCommands}; then rerun \`hejbro verify\`.`;
};

/**
 * Owner-approved verbatim (⑥) — the skip/summary lines for the
 * dependency-aware batch redesign (duplicate-version and check 1 always
 * run; check 3 needs duplicate-version, since a version collision leaves
 * chain order undefined; check 2 needs check 1; check 4 needs check 1 and
 * check 3). See `test/verify.test.ts` for the golden pins.
 */
const SKIPPED_CHECK_2_LINE =
	"skipped: declarations ↔ snapshot (needs a parseable snapshot file)";
const SKIPPED_CHECK_3_LINE =
	"skipped: chain linearity (needs every migration to have a unique version)";
const SKIPPED_CHECK_4_LINE =
	"skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)";

const TOTAL_CHECKS = 5;

const failureSummaryLine = (
	failedCount: number,
	skippedCount: number,
): string => {
	if (skippedCount === 0) {
		return `verify: ${failedCount} of ${TOTAL_CHECKS} checks failed — fix the errors above and rerun \`hejbro verify\`.`;
	}
	return `verify: ${failedCount} of ${TOTAL_CHECKS} checks failed, ${skippedCount} skipped — fix the errors above and rerun \`hejbro verify\`.`;
};

export type VerifyResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const FIRST_QUOTED_SUBSTRING = /"([^"]+)"/;

/** Same identity-extraction heuristic as generate.ts's toDiagnostic (see rename-diagnostics/generate.ts for the fuller rationale): every verify message leads with the path/filename it's about inside the first `"..."`. */
const identityFromMessage = (message: string, fallback: string): string => {
	const match = FIRST_QUOTED_SUBSTRING.exec(message);
	if (match === null) {
		return fallback;
	}
	return match[1] ?? fallback;
};

const errorDiagnostic = (
	error: HejbroError,
	fallbackIdentity: string,
): Diagnostic =>
	fromHejbroError(error, identityFromMessage(error.message, fallbackIdentity));

/** A single, loader-precondition failure (config/entry) — rendered as its own early exit, before any of the 4 checks run (reviewer-confirmed: these are preconditions of the whole command, not one of the 4). */
const preconditionErrorResult = (
	error: HejbroError,
	fallbackIdentity: string,
): VerifyResult => ({
	exitCode: 1,
	stdout: [],
	stderr: renderDiagnostics([errorDiagnostic(error, fallbackIdentity)], null),
});

/** Every migration file's hash-chain lines, in directory-sorted order — files with no hash lines at all (pre-Phase-5 history) are silently skipped, matching checkChain's "caller filters the unhashed prefix" contract. */
const readChainEntries = (
	migrationsDirPath: string,
	fileNames: ReadonlyArray<string>,
): ReadonlyArray<ChainEntry> =>
	fileNames.flatMap((fileName) => {
		const text = readFileSync(join(migrationsDirPath, fileName), "utf8");
		const hashes = parseBannerHashes(text);
		if (hashes === null) {
			return [];
		}
		return [{ fileName, parent: hashes.parent, current: hashes.current }];
	});

const normalizedSnapshotHash = (diskText: string): string =>
	`sha256:${sha256Hex(renderSnapshot(parseSnapshot(diskText)))}`;

type CheckOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: HejbroError };

type Check1Result = {
	readonly diskText: string | null;
	readonly outcome: CheckOutcome;
};

/** Check 1 (always runs): the snapshot file exists and parses — a missing file reuses generate's own snapshot-not-found/snapshot-lost branch (readSnapshotFileText, shared to avoid drift), a malformed one surfaces core's invalid-snapshot. Never throws — every failure mode becomes a CheckOutcome so check 3 still runs independently. */
const runCheck1 = (cwd: string, config: HejbroConfig): Check1Result => {
	try {
		const diskText = readSnapshotFileText(cwd, config);
		parseSnapshot(diskText);
		return { diskText, outcome: { ok: true } };
	} catch (error) {
		return {
			diskText: null,
			outcome: { ok: false, error: asHejbroError(error) },
		};
	}
};

/** Check 2 (runs only when check 1 passed): the rebuilt-from-declarations snapshot text equals the on-disk text, byte for byte. */
const runCheck2 = (
	declarations: ReadonlyArray<HejbroInput>,
	diskText: string,
	snapshotPath: string,
	registry: KindRegistry,
): CheckOutcome => {
	const currentSnapshot = generateMigration({
		declarations,
		previousSnapshot: emptySnapshot,
		registry,
	}).snapshot;
	if (renderSnapshot(currentSnapshot) === diskText) {
		return { ok: true };
	}
	return {
		ok: false,
		error: hejbroError("snapshot-stale", snapshotStaleMessage(snapshotPath)),
	};
};

/** Check (always runs, before chain linearity — a version collision leaves chain order undefined, so it must be caught first): no two migration files claim the same version prefix. Pure detection (findDuplicateVersionGroups) over the raw filenames; the message's suggested rename needs `strategy` and `migrationsDir` (config-relative — the path fragment a copy-pasted `mv` command should use, never the absolute filesystem path `runVerify` reads files from). */
const runCheckDuplicateVersion = (
	fileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
	migrationsDir: string,
): CheckOutcome => {
	const [group] = findDuplicateVersionGroups(fileNames);
	if (group === undefined) {
		return { ok: true };
	}
	return {
		ok: false,
		error: hejbroError(
			"duplicate-migration-version",
			duplicateVersionMessage(group, fileNames, strategy, migrationsDir),
		),
	};
};

type Check3Result = {
	readonly report: ChainReport;
	readonly outcome: CheckOutcome;
};

/** Check 3: every migration's hash-chain lines form one linked list. Only runs when the duplicate-version check passed (`runCheck3IfEligible`) — with two files sharing a version, "which one comes first" isn't defined, so a chain walk over them can't mean anything yet. `migrationsDirPath` reads the files; `migrationsDir` (config-relative) is what a diverged-migrations `rm`/`generate` suggestion should print. */
const runCheck3 = (
	migrationsDirPath: string,
	migrationsDir: string,
	fileNames: ReadonlyArray<string>,
): Check3Result => {
	const report = checkChain(readChainEntries(migrationsDirPath, fileNames));
	if (report.ok) {
		return { report, outcome: { ok: true } };
	}
	return {
		report,
		outcome: {
			ok: false,
			error: hejbroError(report.code, chainErrorMessage(report, migrationsDir)),
		},
	};
};

/** `null` when the duplicate-version check failed (chain order is undefined until every version is unique); otherwise runs check 3. */
const runCheck3IfEligible = (
	duplicateVersionOutcome: CheckOutcome,
	migrationsDirPath: string,
	migrationsDir: string,
	fileNames: ReadonlyArray<string>,
): Check3Result | null => {
	if (!duplicateVersionOutcome.ok) {
		return null;
	}
	return runCheck3(migrationsDirPath, migrationsDir, fileNames);
};

/** Check 4 (runs only when checks 1 and 3 both passed): the chain tip hash equals the on-disk snapshot's normalized hash (same normalization `generate` uses for `parent`). Trivially passes when there are no migrations yet (tip is null — nothing to compare). */
const runCheck4 = (diskText: string, tip: string | null): CheckOutcome => {
	if (tip === null) {
		return { ok: true };
	}
	if (tip === normalizedSnapshotHash(diskText)) {
		return { ok: true };
	}
	return {
		ok: false,
		error: hejbroError("chain-tip-mismatch", CHAIN_TIP_MISMATCH_MESSAGE),
	};
};

/** `null` when check 1 failed (check 2 needs a parseable snapshot); otherwise runs check 2. */
const runCheck2IfEligible = (
	check1DiskText: string | null,
	declarations: ReadonlyArray<HejbroInput>,
	snapshotPath: string,
	registry: KindRegistry,
): CheckOutcome | null => {
	if (check1DiskText === null) {
		return null;
	}
	return runCheck2(declarations, check1DiskText, snapshotPath, registry);
};

/** `null` when check 1 failed, check 3 was itself skipped (duplicate-version failed), or check 3 ran but failed (check 4 needs a parseable snapshot and a linear chain); otherwise runs check 4. */
const runCheck4IfEligible = (
	check1DiskText: string | null,
	check3: Check3Result | null,
): CheckOutcome | null => {
	if (check1DiskText === null || check3 === null || !check3.report.ok) {
		return null;
	}
	return runCheck4(check1DiskText, check3.report.tip);
};

const check2SkipLine = (check2: CheckOutcome | null): string | null => {
	if (check2 === null) {
		return SKIPPED_CHECK_2_LINE;
	}
	return null;
};

const check3SkipLine = (check3: Check3Result | null): string | null => {
	if (check3 === null) {
		return SKIPPED_CHECK_3_LINE;
	}
	return null;
};

/** `null` when check 3 was itself skipped (duplicate-version failed); otherwise its own outcome — for folding into the flat `outcomes` list `runVerify` filters for failures. */
const check3Outcome = (check3: Check3Result | null): CheckOutcome | null => {
	if (check3 === null) {
		return null;
	}
	return check3.outcome;
};

const check4SkipLine = (check4: CheckOutcome | null): string | null => {
	if (check4 === null) {
		return SKIPPED_CHECK_4_LINE;
	}
	return null;
};

/**
 * `hejbro verify`'s five checks (U6, #220 adds duplicate-version),
 * dependency-aware batch reporting (reviewer-redesigned, PR D round 2;
 * extended #220): duplicate-version and check 1 (snapshot parses) always
 * run, independent of each other; check 3 (chain linearity) runs only
 * when duplicate-version passed (a version collision leaves chain order
 * undefined — checked first, ahead of the chain walk, on purpose); check
 * 2 (declarations ↔ snapshot) runs only when check 1 passed; check 4 (tip
 * ↔ snapshot) runs only when check 1 passed and check 3 both ran and
 * passed. Every failure is collected and rendered as one multi-diagnostic
 * batch; a check skipped for a failed dependency gets a fixed `skipped:`
 * line instead. Loader errors (config-not-found/entry-not-found) are a
 * precondition of all five checks, not one of them — a single-diagnostic
 * early exit, as before. Exit 1 when any check failed.
 */
export const runVerify = async (cwd: string): Promise<VerifyResult> => {
	const fallbackIdentity = "hejbro.config.ts";
	try {
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		const registry = buildRegistry(config);

		const check1 = runCheck1(cwd, config);
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = listMigrationFiles(migrationsDirPath);
		const checkDuplicateVersion = runCheckDuplicateVersion(
			fileNames,
			config.prefixStrategy,
			config.migrationsDir,
		);
		const check3 = runCheck3IfEligible(
			checkDuplicateVersion,
			migrationsDirPath,
			config.migrationsDir,
			fileNames,
		);

		const check2 = runCheck2IfEligible(
			check1.diskText,
			declarations,
			config.snapshotPath,
			registry,
		);
		const check4 = runCheck4IfEligible(check1.diskText, check3);

		const outcomes = [
			checkDuplicateVersion,
			check1.outcome,
			check2,
			check3Outcome(check3),
			check4,
		];
		const failures = outcomes.filter(
			(outcome): outcome is Extract<CheckOutcome, { ok: false }> =>
				outcome !== null && !outcome.ok,
		);

		if (failures.length === 0) {
			// failures.length === 0 means check1.outcome.ok (it's in outcomes
			// above), so diskText is guaranteed non-null here — TS can't see
			// that link across the two fields, hence the cast.
			const snapshotHash = normalizedSnapshotHash(check1.diskText as string);
			return {
				exitCode: 0,
				stdout: [
					`verify: ${TOTAL_CHECKS} checks passed (${fileNames.length} migrations, snapshot ${snapshotHash.slice(0, 19)}…)`,
				],
				stderr: null,
			};
		}

		const diagnostics = failures.map((failure) =>
			errorDiagnostic(failure.error, fallbackIdentity),
		);
		const skippedLines = [
			check3SkipLine(check3),
			check2SkipLine(check2),
			check4SkipLine(check4),
		].filter((line): line is string => line !== null);
		const skippedCount = skippedLines.length;
		const summary = [
			...skippedLines,
			failureSummaryLine(failures.length, skippedCount),
		].join("\n");

		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics(diagnostics, summary),
		};
	} catch (error) {
		return preconditionErrorResult(asHejbroError(error), fallbackIdentity);
	}
};

/** The `hejbro verify` citty subcommand — see {@link runVerify}. */
export const verifyCommand = defineCommand({
	meta: {
		name: "verify",
		description: VERIFY_DESCRIPTION,
	},
	run: async () => {
		const result = await runVerify(process.cwd());
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
