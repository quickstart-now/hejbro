import type { ConfirmDropSpec, RenameSpec } from "@hejbro/core";
import { throwHejbroError } from "@hejbro/core";

/**
 * Every value-taking flag any command accepts (rerun.ts:5's own list for
 * `generate`, plus `check`'s `--url` and `sync`'s `--url`/`--out`/
 * `--schema`) — the complete surface, confirmed by reading every command
 * (`verify`/`init` take none). Adding a new
 * value-taking flag means adding it here too, or it silently keeps
 * requiring the space form (measured: `check --url=...` was dropped
 * while `check --url ...` worked, and with `DATABASE_URL` also set the
 * command silently checked a different database than the one named).
 */
const VALUE_TAKING_FLAGS: ReadonlyArray<string> = [
	"--config",
	"--name",
	"--rename",
	"--confirm-drop",
	"--url",
	"--out",
	"--schema",
];

/**
 * Splits a `--flag=value` token into `["--flag", "value"]` so it's
 * indistinguishable from the space form (`--flag`, `value`) to every
 * downstream consumer — flag-value collection (this file's callers) and
 * `rerun.ts`'s argv pairing both need this to already be true, so it's
 * applied exactly once, at `runGenerate`'s entry point, rather than
 * separately in each. Only tokens that start with a *known* flag name
 * followed by `=` are split — a value token that happens to start with
 * `--something=` (unlikely, but not impossible for `--config`) is left
 * alone unless `--something` is itself one of the four flags above.
 * Splits on the *first* `=` only, so `--rename=a.b.c=d` (a value that
 * itself contains `=`) becomes `["--rename", "a.b.c=d"]`, not truncated.
 * An empty value (`--flag=`) becomes `["--flag", ""]` — deliberately not
 * special-cased; the existing per-flag value parser (e.g.
 * `parseRenameFlag("")`) already rejects it with its own diagnostic, the
 * same as an empty space-form value would. A value that looks like
 * another flag (`--flag=--other`) is taken literally as the string
 * `"--other"` — consistent with the space form, which never inspects a
 * value for looking flag-like either.
 */
export const normalizeEqualsFlags = (
	argv: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	argv.flatMap((token) => {
		const flag = VALUE_TAKING_FLAGS.find((candidate) =>
			token.startsWith(`${candidate}=`),
		);
		if (flag === undefined) {
			return [token];
		}
		return [flag, token.slice(flag.length + 1)];
	});

const invalidRenameFlagMessage = (value: string): string =>
	`--rename value "${value}" isn't in the expected "<schema>.<table>.<old>=<new>" (column) or "<schema>.<old>=<new>" (table) form. Next: check for extra "." characters, and make sure the value contains exactly one "=".`;

/** Owner-approved text (planner msg 00997dc7, 2026-08-20) — --rename's approved wording, substituting --confirm-drop's own (=-less) grammar. */
const invalidConfirmDropFlagMessage = (value: string): string =>
	`--confirm-drop value "${value}" isn't in the expected "<schema>.<table>.<column>" (column) or "<schema>.<table>" (table) form. Next: check for extra "." characters.`;

/**
 * Parses a `--rename` flag value: `<schema>.<table>.<old>=<new>` (3
 * dot-segments on the left, column) or `<schema>.<old>=<new>` (2
 * dot-segments, table) — exactly one `=`. Throws `invalid-rename-flag`
 * (owner-approved text) on any other shape.
 */
export const parseRenameFlag = (value: string): RenameSpec => {
	const equalsParts = value.split("=");
	if (equalsParts.length !== 2) {
		return throwHejbroError(
			"invalid-rename-flag",
			invalidRenameFlagMessage(value),
		);
	}
	const [left, newName] = equalsParts;
	const segments = (left ?? "").split(".");
	if (segments.length === 3) {
		const [schemaName, tableName, oldName] = segments;
		return {
			target: "column",
			schemaName: schemaName ?? "",
			tableName: tableName ?? "",
			oldName: oldName ?? "",
			newName: newName ?? "",
		};
	}
	if (segments.length === 2) {
		const [schemaName, oldName] = segments;
		return {
			target: "table",
			schemaName: schemaName ?? "",
			oldName: oldName ?? "",
			newName: newName ?? "",
		};
	}
	return throwHejbroError(
		"invalid-rename-flag",
		invalidRenameFlagMessage(value),
	);
};

/**
 * Parses a `--confirm-drop` flag value: `<schema>.<table>.<column>` (3
 * dot-segments, column) or `<schema>.<table>` (2 dot-segments, table) — no
 * `=`. Format errors reuse `invalid-rename-flag` (plan's explicit
 * direction — the same code covers both flags' format errors).
 */
export const parseConfirmDropFlag = (value: string): ConfirmDropSpec => {
	if (value.includes("=")) {
		return throwHejbroError(
			"invalid-rename-flag",
			invalidConfirmDropFlagMessage(value),
		);
	}
	const segments = value.split(".");
	if (segments.length === 3) {
		const [schemaName, tableName, columnName] = segments;
		return {
			target: "column",
			schemaName: schemaName ?? "",
			tableName: tableName ?? "",
			columnName: columnName ?? "",
		};
	}
	if (segments.length === 2) {
		const [schemaName, tableName] = segments;
		return {
			target: "table",
			schemaName: schemaName ?? "",
			tableName: tableName ?? "",
		};
	}
	return throwHejbroError(
		"invalid-rename-flag",
		invalidConfirmDropFlagMessage(value),
	);
};
