import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
	ChainEntry,
	ChainReport,
	DuplicateVersionFallbackOption,
	DuplicateVersionFixPlan,
	DuplicateVersionGroup,
	HejbroError,
	HejbroInput,
	KindRegistry,
	MigrationPrefixStrategy,
} from "@hejbro/core";
import {
	checkChain,
	duplicateVersionFallbackOptions,
	findDuplicateVersionGroups,
	generateMigration,
	hejbroError,
	parseBannerHashes,
	parseSnapshot,
	planDuplicateVersionFix,
	renderSnapshot,
	requiredKeysByKind,
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
 * The owner-principle-compliant fallback (#220 review, PR B round 2 —
 * planner-relayed owner correction: a prose "resolve this yourself" still
 * violates "detect, then hand back a command already typed out", even for
 * a group `--fix` itself can't safely touch) for a group whose chain
 * order `planDuplicateVersionFix` couldn't determine: one full option per
 * member, each a `mv` that renames *just that member* past the current
 * max, with a comment naming which other member(s) the human is thereby
 * asserting came first — only the human, who wrote the files, can tell
 * which option matches reality. Every option targets the exact same
 * version (`duplicateVersionFallbackOptions`): only one is ever meant to
 * run, so unlike a resolved group's simultaneous renames, there's nothing
 * for these to collide with.
 */
const duplicateVersionFallbackMessage = (
	reason: string,
	options: ReadonlyArray<DuplicateVersionFallbackOption>,
	migrationsDir: string,
): string => {
	const optionLines = options
		.map((option, index) => {
			const letter = OPTION_LETTERS[index] ?? String(index + 1);
			const assumedEarlierList = option.assumedEarlier
				.map((name) => `"${name}"`)
				.join(" or ");
			return `  (${letter}) mv ${migrationPath(migrationsDir, option.renamed.fileName)} ${migrationPath(migrationsDir, option.renamed.newFileName)}   # if ${assumedEarlierList} came first`;
		})
		.join("\n");
	return `${reason} Next, pick one: hejbro can't tell these files' chain order (a genuine fork, or a file with no readable hash-chain banner), so pick the one that was created later:\n${optionLines}`;
};

/**
 * Owner principle (#220 review): detect, then hand back a command already
 * typed out. `plan` is `planDuplicateVersionFix`'s own output over this
 * exact group (the *same* computation `hejbro verify --fix` runs, so the
 * `(a)`/`(b)` options below can never disagree on which file is "later" or
 * what its new name would be) — `null` when the group's own chain order
 * can't be determined, in which case `fallbackOptions`
 * (`duplicateVersionFallbackOptions`, same group) drives
 * {@link duplicateVersionFallbackMessage} instead.
 */
const duplicateVersionMessage = (
	group: DuplicateVersionGroup,
	plan: DuplicateVersionFixPlan | null,
	fallbackOptions: ReadonlyArray<DuplicateVersionFallbackOption> | null,
	migrationsDir: string,
): string => {
	const fileList = group.fileNames.map((name) => `"${name}"`).join(", ");
	const reason = `${group.fileNames.length} migrations share the version "${group.version}" (${fileList}) — Supabase (and any tool that tracks *applied* migrations by this version prefix, not the full filename) can only ever apply one of them; the rest silently never run.`;
	if (plan !== null && plan.length > 0) {
		const laterList = plan.map((rename) => `"${rename.fileName}"`).join(", ");
		const manualCommands = plan
			.map(
				(rename) =>
					`mv ${migrationPath(migrationsDir, rename.fileName)} ${migrationPath(migrationsDir, rename.newFileName)}`,
			)
			.join(" && ");
		return `${reason} Next, pick one:\n  (a) hejbro verify --fix   # renames ${laterList} (chain order decides which is later)\n  (b) ${manualCommands}   # the same by hand`;
	}
	if (fallbackOptions !== null && fallbackOptions.length > 0) {
		return duplicateVersionFallbackMessage(
			reason,
			fallbackOptions,
			migrationsDir,
		);
	}
	// Structurally unreachable: findDuplicateVersionGroups only ever fires
	// for timestamp/unix versions (index can't collide by construction), so
	// duplicateVersionFallbackOptions's own null case (no clock to parse)
	// never actually happens here either — kept as a defensive fallback.
	return `${reason} Next: rename every file in this group but one to a version after the current latest, then rerun \`hejbro verify\`.`;
};

/** `null` when `plan` resolved the group (no fallback needed); otherwise `duplicateVersionFallbackOptions` over the same group. */
const fallbackOptionsIfUnresolved = (
	plan: DuplicateVersionFixPlan | null,
	group: DuplicateVersionGroup,
	fileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
): ReadonlyArray<DuplicateVersionFallbackOption> | null => {
	if (plan !== null) {
		return null;
	}
	return duplicateVersionFallbackOptions(group, fileNames, strategy);
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

/** `applyDuplicateVersionFixes`'s running state: `fileNames` is the current directory listing (rewritten in step as earlier groups' renames land, so a later group's plan sees a fixed group's new, higher versions too), `lines` collects every `<before> -> <after>` line printed to stdout, oldest first. */
type FixOutcome = {
	readonly fileNames: ReadonlyArray<string>;
	readonly lines: ReadonlyArray<string>;
};

/** `applyGroupFix`'s no-op line for a group `planDuplicateVersionFix` couldn't order — printed to stdout (never silent: the owner principle applies to `--fix`'s own output, not just the diagnostic text) pointing at the same `Next:` a plain `hejbro verify` would show for this group. */
const unresolvedGroupSkipLine = (group: DuplicateVersionGroup): string => {
	const fileList = group.fileNames.map((name) => `"${name}"`).join(", ");
	return `skipped: "${group.version}" (${fileList}) — chain order undetermined, see Next`;
};

/** One duplicate-version group's `--fix` step: plans it (same `planDuplicateVersionFix` the diagnostic message itself uses), and — only when a plan exists — renames every "later" file on disk (content untouched) and folds the rename into `outcome`. A `null` plan (fork, or an unparseable member) leaves the file listing untouched and records {@link unresolvedGroupSkipLine} instead: that group still fails `runCheckDuplicateVersion` afterward, same diagnostic as if `--fix` had never run. */
const applyGroupFix = (
	migrationsDirPath: string,
	migrationsDir: string,
	strategy: MigrationPrefixStrategy,
	outcome: FixOutcome,
	group: DuplicateVersionGroup,
): FixOutcome => {
	const groupEntries = readChainEntries(migrationsDirPath, group.fileNames);
	const plan = planDuplicateVersionFix(
		group,
		groupEntries,
		outcome.fileNames,
		strategy,
	);
	if (plan === null) {
		return {
			fileNames: outcome.fileNames,
			lines: [...outcome.lines, unresolvedGroupSkipLine(group)],
		};
	}
	plan.map((rename) =>
		renameSync(
			join(migrationsDirPath, rename.fileName),
			join(migrationsDirPath, rename.newFileName),
		),
	);
	const renamedFrom = new Set(plan.map((rename) => rename.fileName));
	const nextFileNames = [
		...outcome.fileNames.filter((name) => !renamedFrom.has(name)),
		...plan.map((rename) => rename.newFileName),
	];
	const lines = plan.map(
		(rename) =>
			`${migrationPath(migrationsDir, rename.fileName)} -> ${migrationPath(migrationsDir, rename.newFileName)}`,
	);
	return { fileNames: nextFileNames, lines: [...outcome.lines, ...lines] };
};

/**
 * `hejbro verify --fix` (#220): renames every resolvable
 * duplicate-migration-version group's "later" file(s) — file content and
 * the checked-in snapshot are never touched, only filenames — before the
 * normal five checks run against the refreshed directory listing. A group
 * `planDuplicateVersionFix` can't resolve (a genuine fork, or a member
 * with no readable hash-chain banner) is left exactly as `findDuplicateVersionGroups`
 * found it, so it still surfaces as `duplicate-migration-version` afterward.
 */
const applyDuplicateVersionFixes = (
	migrationsDirPath: string,
	migrationsDir: string,
	fileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
): FixOutcome => {
	const groups = findDuplicateVersionGroups(fileNames);
	return groups.reduce<FixOutcome>(
		(outcome, group) =>
			applyGroupFix(migrationsDirPath, migrationsDir, strategy, outcome, group),
		{ fileNames, lines: [] },
	);
};

/** `null`-outcome-shaped no-op when `--fix` wasn't passed; otherwise runs {@link applyDuplicateVersionFixes}. Named to match this file's other `...IfEligible` gates, even though this one's gate is the flag itself rather than an earlier check's result. */
const applyDuplicateVersionFixesIfRequested = (
	fix: boolean,
	migrationsDirPath: string,
	migrationsDir: string,
	fileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
): FixOutcome => {
	if (!fix) {
		return { fileNames, lines: [] };
	}
	return applyDuplicateVersionFixes(
		migrationsDirPath,
		migrationsDir,
		fileNames,
		strategy,
	);
};

const normalizedSnapshotHash = (diskText: string): string =>
	`sha256:${sha256Hex(renderSnapshot(parseSnapshot(diskText)))}`;

type CheckOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: HejbroError };

type Check1Result = {
	readonly diskText: string | null;
	readonly outcome: CheckOutcome;
};

/** Check 1 (always runs): the snapshot file exists and parses (including each entry's own required keys, D79/#159) — a missing file reuses generate's own snapshot-not-found/snapshot-lost branch (readSnapshotFileText, shared to avoid drift), a malformed one surfaces core's invalid-snapshot. Never throws — every failure mode becomes a CheckOutcome so check 3 still runs independently. */
const runCheck1 = (
	cwd: string,
	config: HejbroConfig,
	registry: KindRegistry,
): Check1Result => {
	try {
		const diskText = readSnapshotFileText(cwd, config);
		parseSnapshot(diskText, requiredKeysByKind(registry));
		return { diskText, outcome: { ok: true } };
	} catch (error) {
		return {
			diskText: null,
			outcome: { ok: false, error: asHejbroError(error) },
		};
	}
};

/** Check 2 (runs only when check 1 passed): the rebuilt-from-declarations snapshot text equals the on-disk text, byte for byte. Rebuilds against the *real* committed snapshot as its parent (D81) — an empty parent would rebuild every table's `allColumns` lists in declaration order, disagreeing with the committed snapshot's physical order the moment a column was ever inserted mid-declaration. */
const runCheck2 = (
	declarations: ReadonlyArray<HejbroInput>,
	diskText: string,
	snapshotPath: string,
	registry: KindRegistry,
): CheckOutcome => {
	const currentSnapshot = generateMigration({
		declarations,
		previousSnapshot: parseSnapshot(diskText, requiredKeysByKind(registry)),
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

/** Check (always runs, before chain linearity — a version collision leaves chain order undefined, so it must be caught first): no two migration files claim the same version prefix. Pure detection (findDuplicateVersionGroups) over the raw filenames; the message's `--fix`/manual-`mv` options are both driven by `planDuplicateVersionFix` over the group's own hash-chain entries (`migrationsDirPath` reads the files; `migrationsDir`, config-relative, is what a printed command should use, never the absolute filesystem path). */
const runCheckDuplicateVersion = (
	migrationsDirPath: string,
	fileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
	migrationsDir: string,
): CheckOutcome => {
	const [group] = findDuplicateVersionGroups(fileNames);
	if (group === undefined) {
		return { ok: true };
	}
	const groupEntries = readChainEntries(migrationsDirPath, group.fileNames);
	const plan = planDuplicateVersionFix(
		group,
		groupEntries,
		fileNames,
		strategy,
	);
	const fallbackOptions = fallbackOptionsIfUnresolved(
		plan,
		group,
		fileNames,
		strategy,
	);
	return {
		ok: false,
		error: hejbroError(
			"duplicate-migration-version",
			duplicateVersionMessage(group, plan, fallbackOptions, migrationsDir),
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
 *
 * `--fix` (`argv`, #220): before any check runs, resolvable
 * duplicate-migration-version groups are renamed on disk (content and
 * snapshot untouched) via `applyDuplicateVersionFixes`; every `<before> ->
 * <after>` line lands first in `stdout`, then the five checks run
 * against the refreshed file listing exactly as if `--fix` had never been
 * passed. A group `--fix` couldn't resolve still fails
 * `duplicate-migration-version` afterward, same as without the flag.
 */
export const runVerify = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
): Promise<VerifyResult> => {
	const fallbackIdentity = "hejbro.config.ts";
	const fix = argv.includes("--fix");
	try {
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		const registry = buildRegistry(config);

		const check1 = runCheck1(cwd, config, registry);
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const initialFileNames = listMigrationFiles(migrationsDirPath);
		const fixOutcome = applyDuplicateVersionFixesIfRequested(
			fix,
			migrationsDirPath,
			config.migrationsDir,
			initialFileNames,
			config.prefixStrategy,
		);
		const fileNames = fixOutcome.fileNames;
		const checkDuplicateVersion = runCheckDuplicateVersion(
			migrationsDirPath,
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
					...fixOutcome.lines,
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
			stdout: fixOutcome.lines,
			stderr: renderDiagnostics(diagnostics, summary),
		};
	} catch (error) {
		return preconditionErrorResult(asHejbroError(error), fallbackIdentity);
	}
};

// The `args` block exists only so `--help` renders this owner-approved
// one-line description (mirrors generate.ts's GENERATE_ARGS) — `--fix`
// itself is parsed by hand from `ctx.rawArgs` in `runVerify`.
const VERIFY_ARGS = {
	fix: {
		type: "boolean",
		description:
			"rename duplicate-migration-version files whose chain order can be determined, then continue verifying",
	},
} as const;

/** The `hejbro verify` citty subcommand — see {@link runVerify}. */
export const verifyCommand = defineCommand({
	meta: {
		name: "verify",
		description: VERIFY_DESCRIPTION,
	},
	args: VERIFY_ARGS,
	run: async (ctx) => {
		const result = await runVerify(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
