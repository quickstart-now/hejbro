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
	Snapshot,
	Validator,
} from "@hejbro/core";
import {
	canonicalizeSnapshot,
	checkChain,
	duplicateVersionFallbackOptions,
	findDuplicateVersionGroups,
	generateMigration,
	hejbroError,
	parseBannerBaseline,
	parseBannerHashes,
	parseSnapshot,
	planDuplicateVersionFix,
	renderSnapshot,
	requiredKeysByKind,
} from "@hejbro/core";
import { defineCommand } from "citty";
import type { HejbroConfig } from "../config";
import { requireConfigFields } from "../config-required";
import type { Diagnostic } from "../diagnostics";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { compareExport } from "../export-compare";
import { sha256Hex } from "../hash";
import { identityFromMessage, relativizeDeclaredAt } from "../identity";
import type { LoadedDeclarations } from "../loader";
import { loadConfig, loadDeclarations } from "../loader";
import { buildRegistry, configValidators } from "../presets";
import { listMigrationFiles, readSnapshotFileText } from "../snapshot-file";

const VERIFY_DESCRIPTION =
	"Check that the checked-in snapshot matches your declarations and that the migration history's hash chain is intact.";

/**
 * Owner-approved verbatim (⑥) — Task 17's `snapshot-stale` and
 * `chain-tip-mismatch` texts, and the `diverged-migrations`/
 * `broken-chain` `Next:` lines below (verify's own framing of
 * `checkChain`'s codes). See `test/verify.test.ts` for the golden pins.
 * `chain-tip-mismatch` was revised (#632/#677): it now names the tip
 * migration and the snapshot path instead of relying on the
 * identity-extraction heuristic to find a filename that was never in the
 * text, and states only the observation, never a cause.
 */
const snapshotStaleMessage = (snapshotPath: string): string =>
	`the checked-in snapshot at "${snapshotPath}" does not match your declarations — either the declarations changed without a new migration, or the snapshot file was hand-edited. Next: run \`hejbro generate\` and commit the result (or, if the snapshot is correct and the declarations are wrong, restore the declarations you meant).`;

const chainTipMismatchMessage = (
	tipMigrationPath: string,
	snapshotPath: string,
): string =>
	`the migration chain's tip hash doesn't match the current snapshot — "${tipMigrationPath}"'s "snapshot:" hash and the snapshot at "${snapshotPath}" disagree. Next: restore the snapshot (and "${tipMigrationPath}", if it was edited) from version control — the snapshot is a derived file and should only ever change through \`hejbro generate\`.`;

/** States only the observation, never a cause (schema-export spec, R2-G3
 * 3.2): the export could be stale for any number of reasons (an edited
 * declaration, a hand-edited export file, a regeneration that was never
 * committed), and naming one would assert something this check never
 * verified. */
const EXPORT_STALE_MESSAGE =
	'the export in ".hejbro/export/" does not match your declarations. Next: run `hejbro generate --export` and commit the result.';

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
/** #752: the preset-validator check (settled shape, task 2.1/2.2) is
 * gated on check 1 the same way check 2 is — it needs a parseable
 * snapshot to diff the declarations against. */
const SKIPPED_CHECK_PRESET_LINE =
	"skipped: preset validators (needs a parseable snapshot)";

const BASE_CHECKS = 5;

/**
 * The export freshness check (R2-G3) and the preset-validator check
 * (#752) only count toward the total when they apply — a repository that
 * never opted into the export, or never registered a preset, sees the
 * exact same wording it always has, never a phantom check it can't act
 * on.
 */
const totalChecks = (exportApplied: boolean, presetApplied: boolean): number =>
	BASE_CHECKS + Number(exportApplied) + Number(presetApplied);

const failureSummaryLine = (
	failedCount: number,
	skippedCount: number,
	checks: number,
): string => {
	if (skippedCount === 0) {
		return `verify: ${failedCount} of ${checks} checks failed — fix the errors above and rerun \`hejbro verify\`.`;
	}
	return `verify: ${failedCount} of ${checks} checks failed, ${skippedCount} skipped — fix the errors above and rerun \`hejbro verify\`.`;
};

export type VerifyResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/**
 * Rebuilt via the factory, not `{ ...error, declaredAt: ... }` --
 * `HejbroError` is an `Error` subclass, and `Error.prototype.message` is
 * own-but-non-enumerable, so an object spread silently drops it (same
 * reasoning as `generate.ts`'s own `toDiagnostic`, which this mirrors:
 * task 3.1 replaces verify's own stale, non-adjacent-pair-aware
 * `identityFromMessage` copy with the shared `../identity.ts` helper
 * `generate.ts` already uses, so two different tables refused in the
 * same run are told apart by their diagnostic headers instead of both
 * printing the same truncated identity; task 3.4 moves
 * `relativizeDeclaredAt` to the same shared module, closing the second
 * local copy this file had grown of the identical logic under a
 * different name).
 */
const errorDiagnostic = (
	error: HejbroError,
	fallbackIdentity: string,
	cwd: string,
): Diagnostic =>
	fromHejbroError(
		hejbroError(
			error.code,
			error.message,
			relativizeDeclaredAt(error.declaredAt, cwd),
		),
		identityFromMessage(error.message, fallbackIdentity),
	);

/** A single, loader-precondition failure (config/entry) — rendered as its own early exit, before any of the 4 checks run (reviewer-confirmed: these are preconditions of the whole command, not one of the 4). */
const preconditionErrorResult = (
	error: HejbroError,
	fallbackIdentity: string,
	cwd: string,
): VerifyResult => ({
	exitCode: 1,
	stdout: [],
	stderr: renderDiagnostics(
		[errorDiagnostic(error, fallbackIdentity, cwd)],
		null,
	),
});

/** Every migration file's hash-chain lines, in directory-sorted order — files with no hash lines at all (pre-Phase-5 history) are silently skipped, matching checkChain's "caller filters the unhashed prefix" contract. Exported (G7, #613): `migrate`/`status` read the same chain this way rather than a second copy of this walk. */
export const readChainEntries = (
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

/**
 * [task 12.1, #624] Which of `fileNames` carry the `-- baseline:` marker
 * (`parseBannerBaseline`, read by prefix, never by string-matching the
 * banner — same reasoning as {@link readChainEntries}'s own hash read).
 * A second pass over the same directory rather than folding the flag
 * into `ChainEntry` itself: `ChainEntry` is `@hejbro/core`'s own type,
 * shared with `checkChain`'s hash-chain walk, so widening it here would
 * be a cross-package change for a fact only the apply path needs.
 * `planApply` (`apply/plan.ts`) takes this as its own, plan-local
 * parameter instead — the chain reader already opens every file once for
 * its hash lines; this opens them a second time for one more marker,
 * cheap for migration-file-sized text.
 */
export const readBaselineFileNames = (
	migrationsDirPath: string,
	fileNames: ReadonlyArray<string>,
): ReadonlySet<string> =>
	new Set(
		fileNames.filter((fileName) => {
			const text = readFileSync(join(migrationsDirPath, fileName), "utf8");
			return parseBannerBaseline(text);
		}),
	);

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
	config: HejbroConfig & { readonly snapshotPath: string },
	registry: KindRegistry,
): Check1Result => {
	try {
		const diskText = readSnapshotFileText(cwd, config, "verify");
		parseSnapshot(diskText, requiredKeysByKind(registry));
		return { diskText, outcome: { ok: true } };
	} catch (error) {
		return {
			diskText: null,
			outcome: { ok: false, error: asHejbroError(error) },
		};
	}
};

/** #752: the sixth check's own outcome shape — genuinely different from
 * every other {@link CheckOutcome} (2.2): a failure carries every
 * refusal a registered validator raised in this run, not just the
 * first, since "generate and verify agree" has to hold for a
 * multi-refusal run too. */
type PresetCheckOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly errors: ReadonlyArray<HejbroError> };

type Check2AndPresetResult = {
	readonly check2: CheckOutcome;
	readonly preset: PresetCheckOutcome;
};

/**
 * Check 2's own pass/fail rule, factored out of {@link runCheck2AndPreset}
 * so that function stays a straight-line read of "one generateMigration
 * call, two independent outcomes". Rebuilds against the *real* committed
 * snapshot as its parent (D81) — an empty parent would rebuild every
 * table's `allColumns` lists in declaration order, disagreeing with the
 * committed snapshot's physical order the moment a column was ever
 * inserted mid-declaration.
 *
 * #701/D3: compares through the canonical form, not the disk file's raw
 * bytes — `diskSnapshot` (already parsed, never re-rendered as-is) goes
 * through {@link canonicalizeSnapshot} before the comparison, so a
 * checked-in snapshot whose only difference from the declarations is a
 * set-shaped array's order (a policy's roles, a trigger's events, a
 * table's indexes or checks) still passes; `currentSnapshot` is already
 * canonical (`buildSnapshot` canonicalizes on write). Check 1's own tip-hash
 * comparison, above, stays byte-exact against the file as stored — a hand
 * edit of any kind, a set's order included, is still a tip mismatch there.
 */
const buildCheck2Outcome = (
	currentSnapshot: Snapshot,
	diskSnapshot: Snapshot,
	registry: KindRegistry,
	snapshotPath: string,
): CheckOutcome => {
	if (
		renderSnapshot(currentSnapshot) ===
		renderSnapshot(canonicalizeSnapshot(diskSnapshot, registry))
	) {
		return { ok: true };
	}
	return {
		ok: false,
		error: hejbroError("snapshot-stale", snapshotStaleMessage(snapshotPath)),
	};
};

/**
 * Check 2 (runs only when check 1 passed): the rebuilt-from-declarations
 * snapshot compares equal to the on-disk snapshot through the canonical
 * form ({@link buildCheck2Outcome}, #701/D3).
 *
 * #752/task 2.1: also runs the sixth check, from the *same*
 * `generateMigration({ validators })` call — never a second call
 * recomputing the identical pipeline. `result.snapshot` is built
 * regardless of whether a validator refused anything (`generateMigration`
 * only ever skips SQL emission, never snapshot construction), so check 2
 * is unaffected by `validators` being passed now where it previously
 * wasn't; `result.errors` is empty whenever `validators` is `[]`
 * (verify never passes renames/confirmedDrops, so nothing else could
 * populate it), which is what lets a no-preset repository stay
 * byte-identical to before this check existed.
 */
const runCheck2AndPreset = (
	declarations: ReadonlyArray<HejbroInput>,
	diskText: string,
	snapshotPath: string,
	registry: KindRegistry,
	validators: ReadonlyArray<Validator>,
): Check2AndPresetResult => {
	const diskSnapshot = parseSnapshot(diskText, requiredKeysByKind(registry));
	const result = generateMigration({
		declarations,
		previousSnapshot: diskSnapshot,
		registry,
		validators,
	});
	const check2 = buildCheck2Outcome(
		result.snapshot,
		diskSnapshot,
		registry,
		snapshotPath,
	);
	if (result.errors.length === 0) {
		return { check2, preset: { ok: true } };
	}
	return { check2, preset: { ok: false, errors: result.errors } };
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
	/** The last hash-bearing entry (directory order), for check 4's
	 * chain-tip-mismatch identity — `null` for an empty chain. Carried
	 * alongside `report` rather than re-derived from `report.tip` (a bare
	 * hash) so check 4 never has to reconstruct "which file is the tip"
	 * from a hash string alone. */
	readonly tipEntry: ChainEntry | null;
	readonly outcome: CheckOutcome;
};

/** Check 3: every migration's hash-chain lines form one linked list. Runs
 * only when the duplicate-version check passed (`runCheck3IfEligible`) —
 * with two files sharing a version, "which one comes first" isn't
 * defined, so a chain walk over them can't mean anything yet.
 * `migrationsDirPath` reads the files; `migrationsDir` (config-relative)
 * is what a suggestion should print. */
const runCheck3 = (
	migrationsDirPath: string,
	migrationsDir: string,
	fileNames: ReadonlyArray<string>,
): Check3Result => {
	const entries = readChainEntries(migrationsDirPath, fileNames);
	const report = checkChain(entries);
	const tipEntry = entries.at(-1) ?? null;
	if (!report.ok) {
		return {
			report,
			tipEntry,
			outcome: {
				ok: false,
				error: hejbroError(
					report.code,
					chainErrorMessage(report, migrationsDir),
				),
			},
		};
	}
	return { report, tipEntry, outcome: { ok: true } };
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

/** Check 4 (runs only when checks 1 and 3 both passed): the chain tip hash equals the on-disk snapshot's normalized hash (same normalization `generate` uses for `parent`). Trivially passes when there are no migrations yet (`tipEntry` is null — nothing to compare). `migrationsDir` is config-relative, matching every other check's suggestion text. */
const runCheck4 = (
	diskText: string,
	snapshotPath: string,
	migrationsDir: string,
	tipEntry: ChainEntry | null,
): CheckOutcome => {
	if (tipEntry === null) {
		return { ok: true };
	}
	if (tipEntry.current === normalizedSnapshotHash(diskText)) {
		return { ok: true };
	}
	return {
		ok: false,
		error: hejbroError(
			"chain-tip-mismatch",
			chainTipMismatchMessage(
				migrationPath(migrationsDir, tipEntry.fileName),
				snapshotPath,
			),
		),
	};
};

/** `null` when check 1 failed (check 2/the preset check both need a parseable snapshot); otherwise runs {@link runCheck2AndPreset}. */
const runCheck2AndPresetIfEligible = (
	check1DiskText: string | null,
	declarations: ReadonlyArray<HejbroInput>,
	snapshotPath: string,
	registry: KindRegistry,
	validators: ReadonlyArray<Validator>,
): Check2AndPresetResult | null => {
	if (check1DiskText === null) {
		return null;
	}
	return runCheck2AndPreset(
		declarations,
		check1DiskText,
		snapshotPath,
		registry,
		validators,
	);
};

/** `null` when check 1 failed, check 3 was itself skipped (duplicate-version failed), or check 3 ran but failed (check 4 needs a parseable snapshot and a linear chain); otherwise runs check 4. `snapshotPath`/`migrationsDir` are both config-relative, passed through for {@link chainTipMismatchMessage}. */
const runCheck4IfEligible = (
	check1DiskText: string | null,
	snapshotPath: string,
	migrationsDir: string,
	check3: Check3Result | null,
): CheckOutcome | null => {
	if (check1DiskText === null || check3 === null || !check3.report.ok) {
		return null;
	}
	return runCheck4(
		check1DiskText,
		snapshotPath,
		migrationsDir,
		check3.tipEntry,
	);
};

/**
 * The export freshness check (R2-G3, new requirement — not a
 * monotonicity-gate successor): `"not-applicable"` when check 1 failed
 * (no parseable snapshot to regenerate against) or the repository has
 * never opted into the export (`compareExport`'s own `"absent"`) — a
 * repository with no export at all is not reported as stale (3.3).
 * Otherwise regenerates the export in memory from the same declarations
 * `generate --export` would use, and compares bytes (3.1).
 */
const runExportCheck = (
	cwd: string,
	check1DiskText: string | null,
	declarations: LoadedDeclarations,
	registry: KindRegistry,
	validators: ReadonlyArray<Validator>,
): CheckOutcome | "not-applicable" => {
	if (check1DiskText === null) {
		return "not-applicable";
	}
	const currentSnapshot = generateMigration({
		declarations,
		previousSnapshot: parseSnapshot(
			check1DiskText,
			requiredKeysByKind(registry),
		),
		registry,
	}).snapshot;
	const comparison = compareExport(
		cwd,
		declarations,
		declarations.exportNames,
		currentSnapshot,
		registry,
		validators,
	);
	if (comparison === "absent") {
		return "not-applicable";
	}
	if (comparison === "current") {
		return { ok: true };
	}
	return {
		ok: false,
		error: hejbroError("export-stale", EXPORT_STALE_MESSAGE),
	};
};

/** `[]` when the export check did not apply, so it contributes nothing to `outcomes`, `TOTAL_CHECKS`, or the failure summary — indistinguishable from the check not existing, which is what lets every export-less repository's report stay byte-identical to before this check was added. */
const exportOutcomes = (
	exportCheck: CheckOutcome | "not-applicable",
): ReadonlyArray<CheckOutcome> => {
	if (exportCheck === "not-applicable") {
		return [];
	}
	return [exportCheck];
};

/**
 * #752: the preset check's own three-way state — `"not-applicable"` when
 * the active configuration registers no preset (absent from the report
 * entirely, same treatment as {@link runExportCheck}'s own
 * `"not-applicable"`); `"skipped"` when a preset is registered but check 1
 * failed (same dependency every other check-1-gated check has, rendered
 * via {@link presetCheckSkipLine}); otherwise the outcome
 * {@link runCheck2AndPreset} computed.
 */
type PresetCheckState = PresetCheckOutcome | "not-applicable" | "skipped";

const check2From = (
	check2AndPreset: Check2AndPresetResult | null,
): CheckOutcome | null => {
	if (check2AndPreset === null) {
		return null;
	}
	return check2AndPreset.check2;
};

const presetCheckState = (
	presetsRegistered: boolean,
	check2AndPreset: Check2AndPresetResult | null,
): PresetCheckState => {
	if (!presetsRegistered) {
		return "not-applicable";
	}
	if (check2AndPreset === null) {
		return "skipped";
	}
	return check2AndPreset.preset;
};

const presetCheckSkipLine = (state: PresetCheckState): string | null => {
	if (state === "skipped") {
		return SKIPPED_CHECK_PRESET_LINE;
	}
	return null;
};

/** `[]` when the preset check didn't run or passed — the errors it contributes to the rendered diagnostic batch, folded in as their own diagnostics (2.2: every refusal is reported, never only the first) while the check itself still counts as one failed check (`presetCheckFailed`), not one-per-refusal. */
const presetCheckErrors = (
	state: PresetCheckState,
): ReadonlyArray<HejbroError> => {
	if (state === "not-applicable" || state === "skipped" || state.ok) {
		return [];
	}
	return state.errors;
};

const presetCheckFailed = (state: PresetCheckState): boolean =>
	presetCheckErrors(state).length > 0;

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
 * A sixth check (#752, gated on check 1 exactly like check 2 — same
 * `generateMigration({ validators })` call, never a second one) runs
 * every registered preset's validators over the same declared snapshot
 * check 2 already builds, and refuses with the identical coded error
 * `hejbro generate` would raise for the same declaration; every refusal
 * in the run is reported, and the check still counts as one, pass or
 * fail. A configuration with no preset registered never runs it and
 * never counts it — the report stays byte-identical to before this
 * check existed.
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
		requireConfigFields(config, "verify", [
			"migrationsDir",
			"snapshotPath",
			"prefixStrategy",
		]);
		const declarations = await loadDeclarations(configPath, config);
		const registry = buildRegistry(config);
		const validators = configValidators(config);

		const check1 = runCheck1(cwd, config, registry);
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const initialFileNames = listMigrationFiles(cwd, config.migrationsDir);
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

		const check2AndPreset = runCheck2AndPresetIfEligible(
			check1.diskText,
			declarations,
			config.snapshotPath,
			registry,
			validators,
		);
		const check2 = check2From(check2AndPreset);
		const presetsRegistered = validators.length > 0;
		const presetState = presetCheckState(presetsRegistered, check2AndPreset);
		const check4 = runCheck4IfEligible(
			check1.diskText,
			config.snapshotPath,
			config.migrationsDir,
			check3,
		);
		const exportCheck = runExportCheck(
			cwd,
			check1.diskText,
			declarations,
			registry,
			validators,
		);
		const exportApplied = exportCheck !== "not-applicable";
		const checksApplied = totalChecks(exportApplied, presetsRegistered);

		const outcomes = [
			checkDuplicateVersion,
			check1.outcome,
			check2,
			check3Outcome(check3),
			check4,
			...exportOutcomes(exportCheck),
		];
		const failures = outcomes.filter(
			(outcome): outcome is Extract<CheckOutcome, { ok: false }> =>
				outcome !== null && !outcome.ok,
		);
		const presetErrors = presetCheckErrors(presetState);

		if (failures.length === 0 && !presetCheckFailed(presetState)) {
			// failures.length === 0 means check1.outcome.ok (it's in outcomes
			// above), so diskText is guaranteed non-null here — TS can't see
			// that link across the two fields, hence the cast.
			const snapshotHash = normalizedSnapshotHash(check1.diskText as string);
			return {
				exitCode: 0,
				stdout: [
					...fixOutcome.lines,
					`verify: ${checksApplied} checks passed (${fileNames.length} migrations, snapshot ${snapshotHash.slice(0, 19)}…)`,
				],
				stderr: null,
			};
		}

		const diagnostics = [
			...failures.map((failure) =>
				errorDiagnostic(failure.error, fallbackIdentity, cwd),
			),
			...presetErrors.map((error) =>
				errorDiagnostic(error, fallbackIdentity, cwd),
			),
		];
		const skippedLines = [
			check3SkipLine(check3),
			check2SkipLine(check2),
			check4SkipLine(check4),
			presetCheckSkipLine(presetState),
		].filter((line): line is string => line !== null);
		const skippedCount = skippedLines.length;
		const failedCount =
			failures.length + Number(presetCheckFailed(presetState));
		const summary = [
			...skippedLines,
			failureSummaryLine(failedCount, skippedCount, checksApplied),
		].join("\n");

		return {
			exitCode: 1,
			stdout: fixOutcome.lines,
			stderr: renderDiagnostics(diagnostics, summary),
		};
	} catch (error) {
		return preconditionErrorResult(asHejbroError(error), fallbackIdentity, cwd);
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
