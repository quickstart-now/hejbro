import type { ConfirmDropSpec, RenameSpec } from "@hejbro/core";
import { throwHejbroError } from "@hejbro/core";

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
