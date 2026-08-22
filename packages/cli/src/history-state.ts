import type { GitCommitInfo } from "./git";
import { blobAt, findCommitMatchingHash, isPathDirty } from "./git";
import { sha256Hex } from "./hash";

/**
 * One migration's own restorability, computed once (§2, #130) and shared
 * by both `hejbro history` (a table row) and `hejbro restore` (the guard
 * before it writes anything) — a single source of truth so the two
 * commands can never disagree about the same migration.
 *
 * - `ok`: the declaration state this migration recorded still exists in
 *   git, reachable from HEAD (`commit` names where).
 * - `lost`: this migration was committed, but no commit reachable from
 *   HEAD carries a snapshot blob matching its own recorded hash — a
 *   squash merge (or similar history-flattening) folded its
 *   intermediate declaration state into a later migration's own commit.
 *   `commit` is still the commit that added this migration's *file*
 *   (useful context for the note text: which migrations were co-added,
 *   and which later migration to restore instead).
 * - `rewritten`: this migration's file is tracked, but no commit
 *   reachable from HEAD ever added it — history was rewritten (rebase/
 *   force-push) in a way that lost that specific commit from this
 *   branch's own ancestry.
 * - `uncommitted`: this migration's file has never been committed at
 *   all (freshly generated, still pending `git add`/`git commit`).
 */
export type MigrationState = "ok" | "lost" | "rewritten" | "uncommitted";

export type MigrationHistoryEntry = {
	readonly state: MigrationState;
	/** `null` for `rewritten`/`uncommitted` — there is no commit to name. */
	readonly commit: GitCommitInfo | null;
};

/**
 * M2 → M3 for one migration file. `addedCommits` is `migrationAddedCommits`'s
 * whole-project result (one git call, shared across every migration this
 * run examines — not re-run per file). `migrationsDirRelative` is only
 * used for the "no candidate" branch's own per-file dirty check
 * (`uncommitted` vs `rewritten`).
 */
export const computeMigrationState = (
	cwd: string,
	migrationsDirRelative: string,
	snapshotPathRelative: string,
	bannerCurrentHash: string,
	addedCommits: ReadonlyMap<string, GitCommitInfo>,
	fileName: string,
): MigrationHistoryEntry => {
	const candidate = addedCommits.get(fileName);
	if (candidate === undefined) {
		const filePath = `${migrationsDirRelative}/${fileName}`;
		if (isPathDirty(cwd, filePath)) {
			return { state: "uncommitted", commit: null };
		}
		return { state: "rewritten", commit: null };
	}
	const candidateBlob = blobAt(cwd, candidate.sha, snapshotPathRelative);
	const candidateHash = `sha256:${sha256Hex(candidateBlob)}`;
	if (candidateHash === bannerCurrentHash) {
		return { state: "ok", commit: candidate };
	}
	const found = findCommitMatchingHash(
		cwd,
		snapshotPathRelative,
		bannerCurrentHash,
	);
	if (found !== undefined) {
		return { state: "ok", commit: found };
	}
	return { state: "lost", commit: candidate };
};
