import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	emptySnapshot,
	generateMigration,
	HEJBRO_SNAPSHOT_VERSION,
	hejbroError,
	parseBannerHashes,
	renderSnapshot,
	throwHejbroError,
} from "@hejbro/core";
import { defineCommand } from "citty";
import { globSync } from "tinyglobby";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import type { GitCommitInfo } from "../git";
import {
	blobAt,
	diffNameOnly,
	isGitRepository,
	isWorkingTreeDirty,
	migrationAddedCommits,
	NOT_A_GIT_REPOSITORY_MESSAGE,
	removeFiles,
	restoreFilesFromCommit,
} from "../git";
import { sha256Hex } from "../hash";
import type { MigrationState } from "../history-state";
import { computeMigrationState } from "../history-state";
import { identityFromMessage } from "../identity";
import { loadConfig, loadDeclarations } from "../loader";
import { buildRegistry } from "../presets";
import {
	computeFileDiff,
	renderFileDiffLines,
	renderUndoBlock,
} from "../restore-diff";
import {
	dirtyWorkingTreeMessage,
	historyRewrittenMessage,
	mismatchNoCandidatesNoVersionMessage,
	mismatchNoCandidatesWithVersionMessage,
	mismatchWithCandidatesMessage,
	outOfRangeMessage,
	recordedHejbroVersion,
	stateLostMessage,
} from "../restore-messages";
import { listMigrationFiles } from "../snapshot-file";
import { CLI_VERSION } from "../version";

const RESTORE_DESCRIPTION =
	"Restore the declaration files entry matches back to a past migration's own recorded state.";

export type RestoreResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/** A positive integer parsed from the raw `<n>` argv token, or `null` for anything else (including a negative/zero/non-numeric token) — folded into the same `restore-target-out-of-range` code as a numerically out-of-range target (§10: "정수 아님 포함"). */
const parsePositiveInteger = (token: string): number | null => {
	if (!/^[1-9][0-9]*$/.test(token)) {
		return null;
	}
	return Number(token);
};

type MigrationEntry = {
	readonly number: number;
	readonly fileName: string;
	readonly bannerCurrentHash: string;
	readonly state: MigrationState;
	readonly commit: GitCommitInfo | null;
};

const bannerCurrentHashOf = (fileContent: string): string => {
	const hashes = parseBannerHashes(fileContent);
	if (hashes === null) {
		return "";
	}
	return hashes.current;
};

const computeAllMigrationEntries = (
	cwd: string,
	migrationsDirPath: string,
	migrationsDirRelative: string,
	snapshotPathRelative: string,
	fileNames: ReadonlyArray<string>,
): ReadonlyArray<MigrationEntry> => {
	const addedCommits = migrationAddedCommits(cwd, migrationsDirRelative);
	return fileNames.map((fileName, index) => {
		const fileContent = readFileSync(join(migrationsDirPath, fileName), "utf8");
		const bannerCurrentHash = bannerCurrentHashOf(fileContent);
		const entry = computeMigrationState(
			cwd,
			migrationsDirRelative,
			snapshotPathRelative,
			bannerCurrentHash,
			addedCommits,
			fileName,
		);
		return {
			number: index + 1,
			fileName,
			bannerCurrentHash,
			state: entry.state,
			commit: entry.commit,
		};
	});
};

/** The highest-numbered `ok` migration sharing `sha` with `target` (the group's survivor) — `undefined` if the co-add group somehow has none (defensive; every real group's own commit recorded exactly one member's snapshot). */
const survivorInGroup = (
	entries: ReadonlyArray<MigrationEntry>,
	sha: string,
): MigrationEntry | undefined =>
	entries
		.filter((entry) => entry.commit !== null && entry.commit.sha === sha)
		.reduce<MigrationEntry | undefined>((latest, entry) => {
			if (entry.state !== "ok") {
				return latest;
			}
			if (latest === undefined || entry.number > latest.number) {
				return entry;
			}
			return latest;
		}, undefined);

const GLOB_SPECIAL_CHARS = /[*?[\]{}()!]/;

/** The static (non-glob) leading directory of one entry pattern — `"src/**\/*.schema.ts"` → `"src"`, `"src/lib/*.ts"` → `"src/lib"`. `"."` when the pattern's very first segment is already dynamic. */
const staticRootOf = (pattern: string): string => {
	const segments = pattern.split("/");
	const staticSegments = segments.reduce<{
		readonly done: boolean;
		readonly taken: ReadonlyArray<string>;
	}>(
		(acc, segment) => {
			if (acc.done || GLOB_SPECIAL_CHARS.test(segment)) {
				return { done: true, taken: acc.taken };
			}
			return { done: false, taken: [...acc.taken, segment] };
		},
		{ done: false, taken: [] },
	).taken;
	if (staticSegments.length === 0) {
		return ".";
	}
	return staticSegments.join("/");
};

const staticRootsOf = (entry: ReadonlyArray<string>): ReadonlyArray<string> =>
	Array.from(new Set(entry.map((pattern) => staticRootOf(pattern))));

/** Every file that changed between `sha` and `HEAD` under `entry`'s own static roots, excluding whatever the entry glob itself already matches in the (now-restored) working tree — the files a snapshot-reproduction mismatch is actually asking the user to look at (§5). */
const candidateDriftFiles = (
	cwd: string,
	sha: string,
	entry: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const roots = staticRootsOf(entry);
	const changed = roots.flatMap((root) => diffNameOnly(cwd, sha, "HEAD", root));
	const entryMatched = new Set(globSync([...entry], { cwd }));
	return Array.from(new Set(changed))
		.filter((path) => !entryMatched.has(path))
		.sort();
};

type LoadDeclarationsResult =
	| {
			readonly ok: true;
			readonly declarations: Awaited<ReturnType<typeof loadDeclarations>>;
	  }
	| { readonly ok: false; readonly error: unknown };

/** Wraps {@link loadDeclarations} in a result object instead of letting its rejection propagate — the caller needs both outcomes as data (the diff/undo output prints either way), and a try/catch around a `let` assignment is the one shape this repo's own no-`let` convention can't express directly. */
const tryLoadDeclarations = async (
	configPath: string,
	config: Parameters<typeof loadDeclarations>[1],
): Promise<LoadDeclarationsResult> => {
	try {
		const declarations = await loadDeclarations(configPath, config);
		return { ok: true, declarations };
	} catch (error) {
		return { ok: false, error };
	}
};

const parsedFormatVersionOf = (snapshotText: string): unknown => {
	const parsed = JSON.parse(snapshotText) as {
		readonly formatVersion?: unknown;
		readonly hejbroSnapshot?: unknown;
	};
	if (parsed.formatVersion !== undefined) {
		return parsed.formatVersion;
	}
	return parsed.hejbroSnapshot;
};

export const runRestore = async (
	cwd: string,
	rawArgs: ReadonlyArray<string>,
): Promise<RestoreResult> => {
	const fallbackIdentity = "hejbro.config.ts";
	try {
		const { configPath, config } = await loadConfig(cwd, undefined);
		if (!isGitRepository(cwd)) {
			throwHejbroError("not-a-git-repository", NOT_A_GIT_REPOSITORY_MESSAGE);
		}
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = listMigrationFiles(migrationsDirPath);
		const targetToken = rawArgs[0] ?? "";
		const targetNumber = parsePositiveInteger(targetToken);
		if (
			targetNumber === null ||
			targetNumber < 1 ||
			targetNumber > fileNames.length
		) {
			throwHejbroError(
				"restore-target-out-of-range",
				outOfRangeMessage(targetToken, fileNames.length),
			);
		}

		const entries = computeAllMigrationEntries(
			cwd,
			migrationsDirPath,
			config.migrationsDir,
			config.snapshotPath,
			fileNames,
		);
		const target = entries[targetNumber - 1];
		if (target === undefined) {
			return throwHejbroError(
				"restore-target-out-of-range",
				outOfRangeMessage(targetToken, fileNames.length),
			);
		}

		if (target.state === "uncommitted") {
			return {
				exitCode: 0,
				stdout: [
					`already at migration ${targetNumber}'s state (uncommitted) — nothing to restore.`,
				],
				stderr: null,
			};
		}

		if (target.state === "lost") {
			const sha = target.commit?.sha ?? "";
			const survivor = survivorInGroup(entries, sha);
			throwHejbroError(
				"restore-state-lost",
				stateLostMessage(
					targetNumber,
					survivor?.number ?? targetNumber,
					sha.slice(0, 7),
				),
			);
		}

		if (target.state === "rewritten") {
			const migrationRelativePath = `${config.migrationsDir}/${target.fileName}`;
			throwHejbroError(
				"restore-history-rewritten",
				historyRewrittenMessage(targetNumber, migrationRelativePath),
			);
		}

		// target.state === "ok" from here.
		if (isWorkingTreeDirty(cwd)) {
			throwHejbroError("dirty-working-tree", dirtyWorkingTreeMessage());
		}
		const commit = target.commit;
		if (commit === null) {
			throw new Error("unreachable — an ok migration always has a commit");
		}
		const sha = commit.sha;
		const shortSha = sha.slice(0, 7);

		const diff = computeFileDiff(cwd, sha, config.entry);
		const writePaths = diff
			.filter((entry) => entry.marker !== "-")
			.map((entry) => entry.path);
		const removePaths = diff
			.filter((entry) => entry.marker === "-")
			.map((entry) => entry.path);
		restoreFilesFromCommit(cwd, sha, writePaths);
		removeFiles(cwd, removePaths);

		const diffLines = renderFileDiffLines(diff, targetNumber);
		const undoLines = renderUndoBlock(diff);
		const verifiedCommitLine = `verified: commit ${shortSha}'s snapshot content matches migration ${targetNumber}'s banner hash`;

		const loaded = await tryLoadDeclarations(configPath, config);
		if (!loaded.ok) {
			const hejbroErr = asHejbroError(loaded.error);
			return {
				exitCode: 1,
				stdout: [verifiedCommitLine, ...diffLines, "", ...undoLines],
				stderr: renderDiagnostics(
					[
						fromHejbroError(
							hejbroErr,
							identityFromMessage(hejbroErr.message, fallbackIdentity),
						),
					],
					null,
				),
			};
		}
		const declarations = loaded.declarations;

		const targetSnapshotText = blobAt(cwd, sha, config.snapshotPath).toString(
			"utf8",
		);
		const recordedFormatVersion = parsedFormatVersionOf(targetSnapshotText);
		if (recordedFormatVersion !== HEJBRO_SNAPSHOT_VERSION) {
			const note = `note: migration ${targetNumber} was generated under an older snapshot format (v${recordedFormatVersion}; this build is v${HEJBRO_SNAPSHOT_VERSION}) — the post-restore snapshot-reproduction check can't run across a format change. Review the diff manually before running \`hejbro generate\`.`;
			return {
				exitCode: 0,
				stdout: [verifiedCommitLine, ...diffLines, note, "", ...undoLines],
				stderr: null,
			};
		}

		const registry = buildRegistry(config);
		const rebuilt = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
			registry,
		});
		const rebuiltHash = renderSnapshotHash(rebuilt.snapshot);
		if (rebuiltHash === target.bannerCurrentHash) {
			return {
				exitCode: 0,
				stdout: [
					verifiedCommitLine,
					...diffLines,
					`verified: restored declarations reproduce migration ${targetNumber}'s recorded snapshot`,
					"declarations loaded successfully — ready to review and run `hejbro generate`.",
					"",
					...undoLines,
				],
				stderr: null,
			};
		}

		const candidates = candidateDriftFiles(cwd, sha, config.entry);
		const srcRoots = staticRootsOf(config.entry).join(" ");
		const migrationRelativePath = `${config.migrationsDir}/${target.fileName}`;
		const targetMigrationText = blobAt(
			cwd,
			sha,
			migrationRelativePath,
		).toString("utf8");
		const mismatchError = buildMismatchError(
			targetNumber,
			shortSha,
			candidates,
			targetMigrationText,
			srcRoots,
		);
		return {
			exitCode: 1,
			stdout: [verifiedCommitLine, ...diffLines, "", ...undoLines],
			stderr: renderDiagnostics(
				[
					fromHejbroError(
						mismatchError,
						identityFromMessage(mismatchError.message, fallbackIdentity),
					),
				],
				null,
			),
		};
	} catch (error) {
		const hejbroErr = asHejbroError(error);
		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics(
				[
					fromHejbroError(
						hejbroErr,
						identityFromMessage(hejbroErr.message, fallbackIdentity),
					),
				],
				null,
			),
		};
	}
};

const renderSnapshotHash = (
	snapshot: Parameters<typeof renderSnapshot>[0],
): string => `sha256:${sha256Hex(renderSnapshot(snapshot))}`;

const buildMismatchError = (
	targetNumber: number,
	shortSha: string,
	candidates: ReadonlyArray<string>,
	targetMigrationText: string,
	srcRoots: string,
) => {
	if (candidates.length > 0) {
		return hejbroError(
			"restore-state-mismatch",
			mismatchWithCandidatesMessage(targetNumber, shortSha, candidates),
		);
	}
	const recordedVersion = recordedHejbroVersion(targetMigrationText);
	if (recordedVersion !== null) {
		return hejbroError(
			"restore-state-mismatch",
			mismatchNoCandidatesWithVersionMessage(
				targetNumber,
				shortSha,
				recordedVersion,
				CLI_VERSION,
				srcRoots,
			),
		);
	}
	return hejbroError(
		"restore-state-mismatch",
		mismatchNoCandidatesNoVersionMessage(targetNumber, shortSha, srcRoots),
	);
};

/** The `hejbro restore <n>` citty subcommand — see {@link runRestore}. No flags (spec §1) — `<n>` is read straight from `ctx.rawArgs`. */
export const restoreCommand = defineCommand({
	meta: {
		name: "restore",
		description: RESTORE_DESCRIPTION,
	},
	run: async (ctx) => {
		const result = await runRestore(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
