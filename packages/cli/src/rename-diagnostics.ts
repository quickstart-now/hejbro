import type { RenameAmbiguity } from "@hejbro/core";
import type { Diagnostic } from "./diagnostics";
import { assembleRerunCommand } from "./rerun";

// Builds the owner-approved rich terminal diagnostic (Task 11 mockups,
// designer-confirmed golden — decision ⑥) for an `ambiguous-column-rename`/
// `ambiguous-table-rename` RenameAmbiguity, using core's *structured*
// residual dropped/added data (not core's flat message text — see
// planner's option-B decision: a CLI-side recompute from the raw snapshot
// diff can't reproduce the residual set once some flags are already
// resolved, since only core has it at the point the ambiguity is
// detected). Every other error code (unknown-rename-target,
// duplicate-rename-target, unknown-confirm-drop-target,
// invalid-rename-flag, and the loader/snapshot errors) stays on
// `fromHejbroError` in generate.ts — their flat messages are already
// self-contained.

/**
 * Greedy word-wrap matching the owner-approved mockups' wrap width
 * (reverse-engineered from `singlePairMockup`/`multiPairMockup` in
 * diagnostics.test.ts — both wrap identically at width 70). Only the
 * prose body paragraphs are wrapped; suggestion lines (flag references,
 * rerun commands) are never prose and are never passed through this.
 */
const WRAP_WIDTH = 70;

const wordWrap = (text: string): ReadonlyArray<string> =>
	text.split(" ").reduce<Array<string>>((lines, word) => {
		const lastIndex = lines.length - 1;
		const lastLine = lines[lastIndex];
		if (lastLine === undefined) {
			lines.push(word);
			return lines;
		}
		const candidate = `${lastLine} ${word}`;
		if (candidate.length <= WRAP_WIDTH) {
			lines[lastIndex] = candidate;
			return lines;
		}
		lines.push(word);
		return lines;
	}, []);

/** "x" / "x or y" / "x, y, or z" — used inside a suggestion's "<new …, e.g. …>" placeholder. */
const joinWithOr = (items: ReadonlyArray<string>): string => {
	if (items.length === 1) {
		return items[0] ?? "";
	}
	if (items.length === 2) {
		return `${items[0]} or ${items[1]}`;
	}
	const allButLast = items.slice(0, -1).join(", ");
	return `${allButLast}, or ${items.at(-1)}`;
};

/** "1 column was dropped ("x")" / "2 columns were dropped ("x", "y")" — mirrors core's own private countedClause (rename-plan.ts), reimplemented here since it isn't part of the public surface. */
const countedClause = (
	noun: "column" | "table",
	verb: "dropped" | "added" | "created",
	names: ReadonlyArray<string>,
): string => {
	const quoted = names.map((name) => `"${name}"`).join(", ");
	if (names.length === 1) {
		return `1 ${noun} was ${verb} (${quoted})`;
	}
	return `${names.length} ${noun}s were ${verb} (${quoted})`;
};

/** The ⚠ callout every ambiguous-table-rename diagnostic carries (fixed text — decision ⑥, no names embedded) — kept pre-wrapped, not run through wordWrap, since it never changes. */
const TABLE_RENAME_CALLOUT: ReadonlyArray<string> = [
	"⚠ a table rename recreates every column, index, foreign key, RLS",
	"  policy, and trigger on it — hejbro will not guess.",
];

const rerunLines = (
	argv: ReadonlyArray<string>,
	newFlag: string,
): ReadonlyArray<string> => assembleRerunCommand(argv, [newFlag]).split("\n");

const singleColumnBody = (
	oldName: string,
	newName: string,
): ReadonlyArray<string> =>
	wordWrap(
		`column "${oldName}" was dropped and column "${newName}" was added in the same generate run — hejbro exited without writing SQL for this table; it won't guess between two possible next steps.`,
	);

const multiColumnBody = (
	dropped: ReadonlyArray<string>,
	added: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	wordWrap(
		`${countedClause("column", "dropped", dropped)} and ${countedClause("column", "added", added)} in the same generate run — hejbro exited without writing SQL for this table; it won't guess which pairs (if any) are renames.`,
	);

/** Per-dropped-column `--rename .../<placeholder>` + `--confirm-drop ...` reference pair, blank-line-separated between columns (owner mockup `multiPairMockup`). */
const perColumnOptionLines = (
	identity: string,
	dropped: ReadonlyArray<string>,
	added: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	dropped.flatMap((oldName, index) => {
		const lines = [
			`--rename ${identity}.${oldName}=<new column, e.g. ${joinWithOr(added)}>`,
			`--confirm-drop ${identity}.${oldName}`,
		];
		if (index === dropped.length - 1) {
			return lines;
		}
		return [...lines, ""];
	});

/** Positional dropped[i]↔added[i] pairing for the illustrative "example rerun" — any leftover dropped names (unequal counts) fall back to --confirm-drop so the example command stays complete. */
const exampleRenameFlags = (
	identity: string,
	dropped: ReadonlyArray<string>,
	added: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	dropped.map((oldName, index) => {
		const newName = added[index];
		if (newName === undefined) {
			return `--confirm-drop ${identity}.${oldName}`;
		}
		return `--rename ${identity}.${oldName}=${newName}`;
	});

const buildColumnAmbiguityDiagnostic = (
	ambiguity: Extract<RenameAmbiguity, { kind: "column" }>,
	argv: ReadonlyArray<string>,
	at: string | null,
): Diagnostic => {
	const { identity, dropped, added } = ambiguity;
	if (dropped.length === 1 && added.length === 1) {
		const [oldName] = dropped;
		const [newName] = added;
		const renameFlag = `--rename ${identity}.${oldName}=${newName}`;
		const confirmDropFlag = `--confirm-drop ${identity}.${oldName}`;
		return {
			code: "ambiguous-column-rename",
			identity,
			body: singleColumnBody(oldName ?? "", newName ?? ""),
			suggestions: [
				{
					label: "if this is a rename, rerun:",
					lines: rerunLines(argv, renameFlag),
				},
				{
					label: "if these are unrelated changes, rerun:",
					lines: rerunLines(argv, confirmDropFlag),
				},
			],
			at,
		};
	}
	const exampleFlags = exampleRenameFlags(identity, dropped, added);
	return {
		code: "ambiguous-column-rename",
		identity,
		body: multiColumnBody(dropped, added),
		suggestions: [
			{
				label: "every dropped column needs one of:",
				lines: perColumnOptionLines(identity, dropped, added),
			},
			{
				label:
					"example rerun once you've decided (edit the <...> placeholders):",
				lines: assembleRerunCommand(argv, exampleFlags).split("\n"),
			},
		],
		at,
	};
};

const singleTableBody = (
	oldName: string,
	newName: string,
): ReadonlyArray<string> => [
	`table "${oldName}" was dropped, table "${newName}" was created.`,
	...TABLE_RENAME_CALLOUT,
];

const multiTableBody = (
	dropped: ReadonlyArray<string>,
	added: ReadonlyArray<string>,
): ReadonlyArray<string> => [
	...wordWrap(
		`${countedClause("table", "dropped", dropped)} and ${countedClause("table", "created", added)} in the same generate run.`,
	),
	...TABLE_RENAME_CALLOUT,
];

/** @see perColumnOptionLines — the table-level counterpart. */
const perTableOptionLines = (
	schemaName: string,
	dropped: ReadonlyArray<string>,
	added: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	dropped.flatMap((oldName, index) => {
		const lines = [
			`--rename ${schemaName}.${oldName}=<new table, e.g. ${joinWithOr(added)}>`,
			`--confirm-drop ${schemaName}.${oldName}`,
		];
		if (index === dropped.length - 1) {
			return lines;
		}
		return [...lines, ""];
	});

/**
 * The 1:1 case's own suggestions when the created table is declared
 * with `existingTable()` (#703): `--rename` onto it would itself be
 * refused by `unknown-rename-target` the moment this rerun tried it,
 * so offering it as "if this is a rename, rerun: --rename ..." is the
 * prescribed remedy being the command that would just fail again — the
 * same shape D106 R5-B1 was filed against, one door over. Names the
 * two-run path instead: `--rename` while both sides are still
 * `table()`, then hand over in a later run.
 */
const existingTargetTableSuggestions = (
	argv: ReadonlyArray<string>,
	schemaName: string,
	oldName: string,
	newName: string,
): Diagnostic["suggestions"] => [
	{
		// #703: shares the exact phrase "two runs" with core's own flat
		// message (ambiguousTableRenameMessage) on purpose -- this piece
		// paid for "the same fact stated in different words in two
		// places" five rounds running, and a reader who sees the flat
		// message in a log after seeing this one in a terminal should
		// recognize it as the same guidance, not a second, different fact.
		label:
			"if the table really is the same one, do it in two runs -- run this NOW, then hand it over to existingTable() in a LATER run:",
		lines: rerunLines(argv, `--rename ${schemaName}.${oldName}=${newName}`),
	},
	{
		label: "if these are unrelated tables, rerun:",
		lines: rerunLines(argv, `--confirm-drop ${schemaName}.${oldName}`),
	},
];

const ordinaryTableSuggestions = (
	argv: ReadonlyArray<string>,
	renameFlag: string,
	confirmDropFlag: string,
): Diagnostic["suggestions"] => [
	{
		label: "if this is a rename, rerun:",
		lines: rerunLines(argv, renameFlag),
	},
	{
		label: "if these are unrelated tables, rerun:",
		lines: rerunLines(argv, confirmDropFlag),
	},
];

/** {@link buildTableAmbiguityDiagnostic}'s own 1:1-case branch (#703: the two suggestion shapes are the only difference the existing-target case makes). */
const singleTableSuggestions = (
	argv: ReadonlyArray<string>,
	schemaName: string,
	oldName: string,
	newName: string,
	targetIsExisting: boolean,
): Diagnostic["suggestions"] => {
	if (targetIsExisting) {
		return existingTargetTableSuggestions(argv, schemaName, oldName, newName);
	}
	return ordinaryTableSuggestions(
		argv,
		`--rename ${schemaName}.${oldName}=${newName}`,
		`--confirm-drop ${schemaName}.${oldName}`,
	);
};

const buildTableAmbiguityDiagnostic = (
	ambiguity: Extract<RenameAmbiguity, { kind: "table" }>,
	argv: ReadonlyArray<string>,
	at: string | null,
): Diagnostic => {
	const { schemaName, droppedTables, createdTables, existingCreatedTables } =
		ambiguity;
	if (droppedTables.length === 1 && createdTables.length === 1) {
		const [oldName] = droppedTables;
		const [newName] = createdTables;
		return {
			code: "ambiguous-table-rename",
			identity: schemaName,
			body: singleTableBody(oldName ?? "", newName ?? ""),
			suggestions: singleTableSuggestions(
				argv,
				schemaName,
				oldName ?? "",
				newName ?? "",
				existingCreatedTables.includes(newName ?? ""),
			),
			at,
		};
	}
	const exampleFlags = exampleRenameFlags(
		schemaName,
		droppedTables,
		createdTables,
	);
	return {
		code: "ambiguous-table-rename",
		identity: schemaName,
		body: multiTableBody(droppedTables, createdTables),
		suggestions: [
			{
				label: "every dropped table needs one of:",
				lines: perTableOptionLines(schemaName, droppedTables, createdTables),
			},
			{
				label:
					"example rerun once you've decided (edit the <...> placeholders):",
				lines: assembleRerunCommand(argv, exampleFlags).split("\n"),
			},
		],
		at,
	};
};

/**
 * Builds the rich terminal diagnostic for one `RenameAmbiguity` (owner-
 * approved mockups, decision ⑥) — `at` is the caller's already-relativized
 * `declaredAt` (never resolved/stripped here; this module has no notion of
 * cwd).
 */
export const buildAmbiguityDiagnostic = (
	ambiguity: RenameAmbiguity,
	argv: ReadonlyArray<string>,
	at: string | null,
): Diagnostic => {
	if (ambiguity.kind === "column") {
		return buildColumnAmbiguityDiagnostic(ambiguity, argv, at);
	}
	return buildTableAmbiguityDiagnostic(ambiguity, argv, at);
};
