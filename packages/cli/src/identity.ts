const ADJACENT_QUOTED_PAIR = /"([^"]+)"\."([^"]+)"/;
const FIRST_QUOTED_SUBSTRING = /"([^"]+)"/;

/**
 * Interim identity-extraction heuristic, shared by error and warning
 * rendering (O3): every owner-approved flat message leads with the object
 * it's about. Tries an adjacent quoted pair first — `"app"."posts"` →
 * `app.posts` — since that is the common `schema.table`/`schema.view`
 * shape warnings and many errors use; falls back to the first bare
 * `"..."` token (a flag value, a single-part identity); falls back to
 * `fallback` when the message has no quoted substring at all. `declaredAt`
 * is a location, never a candidate — it is rendered as the diagnostic's
 * `at` line instead.
 */
export const identityFromMessage = (
	message: string,
	fallback: string,
): string => {
	const pairMatch = ADJACENT_QUOTED_PAIR.exec(message);
	if (pairMatch !== null) {
		const [, first, second] = pairMatch;
		if (first !== undefined && second !== undefined) {
			return `${first}.${second}`;
		}
	}
	const singleMatch = FIRST_QUOTED_SUBSTRING.exec(message);
	if (singleMatch === null) {
		return fallback;
	}
	return singleMatch[1] ?? fallback;
};

const FILE_URL_PREFIX = "file://";

/**
 * `declaredAt` (core's `captureDeclarationSite`) is always an absolute
 * path or `file://` URL — V8 stack traces have no notion of "relative to
 * what." Stripping `cwd` here (never in core, which has no cwd concept)
 * keeps the CLI's own "no absolute paths in output" rule (Task 14) — a
 * location outside `cwd` (e.g. a linked package) falls back to the
 * `file://`-stripped absolute path rather than a nonsensical `../../…`.
 * Shared by `generate.ts` and `verify.ts` (task 3.4, #753 review: two
 * local copies of this exact logic had already drifted once in naming
 * before this move — the same trap 3.1 closed for
 * `identityFromMessage`, reproduced under different names).
 */
const stripFileUrlPrefix = (location: string): string => {
	if (location.startsWith(FILE_URL_PREFIX)) {
		return location.slice(FILE_URL_PREFIX.length);
	}
	return location;
};

export const relativizeLocation = (location: string, cwd: string): string => {
	const withoutFileUrl = stripFileUrlPrefix(location);
	const cwdPrefix = `${cwd}/`;
	if (withoutFileUrl.startsWith(cwdPrefix)) {
		return withoutFileUrl.slice(cwdPrefix.length);
	}
	return withoutFileUrl;
};

/** `relativizeLocation`'s own `null`-passthrough wrapper, for a `HejbroError.declaredAt`/`Diagnostic.declaredAt` field (both `string | null`). */
export const relativizeDeclaredAt = (
	declaredAt: string | null,
	cwd: string,
): string | null => {
	if (declaredAt === null) {
		return null;
	}
	return relativizeLocation(declaredAt, cwd);
};
