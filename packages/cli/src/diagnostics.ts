import type { HejbroError } from "@hejbro/core";

/**
 * One rendered terminal diagnostic block (decision ③): `error[<code>]:
 * <identity>`, an indented `body`, zero or more indented `→ ` suggestion
 * blocks, and an optional `at <location>` tail — every section
 * (header+body, each suggestion, the `at` line) separated by a blank line
 * (owner-approved mockup, Task 11). `body`/suggestion `lines` are
 * pre-formed lines the caller supplies already wrapped/hanging-indented as
 * needed (e.g. a `⚠ ...` callout's continuation line) — this module never
 * word-wraps; it only indents. An empty string in `lines` renders as a
 * true blank line (no trailing indent), for grouping multiple instructions
 * within one suggestion. `at` is a fully-formed string supplied by the
 * caller (e.g. `"src/schema.ts (export \"posts\")"` or a raw `declaredAt`
 * location) — only ever prefixed with `at `, never parsed or reformatted.
 */
export type Diagnostic = {
	readonly code: string;
	readonly identity: string;
	readonly body: ReadonlyArray<string>;
	readonly suggestions: ReadonlyArray<{
		readonly label: string;
		readonly lines: ReadonlyArray<string>;
	}>;
	readonly at: string | null;
};

const BODY_INDENT = "  ";
const SUGGESTION_INDENT = "      ";

const renderSuggestionLine = (line: string): string => {
	if (line === "") {
		return "";
	}
	return `${SUGGESTION_INDENT}${line}`;
};

const renderSuggestion = (
	suggestion: Diagnostic["suggestions"][number],
): string =>
	[
		`${BODY_INDENT}→ ${suggestion.label}`,
		...suggestion.lines.map((line) => renderSuggestionLine(line)),
	].join("\n");

const renderAtSection = (at: string | null): ReadonlyArray<string> => {
	if (at === null) {
		return [];
	}
	return [`${BODY_INDENT}at ${at}`];
};

const renderDiagnostic = (diagnostic: Diagnostic): string => {
	const headerSection = [
		`error[${diagnostic.code}]: ${diagnostic.identity}`,
		...diagnostic.body.map((line) => `${BODY_INDENT}${line}`),
	].join("\n");
	const suggestionSections = diagnostic.suggestions.map((suggestion) =>
		renderSuggestion(suggestion),
	);
	return [
		headerSection,
		...suggestionSections,
		...renderAtSection(diagnostic.at),
	].join("\n\n");
};

const renderSummarySection = (
	summary: string | null,
): ReadonlyArray<string> => {
	if (summary === null) {
		return [];
	}
	return [summary];
};

/**
 * Renders a batch of {@link Diagnostic}s, blocks separated by a blank
 * line, with an optional trailing batch-summary line (decision ③). Pure
 * text — callers decide whether/how to color it (TTY + `NO_COLOR`) and
 * where to write it (stderr, per spec).
 */
export const renderDiagnostics = (
	diagnostics: ReadonlyArray<Diagnostic>,
	summary: string | null,
): string => {
	const blocks = diagnostics.map((diagnostic) => renderDiagnostic(diagnostic));
	return [...blocks, ...renderSummarySection(summary)].join("\n\n");
};

/**
 * Wraps a {@link HejbroError} into a {@link Diagnostic} with no
 * suggestions (callers that know rerun-command suggestions, e.g. the
 * `generate` command's rename-ambiguity handling, add them separately).
 * `identity` is caller-supplied since a `HejbroError` doesn't carry one.
 */
export const fromHejbroError = (
	error: HejbroError,
	identity: string,
): Diagnostic => ({
	code: error.code,
	identity,
	body: [error.message],
	suggestions: [],
	at: error.declaredAt,
});
