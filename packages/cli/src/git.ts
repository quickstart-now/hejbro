import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { sha256Hex } from "./hash";

/**
 * `hejbro history`/`restore`'s one seam onto git (§3, #130) — every git
 * subprocess call in this package goes through this file, `execFileSync`
 * only, no new dependency. `TZ=UTC` on every call: `--date=format:...`
 * would otherwise render in the host's local timezone, breaking the
 * byte-stable golden fixtures §11 requires.
 */
const GIT_ENV = {
	...process.env,
	// biome-ignore lint/style/useNamingConvention: TZ is a POSIX environment variable name, not a naming choice of this codebase's own
	TZ: "UTC",
};

type ExecFileError = {
	readonly stdout?: string;
	readonly status?: number;
};

const stdoutOfFailedRun = (execError: ExecFileError): string => {
	if (typeof execError.stdout === "string") {
		return execError.stdout;
	}
	return "";
};

const statusOfFailedRun = (execError: ExecFileError): number => {
	if (typeof execError.status === "number") {
		return execError.status;
	}
	return 1;
};

const runGit = (
	cwd: string,
	args: ReadonlyArray<string>,
): { readonly stdout: string; readonly status: number } => {
	try {
		const stdout = execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			env: GIT_ENV,
		});
		return { stdout, status: 0 };
	} catch (error) {
		const execError = error as ExecFileError;
		return {
			stdout: stdoutOfFailedRun(execError),
			status: statusOfFailedRun(execError),
		};
	}
};

const runGitOrThrow = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });

const runGitBuffer = (cwd: string, args: ReadonlyArray<string>): Buffer =>
	execFileSync("git", args, { cwd, env: GIT_ENV });

/** `true` when `cwd` is inside a git working tree. */
export const isGitRepository = (cwd: string): boolean =>
	runGit(cwd, ["rev-parse", "--is-inside-work-tree"]).status === 0;

/**
 * Owner-approved verbatim (§6, #130) — `history` and `restore`'s shared
 * `not-a-git-repository` guard text, checked before either command reads
 * anything else. Split into a "why" half (this constant) and a "Next:"
 * half that each throw site states as its own literal (`scripts/
 * check-next-marker.mjs`'s own same-file resolution can't see a "Next:"
 * clause that only exists inside an imported string constant) — the two
 * concatenated are byte-identical to the single string this used to be.
 */
export const NOT_A_GIT_REPOSITORY_WHY =
	"this project is not inside a git repository — hejbro history/restore read migration history from git and need one to work.";

/** `true` when `cwd`'s working tree has any uncommitted change — tracked or untracked (`git status --porcelain`'s default already reports both). */
export const isWorkingTreeDirty = (cwd: string): boolean =>
	runGit(cwd, ["status", "--porcelain"]).stdout.trim() !== "";

/** `true` when `path` (cwd-relative) itself has an uncommitted change — untracked or modified — distinguishing a single migration file's own `uncommitted` state (§2) from the working tree at large. */
export const isPathDirty = (cwd: string, path: string): boolean =>
	runGit(cwd, ["status", "--porcelain", "--", path]).stdout.trim() !== "";

/** One commit, as far as `history`/`restore` care: its short-enough-to-be-unique full sha, its author date (`YYYY-MM-DD`, UTC), and its subject line. */
export type GitCommitInfo = {
	readonly sha: string;
	readonly date: string;
	readonly subject: string;
};

// Unit Separator / Record Separator (\x1f / \x1e) -- ASCII's own
// field/record delimiters, chosen so this can never collide with real
// commit data (a subject line can hold nearly any printable byte, but
// never a control character). Not \x00: an embedded NUL inside a
// single execFileSync argv string is unsafe (C argv strings are
// NUL-terminated), unlike these two.
const HEADER_FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";
const LOG_FORMAT = `${RECORD_SEP}%H${HEADER_FIELD_SEP}%ad${HEADER_FIELD_SEP}%s`;

type AddedFileEntry = {
	readonly fileName: string;
	readonly commit: GitCommitInfo;
};

/** One parsed chunk of `git log --name-status` output (one commit, `LOG_FORMAT` header + zero or more status lines) — `undefined` for a malformed chunk (missing header field), never thrown. */
const parseLogChunk = (chunk: string): ReadonlyArray<AddedFileEntry> => {
	const lines = chunk.split("\n").filter((line) => line !== "");
	const [header, ...statusLines] = lines;
	if (header === undefined) {
		return [];
	}
	const [sha, date, subject] = header.split(HEADER_FIELD_SEP);
	if (sha === undefined || date === undefined || subject === undefined) {
		return [];
	}
	const commit: GitCommitInfo = { sha, date, subject };
	return statusLines
		.filter((line) => line.startsWith("A\t"))
		.map((line) => ({ fileName: basename(line.slice(2)), commit }));
};

const parseAddedFilesLog = (stdout: string): ReadonlyArray<AddedFileEntry> =>
	stdout
		.split(RECORD_SEP)
		.filter((chunk) => chunk.trim() !== "")
		.flatMap((chunk) => parseLogChunk(chunk));

/**
 * Every migration file's own "added" commit (M2, #130) — `fileName` is
 * the file's bare basename (matching `listMigrationFiles`'s own return
 * shape, `snapshot-file.ts`, so both can key off the same string without
 * either side reconstructing a path). Deliberately no `--follow`: a
 * pathspec on a directory (not a single file) makes `--follow`
 * meaningless/misbehaving, and committed migration files are never
 * renamed by convention. HEAD's own ancestry only (no `--all`) — see
 * {@link findCommitMatchingHash}'s own doc comment for why that
 * matters.
 */
export const migrationAddedCommits = (
	cwd: string,
	migrationsDirRelative: string,
): ReadonlyMap<string, GitCommitInfo> => {
	const { stdout } = runGit(cwd, [
		"log",
		"--diff-filter=A",
		"--name-status",
		"--relative",
		"--date=format:%Y-%m-%d",
		`--format=${LOG_FORMAT}`,
		"--",
		`${migrationsDirRelative}/`,
	]);
	const entries = parseAddedFilesLog(stdout);
	// First occurrence per fileName wins -- git log's default (newest-
	// first) order means that's the most recent add, which is the only
	// one that matters (a committed migration file is never re-added
	// after being removed, by convention).
	return entries.reduce((map, { fileName, commit }) => {
		if (map.has(fileName)) {
			return map;
		}
		return new Map(map).set(fileName, commit);
	}, new Map<string, GitCommitInfo>());
};

/** How many `.sql` files under `migrationsDirRelative` commit `sha` added alongside each other (M4, #130) — display-only context for `history`'s squash-merge note, not part of `state` itself. */
export const coAddedCount = (
	cwd: string,
	sha: string,
	migrationsDirRelative: string,
): number => {
	const { stdout } = runGit(cwd, [
		"show",
		"--name-status",
		"--diff-filter=A",
		"--pretty=format:",
		"--relative",
		sha,
		"--",
		`${migrationsDirRelative}/`,
	]);
	return stdout.split("\n").filter((line) => line.startsWith("A\t")).length;
};

/** `git show <sha>:<path>`'s raw blob bytes -- never decoded to text, so hashing it matches exactly what a disk file's own bytes would hash to (M3, #130). Throws (propagates) if the blob doesn't exist at that commit -- every call site already knows the path exists there from a prior `git log`/`ls-tree`. */
export const blobAt = (cwd: string, sha: string, path: string): Buffer =>
	runGitBuffer(cwd, ["show", `${sha}:${path}`]);

/**
 * Every commit (HEAD's own ancestry, `git log -- <path>`, no `--all`)
 * that ever touched `path`, oldest-blind (order doesn't matter --
 * {@link findCommitMatchingHash} checks every one). Deliberately HEAD-
 * ancestors-only: `state: ok` must mean "restorable from this branch's
 * own history" -- a commit that only exists on another branch or in the
 * reflog is not something a plain `git checkout <sha> -- <path>` run
 * from here can silently rely on staying reachable (it can be GC'd), so
 * adopting it as `ok` would put an unknown branch's state into the
 * working tree without saying so. That case surfaces as `rewritten`
 * instead (§2.4).
 */
const snapshotHistoryCommits = (
	cwd: string,
	snapshotPathRelative: string,
): ReadonlyArray<GitCommitInfo> => {
	const { stdout } = runGit(cwd, [
		"log",
		"--relative",
		"--date=format:%Y-%m-%d",
		`--format=${LOG_FORMAT}`,
		"--",
		snapshotPathRelative,
	]);
	return stdout
		.split(RECORD_SEP)
		.filter((chunk) => chunk.trim() !== "")
		.flatMap((chunk) => {
			const [header] = chunk.split("\n");
			if (header === undefined) {
				return [];
			}
			const [sha, date, subject] = header.split(HEADER_FIELD_SEP);
			if (sha === undefined || date === undefined || subject === undefined) {
				return [];
			}
			return [{ sha, date, subject }];
		});
};

/**
 * The first commit (searching HEAD's own ancestry only, oldest guessed
 * candidate first not required -- every commit is checked) whose
 * `<snapshotPathRelative>` blob hashes to `targetHash` (already
 * `sha256:`-prefixed, matching `parseBannerHashes`'s own format) --
 * `undefined` when none does (M3's `lost` case, #130).
 */
export const findCommitMatchingHash = (
	cwd: string,
	snapshotPathRelative: string,
	targetHash: string,
): GitCommitInfo | undefined =>
	snapshotHistoryCommits(cwd, snapshotPathRelative).find(
		(commit) =>
			`sha256:${sha256Hex(blobAt(cwd, commit.sha, snapshotPathRelative))}` ===
			targetHash,
	);

/** Every file path git knows about in `sha`'s tree, cwd-relative (`--relative` behavior is the default for `ls-tree` given a relative pathspec -- confirmed directly, not assumed: `--full-tree` would instead resolve it against the repo root and silently return nothing for a pathspec that only exists relative to `cwd`). */
export const listTreeFiles = (
	cwd: string,
	sha: string,
	pathspec: string,
): ReadonlyArray<string> => {
	const { stdout } = runGit(cwd, [
		"ls-tree",
		"-r",
		"--name-only",
		sha,
		"--",
		pathspec,
	]);
	return stdout.split("\n").filter((line) => line !== "");
};

/** `git diff --name-only` between two refs, cwd-relative (`--relative`), restricted to `pathspec`. */
export const diffNameOnly = (
	cwd: string,
	fromRef: string,
	toRef: string,
	pathspec: string,
): ReadonlyArray<string> => {
	const { stdout } = runGit(cwd, [
		"diff",
		"--name-only",
		"--relative",
		fromRef,
		toRef,
		"--",
		pathspec,
	]);
	return stdout.split("\n").filter((line) => line !== "");
};

/** `origin`'s remote URL, or `null` when there is no `origin` remote (or `cwd` isn't a repository at all). */
export const remoteUrl = (cwd: string): string | null => {
	const { stdout, status } = runGit(cwd, ["remote", "get-url", "origin"]);
	if (status !== 0) {
		return null;
	}
	const trimmed = stdout.trim();
	if (trimmed === "") {
		return null;
	}
	return trimmed;
};

/** `true` for the one error `execFileSync("git", ...)` raises when the
 * `git` binary itself can't be found on `PATH` — Node's own `ENOENT`,
 * distinct from git running and exiting non-zero (a bad remote, an
 * unresolvable ref). Callers use this to tell "git is not installed"
 * from every other git failure, since a coded diagnostic needs to name
 * the right one (R2-G4, "A machine without git is told so"). */
export const isGitBinaryMissing = (error: unknown): boolean =>
	error !== null &&
	typeof error === "object" &&
	(error as NodeJS.ErrnoException).code === "ENOENT";

/** The remote's default branch and the commit it currently points at —
 * one `git ls-remote --symref` call answers both, so a caller never
 * reads a branch name from one round trip and its commit from another
 * (which could race against a push in between). Branch is intent,
 * commit is truth (R2-G4): everything except a deliberate update reads
 * a pinned commit, and this is the one place a branch name is read at
 * all. `remote` is a URL or a filesystem path (a local bare repository
 * works identically, which is how this is tested without a network). */
export type RemoteHead = {
	readonly branch: string;
	readonly commit: string;
};

const SYMREF_PREFIX = "ref: refs/heads/";

export const resolveRemoteHead = (cwd: string, remote: string): RemoteHead => {
	const stdout = runGitOrThrow(cwd, ["ls-remote", "--symref", remote, "HEAD"]);
	const lines = stdout.split("\n").filter((line) => line !== "");
	const refLine = lines.find((line) => line.startsWith(SYMREF_PREFIX));
	const commitLine = lines.find((line) => !line.startsWith("ref: "));
	const [branch] = (refLine ?? "").slice(SYMREF_PREFIX.length).split("\t");
	const [commit] = (commitLine ?? "").split("\t");
	if (
		refLine === undefined ||
		commitLine === undefined ||
		branch === undefined ||
		commit === undefined ||
		branch === "" ||
		commit === ""
	) {
		throw new Error(
			`could not resolve "${remote}"'s default branch from \`git ls-remote --symref\` output: ${JSON.stringify(stdout)}`,
		);
	}
	return { branch, commit };
};

/** Resolves one named ref (a branch or a tag) to its commit —
 * `--ref`'s own one-off override (R2-G4, 4.6). `undefined` when the
 * remote has no such ref, so a caller can name it in a coded refusal
 * rather than crash on `git ls-remote`'s own empty, silent success. */
export const resolveRemoteRef = (
	cwd: string,
	remote: string,
	ref: string,
): string | undefined => {
	const stdout = runGitOrThrow(cwd, ["ls-remote", remote, ref]);
	const [line] = stdout.split("\n").filter((entry) => entry !== "");
	if (line === undefined) {
		return undefined;
	}
	const [commit] = line.split("\t");
	return commit;
};

/**
 * Reads one path's raw bytes at one commit of `remote`, without ever
 * creating a working tree for it — a throwaway bare repository fetches
 * only that commit (`--filter=blob:none --depth=1`, a blobless partial
 * clone: tree and commit metadata arrive up front, the one blob this
 * reads arrives on demand from the same call), then `git show` reads it
 * directly. `commit` can be any commit the remote still has reachable —
 * not only the branch tip — which is what lets a pinned lock stay
 * readable after the branch has moved on (`git archive --remote` cannot
 * do this at all; GitHub refuses it outright). `null` when `commit`
 * carries no file at `path` (the caller tells that apart from "commit
 * doesn't exist" itself, checked separately).
 */
export const readFileAtRemoteCommit = (
	remote: string,
	commit: string,
	path: string,
): Buffer | null => {
	const scratchDir = mkdtempSync(join(tmpdir(), "hejbro-vendor-"));
	try {
		execFileSync("git", ["init", "--bare", "--quiet", scratchDir], {
			env: GIT_ENV,
			stdio: ["ignore", "ignore", "ignore"],
		});
		execFileSync(
			"git",
			[
				"-C",
				scratchDir,
				"fetch",
				"--quiet",
				"--filter=blob:none",
				"--depth=1",
				remote,
				commit,
			],
			{ env: GIT_ENV, stdio: ["ignore", "ignore", "ignore"] },
		);
		try {
			return execFileSync(
				"git",
				["-C", scratchDir, "show", `${commit}:${path}`],
				{ env: GIT_ENV, stdio: ["ignore", "pipe", "ignore"] },
			);
		} catch {
			return null;
		}
	} finally {
		rmSync(scratchDir, { recursive: true, force: true });
	}
};

/** Writes every one of `paths` (cwd-relative) to its state at `sha`, via `git checkout <sha> -- <path...>` -- git itself creates any missing parent directory. */
export const restoreFilesFromCommit = (
	cwd: string,
	sha: string,
	paths: ReadonlyArray<string>,
): void => {
	if (paths.length === 0) {
		return;
	}
	runGitOrThrow(cwd, ["checkout", sha, "--", ...paths]);
};

/** Deletes every one of `paths` (cwd-relative, resolved against `cwd`) — restore's own "resurrected at the target commit, absent from the current working tree" case (§4). Not a git operation (there is nothing checked in to check out away from); kept here anyway, alongside every other restore file-write primitive, rather than split across two modules for one function. */
export const removeFiles = (
	cwd: string,
	paths: ReadonlyArray<string>,
): void => {
	paths.map((path) => rmSync(join(cwd, path), { force: true }));
};
