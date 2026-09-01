import type { GitCommitInfo } from "./git";
import type { MigrationState } from "./history-state";
import { deriveRemoteLinks, osc8Link } from "./remote-links";
import type { LinkMode } from "./tty";

/** One `hejbro history` row (§9, #130) — oldest migration first, `number` 1-based. */
export type HistoryRow = {
	readonly number: number;
	readonly migrationFileName: string;
	readonly state: MigrationState;
	readonly commit: GitCommitInfo | null;
	/** The migration's own recorded banner hash (`"sha256:<hex>"`) — always present, read straight from the migration file on disk, independent of git state. */
	readonly snapshotHash: string;
};

const PLACEHOLDER_UNCOMMITTED = "(uncommitted)";
const PLACEHOLDER_REWRITTEN = "(rewritten)";
const PLACEHOLDER_NONE = "—";

/** The literal placeholder a commit-shaped column (`commit`/`date`) shows for a row with no real commit — one of exactly three strings (§9), chosen by `state`. */
const missingCommitPlaceholder = (state: MigrationState): string => {
	if (state === "uncommitted") {
		return PLACEHOLDER_UNCOMMITTED;
	}
	if (state === "rewritten") {
		return PLACEHOLDER_REWRITTEN;
	}
	return PLACEHOLDER_NONE;
};

const commitCell = (row: HistoryRow): string => {
	if (row.commit === null) {
		return missingCommitPlaceholder(row.state);
	}
	return row.commit.sha.slice(0, 7);
};

const dateCell = (row: HistoryRow): string => {
	if (row.commit === null) {
		return missingCommitPlaceholder(row.state);
	}
	return row.commit.date;
};

const subjectCell = (row: HistoryRow): string => row.commit?.subject ?? "";

const SNAPSHOT_CELL_LENGTH = 19;

const snapshotCell = (row: HistoryRow): string =>
	`${row.snapshotHash.slice(0, SNAPSHOT_CELL_LENGTH)}…`;

type PlainRowCells = {
	readonly number: string;
	readonly migration: string;
	readonly commit: string;
	readonly date: string;
	readonly state: string;
	readonly snapshot: string;
	readonly subject: string;
	readonly migrationUrl: string;
	readonly commitUrl: string;
};

const HEADER_ROW: Omit<PlainRowCells, "migrationUrl" | "commitUrl"> & {
	readonly migrationUrl: string;
	readonly commitUrl: string;
} = {
	number: "#",
	migration: "migration",
	commit: "commit",
	date: "date",
	state: "state",
	snapshot: "snapshot",
	subject: "subject",
	migrationUrl: "migration-url",
	commitUrl: "commit-url",
};

/** Options threading through {@link renderHistoryTable} — `remote`/`migrationsDirRelative` are only read when `linkMode === "plain"`. */
export type HistoryTableOptions = {
	readonly linkMode: LinkMode;
	readonly remote: string | null;
	readonly migrationsDirRelative: string;
};

const toPlainCells = (
	row: HistoryRow,
	options: HistoryTableOptions,
): PlainRowCells => {
	const base = {
		number: String(row.number),
		migration: row.migrationFileName,
		commit: commitCell(row),
		date: dateCell(row),
		state: row.state,
		snapshot: snapshotCell(row),
		subject: subjectCell(row),
	};
	// URL columns only ever have a value for a row with a real commit
	// (ok/lost) on a recognized remote host -- everything else (no
	// commit at all, or an unrecognized remote) renders blank, not a
	// placeholder string (an empty URL cell reads as "not applicable",
	// unlike the commit/date columns' own three-way placeholder, which
	// exists because those columns otherwise show numbers/dates the
	// reader expects to always be there).
	if (
		options.linkMode !== "plain" ||
		row.commit === null ||
		options.remote === null
	) {
		return { ...base, migrationUrl: "", commitUrl: "" };
	}
	const links = deriveRemoteLinks(
		options.remote,
		row.commit.sha,
		`${options.migrationsDirRelative}/${row.migrationFileName}`,
	);
	if (links === null) {
		return { ...base, migrationUrl: "", commitUrl: "" };
	}
	return {
		...base,
		migrationUrl: links.migrationUrl,
		commitUrl: links.commitUrl,
	};
};

const COLUMN_KEYS: ReadonlyArray<keyof PlainRowCells> = [
	"number",
	"migration",
	"commit",
	"date",
	"state",
	"snapshot",
	"subject",
];

const COLUMN_KEYS_WITH_LINKS: ReadonlyArray<keyof PlainRowCells> = [
	...COLUMN_KEYS,
	"migrationUrl",
	"commitUrl",
];

const columnKeysFor = (
	linkMode: LinkMode,
): ReadonlyArray<keyof PlainRowCells> => {
	if (linkMode === "plain") {
		return COLUMN_KEYS_WITH_LINKS;
	}
	return COLUMN_KEYS;
};

const columnWidths = (
	keys: ReadonlyArray<keyof PlainRowCells>,
	rows: ReadonlyArray<PlainRowCells>,
): ReadonlyMap<keyof PlainRowCells, number> =>
	new Map(
		keys.map((key) => [
			key,
			Math.max(HEADER_ROW[key].length, ...rows.map((row) => row[key].length)),
		]),
	);

const COLUMN_SEPARATOR = "  ";

const padCell = (value: string, width: number): string =>
	value.padEnd(width, " ");

const renderPlainRow = (
	cells: PlainRowCells,
	keys: ReadonlyArray<keyof PlainRowCells>,
	widths: ReadonlyMap<keyof PlainRowCells, number>,
): string =>
	keys
		.map((key, index) => {
			const value = cells[key];
			if (index === keys.length - 1) {
				return value;
			}
			return padCell(value, widths.get(key) ?? value.length);
		})
		.join(COLUMN_SEPARATOR);

/** `"2 and 3"` for two numbers, `"2, 3 and 4"` for three or more (Oxford-comma-free, matching this repo's own batch-summary convention elsewhere in the CLI). */
const joinWithAnd = (numbers: ReadonlyArray<number>): string => {
	if (numbers.length === 1) {
		return String(numbers[0]);
	}
	const allButLast = numbers.slice(0, -1);
	const last = numbers.at(-1);
	return `${allButLast.join(", ")} and ${last}`;
};

const pluralNoun = (count: number): string => {
	if (count === 1) {
		return "migration";
	}
	return "migrations";
};

/**
 * A lost-migration group note: every migration sharing `commit` (co-added),
 * the last one's own state (still `ok` — the survivor), suggesting a
 * restore of that survivor. `null` when nothing in the group is actually
 * lost (a co-add group where everything still resolves `ok` needs no
 * note), or when the group has no surviving `ok` migration to point at
 * (defensive — every real co-add group's last member is the one whose
 * snapshot the commit actually recorded).
 *
 * [task 4.7] States only what git can observe — that only the survivor's
 * declaration state exists in git — and names no cause. An earlier
 * version of this text asserted one ("squash merge lost …'s"), which was
 * true of every case this tool had seen until the generator started
 * splitting a run at a transaction boundary (`add-apply-engine`): a
 * split pair's first file names an intermediate snapshot that is never
 * written to disk at all, so it reads exactly like a squash-flattened
 * migration despite no history rewrite ever happening. Rather than tell
 * the two causes apart (git cannot: both leave the identical trace, an
 * unmatched hash), this note asserts only what is true either way.
 */
const lostGroupNote = (
	commit: GitCommitInfo,
	group: ReadonlyArray<HistoryRow>,
): string | null => {
	const lostNumbers = group
		.filter((row) => row.state === "lost")
		.map((row) => row.number);
	if (lostNumbers.length === 0) {
		return null;
	}
	const allNumbers = group.map((row) => row.number);
	const survivor = group.reduce<HistoryRow | null>((latest, row) => {
		if (latest === null || row.number > latest.number) {
			return row;
		}
		return latest;
	}, null);
	if (survivor === null || survivor.state !== "ok") {
		return null;
	}
	const migrationNoun = pluralNoun(allNumbers.length);
	return `note: ${migrationNoun} ${joinWithAnd(allNumbers)} were added together in commit ${commit.sha.slice(0, 7)} — only migration ${survivor.number}'s declaration state exists in git. Closest available: \`hejbro restore ${survivor.number}\`.`;
};

const rewrittenNote = (row: HistoryRow): string =>
	`note: migration ${row.number}'s commit could not be found — history may have been rewritten (rebase/force-push). Check \`git reflog\` or the original feature branch.`;

type RowWithCommit = HistoryRow & { readonly commit: GitCommitInfo };

const groupByCommit = (
	rows: ReadonlyArray<HistoryRow>,
): ReadonlyArray<{
	readonly commit: GitCommitInfo;
	readonly group: ReadonlyArray<HistoryRow>;
}> => {
	const withCommit = rows.filter(
		(row): row is RowWithCommit => row.commit !== null,
	);
	const bySha = withCommit.reduce((map, row) => {
		const existing = map.get(row.commit.sha) ?? [];
		return new Map(map).set(row.commit.sha, [...existing, row]);
	}, new Map<string, ReadonlyArray<RowWithCommit>>());
	return Array.from(bySha.entries()).map(([, group]) => {
		const [first] = group;
		if (first === undefined) {
			throw new Error("unreachable — groupByCommit produced an empty group");
		}
		return { commit: first.commit, group };
	});
};

const notesFor = (rows: ReadonlyArray<HistoryRow>): ReadonlyArray<string> => {
	const lostNotes = groupByCommit(rows).flatMap(({ commit, group }) => {
		const note = lostGroupNote(commit, group);
		if (note === null) {
			return [];
		}
		return [note];
	});
	const rewrittenNotes = rows
		.filter((row) => row.state === "rewritten")
		.map((row) => rewrittenNote(row));
	return [...lostNotes, ...rewrittenNotes];
};

/**
 * Renders `hejbro history`'s full stdout: the table (§9's exact grammar
 * — space-padded columns, oldest migration first), plus a trailing
 * `note:` line per lost-migration group and per `rewritten` migration.
 * `linkMode: "osc8"` doesn't add columns — it wraps the existing
 * `commit`/`migration` cell text in an OSC8 hyperlink, leaving every
 * column's own width/content otherwise identical to the no-links
 * render.
 */
export const renderHistoryTable = (
	rows: ReadonlyArray<HistoryRow>,
	options: HistoryTableOptions,
): string => {
	const keys = columnKeysFor(options.linkMode);
	const plainCells = rows.map((row) => toPlainCells(row, options));
	const widths = columnWidths(keys, plainCells);
	const headerLine = renderPlainRow(HEADER_ROW, keys, widths);
	const dataLines = rows.map((row, index) => {
		const cells = plainCells[index];
		if (cells === undefined) {
			throw new Error("unreachable — rows/plainCells length mismatch");
		}
		if (
			options.linkMode !== "osc8" ||
			row.commit === null ||
			options.remote === null
		) {
			return renderPlainRow(cells, keys, widths);
		}
		const links = deriveRemoteLinks(
			options.remote,
			row.commit.sha,
			`${options.migrationsDirRelative}/${row.migrationFileName}`,
		);
		if (links === null) {
			return renderPlainRow(cells, keys, widths);
		}
		// Pad the plain cell text to its column width *before* wrapping it
		// in the OSC8 escape sequence, not after: renderPlainRow's own
		// padEnd call, run on an already-wrapped string, sees the escape
		// bytes as part of the string's length and pads nothing further,
		// silently losing the column separator's worth of alignment for
		// every column after the first hyperlinked one (TTY-only --
		// non-TTY output never reaches this branch, see shouldUseLinks).
		const withHyperlinks: PlainRowCells = {
			...cells,
			migration: osc8Link(
				padCell(
					cells.migration,
					widths.get("migration") ?? cells.migration.length,
				),
				links.migrationUrl,
			),
			commit: osc8Link(
				padCell(cells.commit, widths.get("commit") ?? cells.commit.length),
				links.commitUrl,
			),
		};
		return renderPlainRow(withHyperlinks, keys, widths);
	});
	const notes = notesFor(rows);
	const lines = [headerLine, ...dataLines, ...notes.map((note) => `\n${note}`)];
	return lines.join("\n");
};
