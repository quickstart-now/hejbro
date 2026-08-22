/**
 * `hejbro history --links`'s URL builder (§9, #130) — pure, no git call
 * (that's {@link import("./git").remoteUrl}'s job): given a remote URL
 * string already read from git, derives the migration-file blob URL and
 * the commit URL for GitHub/GitLab remotes. Any other host renders
 * plain (no columns, no OSC8) — silently, not an error: an unrecognized
 * host is not a defect, just nothing this command knows how to link.
 */
export type RemoteLinks = {
	readonly migrationUrl: string;
	readonly commitUrl: string;
};

type KnownHost = "github" | "gitlab";

type ParsedRemote = {
	readonly host: KnownHost;
	readonly ownerAndRepo: string;
};

const GITHUB_HTTPS = /^https?:\/\/github\.com\/(.+?)(?:\.git)?\/?$/;
const GITHUB_SSH = /^git@github\.com:(.+?)(?:\.git)?\/?$/;
const GITLAB_HTTPS = /^https?:\/\/gitlab\.com\/(.+?)(?:\.git)?\/?$/;
const GITLAB_SSH = /^git@gitlab\.com:(.+?)(?:\.git)?\/?$/;

const parseRemote = (remote: string): ParsedRemote | null => {
	const githubMatch = GITHUB_HTTPS.exec(remote) ?? GITHUB_SSH.exec(remote);
	if (githubMatch !== null) {
		const [, ownerAndRepo] = githubMatch;
		if (ownerAndRepo !== undefined) {
			return { host: "github", ownerAndRepo };
		}
	}
	const gitlabMatch = GITLAB_HTTPS.exec(remote) ?? GITLAB_SSH.exec(remote);
	if (gitlabMatch !== null) {
		const [, ownerAndRepo] = gitlabMatch;
		if (ownerAndRepo !== undefined) {
			return { host: "gitlab", ownerAndRepo };
		}
	}
	return null;
};

const blobUrl = (parsed: ParsedRemote, sha: string, path: string): string => {
	if (parsed.host === "gitlab") {
		return `https://gitlab.com/${parsed.ownerAndRepo}/-/blob/${sha}/${path}`;
	}
	return `https://github.com/${parsed.ownerAndRepo}/blob/${sha}/${path}`;
};

const commitUrl = (parsed: ParsedRemote, sha: string): string => {
	if (parsed.host === "gitlab") {
		return `https://gitlab.com/${parsed.ownerAndRepo}/-/commit/${sha}`;
	}
	return `https://github.com/${parsed.ownerAndRepo}/commit/${sha}`;
};

/** `null` for a remote this function doesn't recognize (any host other than github.com/gitlab.com) — the caller renders that row plain, same as having no remote at all. */
export const deriveRemoteLinks = (
	remote: string,
	sha: string,
	path: string,
): RemoteLinks | null => {
	const parsed = parseRemote(remote);
	if (parsed === null) {
		return null;
	}
	return {
		migrationUrl: blobUrl(parsed, sha, path),
		commitUrl: commitUrl(parsed, sha),
	};
};

/** Wraps `text` in an OSC8 hyperlink escape sequence pointing at `url` — the cell's own visible text never changes (§9's own requirement). */
export const osc8Link = (text: string, url: string): string =>
	`\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
