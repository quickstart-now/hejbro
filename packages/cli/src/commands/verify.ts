import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ChainEntry,
	ChainReport,
	HejbroError,
	HejbroInput,
	KindRegistry,
} from "@hejbro/core";
import {
	checkChain,
	emptySnapshot,
	generateMigration,
	hejbroError,
	parseBannerHashes,
	parseSnapshot,
	renderSnapshot,
} from "@hejbro/core";
import { defineCommand } from "citty";
import type { HejbroConfig } from "../config";
import type { Diagnostic } from "../diagnostics";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
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

const divergedMigrationsMessage = (
	fileNames: ReadonlyArray<string>,
): string => {
	const fileList = fileNames.map((name) => `"${name}"`).join(", ");
	return `the migration chain has diverged: ${fileList} all branch from the same prior snapshot state — this usually happens when two branches each ran \`hejbro generate\` before merging. Next: keep whichever migration merged first (usually the one with the earlier timestamp/index prefix); delete the other, then rerun \`hejbro generate\` so it's recreated against the now-current chain.`;
};

const brokenChainMessage = (fileName: string): string =>
	`the migration chain is broken at "${fileName}" — its parent-snapshot hash doesn't match any earlier migration's snapshot hash. Next: check whether a migration file was deleted, renamed, or hand-edited. Restore it from version control, or if this is intentional, delete every migration after it (they're now orphaned) and rerun \`hejbro generate\`.`;

const chainErrorMessage = (
	report: Extract<ChainReport, { readonly ok: false }>,
): string => {
	if (report.code === "diverged-migrations") {
		return divergedMigrationsMessage(report.details);
	}
	const [fileName] = report.details;
	return brokenChainMessage(fileName ?? "");
};

/**
 * Owner-approved verbatim (⑥) — the skip/summary lines for the
 * dependency-aware batch redesign (checks 1 and 3 always run; 2 needs
 * 1; 4 needs 1 and 3). See `test/verify.test.ts` for the golden pins.
 */
const SKIPPED_CHECK_2_LINE =
	"skipped: declarations ↔ snapshot (needs a parseable snapshot file)";
const SKIPPED_CHECK_4_LINE =
	"skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)";

const failureSummaryLine = (
	failedCount: number,
	skippedCount: number,
): string => {
	if (skippedCount === 0) {
		return `verify: ${failedCount} of 4 checks failed — fix the errors above and rerun \`hejbro verify\`.`;
	}
	return `verify: ${failedCount} of 4 checks failed, ${skippedCount} skipped — fix the errors above and rerun \`hejbro verify\`.`;
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

type Check3Result = {
	readonly report: ChainReport;
	readonly outcome: CheckOutcome;
};

/** Check 3 (always runs): every migration's hash-chain lines form one linked list. */
const runCheck3 = (
	migrationsDirPath: string,
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
			error: hejbroError(report.code, chainErrorMessage(report)),
		},
	};
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

/** `null` when check 1 or check 3 failed (check 4 needs both); otherwise runs check 4. */
const runCheck4IfEligible = (
	check1DiskText: string | null,
	check3: Check3Result,
): CheckOutcome | null => {
	if (check1DiskText === null || !check3.report.ok) {
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

const check4SkipLine = (check4: CheckOutcome | null): string | null => {
	if (check4 === null) {
		return SKIPPED_CHECK_4_LINE;
	}
	return null;
};

/**
 * `hejbro verify`'s four checks (U6), dependency-aware batch reporting
 * (reviewer-redesigned, PR D round 2): checks 1 (snapshot parses) and 3
 * (chain linearity) always run, independent of each other; check 2
 * (declarations ↔ snapshot) runs only when 1 passed; check 4 (tip ↔
 * snapshot) runs only when 1 and 3 both passed. Every failure is
 * collected and rendered as one multi-diagnostic batch; a check skipped
 * for a failed dependency gets a fixed `skipped:` line instead. Loader
 * errors (config-not-found/entry-not-found) are a precondition of all
 * four checks, not one of them — a single-diagnostic early exit, as
 * before. Exit 1 when any check failed.
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
		const check3 = runCheck3(migrationsDirPath, fileNames);

		const check2 = runCheck2IfEligible(
			check1.diskText,
			declarations,
			config.snapshotPath,
			registry,
		);
		const check4 = runCheck4IfEligible(check1.diskText, check3);

		const outcomes = [check1.outcome, check2, check3.outcome, check4];
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
					`verify: 4 checks passed (${fileNames.length} migrations, snapshot ${snapshotHash.slice(0, 19)}…)`,
				],
				stderr: null,
			};
		}

		const diagnostics = failures.map((failure) =>
			errorDiagnostic(failure.error, fallbackIdentity),
		);
		const skippedLines = [
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
