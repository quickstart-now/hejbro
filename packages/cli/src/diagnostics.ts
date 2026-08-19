import type { HejbroError } from "@hejbro/core";

/**
 * One rendered terminal diagnostic block (decision ③): `error[<code>]:
 * <identity>`, an indented `body`, zero or more indented `→ ` suggestion
 * blocks, and an optional `at <location>` tail. `at` is a fully-formed
 * string supplied by the caller (e.g. `"src/schema.ts (export \"posts\")"`
 * or a raw `declaredAt` location) — this module never parses or reformats
 * it, only prefixes `at `.
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
const SUGGESTION_INDENT = "    ";

const renderSuggestion = (
	suggestion: Diagnostic["suggestions"][number],
): ReadonlyArray<string> => [
	`${BODY_INDENT}→ ${suggestion.label}`,
	...suggestion.lines.map((line) => `${SUGGESTION_INDENT}${line}`),
];

const renderAtLine = (at: string | null): ReadonlyArray<string> => {
	if (at === null) {
		return [];
	}
	return [`${BODY_INDENT}at ${at}`];
};

const renderDiagnostic = (diagnostic: Diagnostic): string => {
	const lines = [
		`error[${diagnostic.code}]: ${diagnostic.identity}`,
		...diagnostic.body.map((line) => `${BODY_INDENT}${line}`),
		...diagnostic.suggestions.flatMap((suggestion) =>
			renderSuggestion(suggestion),
		),
		...renderAtLine(diagnostic.at),
	];
	return lines.join("\n");
};

/**
 * Renders a batch of {@link Diagnostic}s, blocks separated by a blank
 * line, with an optional trailing batch-summary line (decision ③). Pure
 * text — callers decide whether/how to color it (TTY + `NO_COLOR`) and
 * where to write it (stderr, per spec).
 */
const renderSummaryLine = (summary: string | null): ReadonlyArray<string> => {
	if (summary === null) {
		return [];
	}
	return [summary];
};

export const renderDiagnostics = (
	diagnostics: ReadonlyArray<Diagnostic>,
	summary: string | null,
): string => {
	const blocks = diagnostics.map((diagnostic) => renderDiagnostic(diagnostic));
	return [...blocks, ...renderSummaryLine(summary)].join("\n\n");
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
