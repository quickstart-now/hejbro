import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainEntry, ChainReport, HejbroError } from "@hejbro/core";
import {
	checkChain,
	emptySnapshot,
	generateMigration,
	parseBannerHashes,
	parseSnapshot,
	renderSnapshot,
	throwHejbroError,
} from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { sha256Hex } from "../hash";
import { loadConfig, loadDeclarations } from "../loader";

const VERIFY_DESCRIPTION =
	"Check that the checked-in snapshot matches your declarations and that the migration history's hash chain is intact.";

/**
 * Owner-approved wording pending — Task 17's `snapshot-stale` and
 * `chain-tip-mismatch` are new texts (no prior golden), and the
 * `diverged-migrations`/`broken-chain` `Next:` lines below are verify's
 * own framing of `checkChain`'s codes (also new). Drafted per decision
 * ③'s grammar and relayed to planner for owner review (PR body flags
 * this) — do not treat as final until confirmed.
 */
const snapshotStaleMessage = (snapshotPath: string): string =>
	`the checked-in snapshot at "${snapshotPath}" does not match your declarations — either the declarations changed without a new migration, or the snapshot file was hand-edited. Next: run \`hejbro generate\` and commit the result (or, if the snapshot is correct and the declarations are wrong, restore the declarations you meant).`;

const chainTipMismatchMessage = (snapshotPath: string): string =>
	`the migration chain's tip hash doesn't match the current snapshot at "${snapshotPath}" — the last migration's "snapshot:" hash and the on-disk snapshot's own hash disagree, which usually means the snapshot was edited after the last \`hejbro generate\` (or a migration file was hand-edited). Next: run \`hejbro generate\` to catch up (if the declarations changed), or restore both the migrations directory and the snapshot from version control (if a file was corrupted or hand-edited).`;

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

export type VerifyResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const errorResult = (error: HejbroError, identity: string): VerifyResult => ({
	exitCode: 1,
	stdout: [],
	stderr: renderDiagnostics([fromHejbroError(error, identity)], null),
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

const sqlFileNames = (migrationsDirPath: string): ReadonlyArray<string> => {
	if (!existsSync(migrationsDirPath)) {
		return [];
	}
	return readdirSync(migrationsDirPath)
		.filter((name) => name.endsWith(".sql"))
		.sort();
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

/**
 * `hejbro verify`'s four checks (U6), all against `cwd`, reported as soon
 * as the first one fails (they're sequentially dependent — a later check
 * only makes sense once the earlier ones hold):
 * 1. the snapshot file parses (`parseSnapshot` — JSON corruption, e.g.
 *    unresolved git conflict markers, surfaces core's own
 *    `invalid-snapshot`).
 * 2. rebuilt-from-declarations snapshot text equals the on-disk text,
 *    byte for byte (`snapshot-stale` otherwise).
 * 3. every migration's hash-chain lines form one linked list
 *    (`checkChain` — `diverged-migrations`/`broken-chain`).
 * 4. the chain's tip hash equals the on-disk snapshot's *normalized*
 *    hash (the same normalization `generate` uses for `parent`) —
 *    `chain-tip-mismatch` otherwise. Trivially holds when there are no
 *    migrations yet (nothing to compare against).
 */
export const runVerify = async (cwd: string): Promise<VerifyResult> => {
	const { config, configPath } = await loadConfig(cwd, undefined);
	const snapshotFsPath = join(cwd, config.snapshotPath);
	try {
		if (!existsSync(snapshotFsPath)) {
			return throwHejbroError(
				"invalid-snapshot",
				`no snapshot file was found at "${config.snapshotPath}". Next: run \`hejbro init\` (or \`hejbro generate\`) first.`,
			);
		}
		const diskText = readFileSync(snapshotFsPath, "utf8");
		parseSnapshot(diskText);

		const declarations = await loadDeclarations(configPath, config);
		const currentSnapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		if (renderSnapshot(currentSnapshot) !== diskText) {
			return throwHejbroError(
				"snapshot-stale",
				snapshotStaleMessage(config.snapshotPath),
			);
		}

		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = sqlFileNames(migrationsDirPath);
		const chainEntries = readChainEntries(migrationsDirPath, fileNames);
		const chainReport = checkChain(chainEntries);
		if (!chainReport.ok) {
			return throwHejbroError(chainReport.code, chainErrorMessage(chainReport));
		}

		if (chainReport.tip !== null) {
			const expectedTip = normalizedSnapshotHash(diskText);
			if (chainReport.tip !== expectedTip) {
				return throwHejbroError(
					"chain-tip-mismatch",
					chainTipMismatchMessage(config.snapshotPath),
				);
			}
		}

		const snapshotHash = normalizedSnapshotHash(diskText);
		return {
			exitCode: 0,
			stdout: [
				`verify: 4 checks passed (${fileNames.length} migrations, snapshot ${snapshotHash.slice(0, 19)}…)`,
			],
			stderr: null,
		};
	} catch (error) {
		return errorResult(asHejbroError(error), config.snapshotPath);
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
