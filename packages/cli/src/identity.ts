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
