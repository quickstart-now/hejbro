// biome-ignore-all lint/style/useNamingConvention: every SCREAMING_CASE key below is a git environment variable name, not a naming choice of this codebase's own
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real, scratch `git init` repos for history/restore tests (#130 spec
// §11) — byte-stable only because every commit's author/committer date
// is pinned via GIT_AUTHOR_DATE/GIT_COMMITTER_DATE and every git
// subprocess (here and in git.ts itself) runs with TZ=UTC. Exported so
// history-command.test.ts/restore-command.test.ts's own git() helpers
// share this exact env instead of each declaring their own copy.
export const GIT_TEST_ENV = {
	...process.env,
	TZ: "UTC",
	GIT_AUTHOR_NAME: "hejbro test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "hejbro test",
	GIT_COMMITTER_EMAIL: "test@example.com",
};

const runGit = (
	cwd: string,
	args: ReadonlyArray<string>,
	extraEnv?: Record<string, string>,
): string =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...GIT_TEST_ENV, ...extraEnv },
	});

export type GitFixture = {
	readonly cwd: string;
	/** Stages every change and commits, with a fixed author/committer date (`YYYY-MM-DDTHH:mm:ssZ`, UTC) — returns the new commit's full sha. */
	readonly commit: (message: string, isoDate: string) => string;
	readonly cleanup: () => Promise<void>;
};

/** Creates a fresh temp dir and `git init`s it (default branch `main`, matching this repo's own convention) — the caller writes files and calls `commit` to build up history. */
export const createGitFixture = async (): Promise<GitFixture> => {
	const cwd = await mkdtemp(join(tmpdir(), "hejbro-git-fixture-"));
	runGit(cwd, ["init", "-q", "-b", "main"]);
	const commit = (message: string, isoDate: string): string => {
		runGit(cwd, ["add", "-A"]);
		runGit(cwd, ["commit", "-q", "-m", message], {
			GIT_AUTHOR_DATE: isoDate,
			GIT_COMMITTER_DATE: isoDate,
		});
		return runGit(cwd, ["rev-parse", "HEAD"]).trim();
	};
	const cleanup = (): Promise<void> =>
		rm(cwd, { recursive: true, force: true });
	return { cwd, commit, cleanup };
};
