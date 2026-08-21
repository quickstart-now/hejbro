import type { KindChange } from "../kind/object-kind";
import { asSequenceSnapshot } from "../kinds/sequence-kind";
import {
	asTableSnapshot,
	columnDefault,
	columnNotNull,
} from "../kinds/table-snapshot";
import type { Diagnostic } from "./validate";
import { diagnostic } from "./validate";

/**
 * `"<schema>.<table>.<column>"` for every `sequence` change in this diff
 * whose sequence still exists in `next` (a `create` or an `alter`, never a
 * `drop`) — the set of columns that effectively *do* have a default, even
 * though a `serial`-family column's default lives in the `sequence` kind's
 * own snapshot node, not `ColumnSnapshot.default` (#23/D66). Read by
 * {@link notNullWithoutDefaultWarnings} below so it doesn't warn on a
 * column whose default this diff is about to attach via a sibling
 * `sequence` change — the two kinds' changes live in the same `changes`
 * array this function already receives, so no new cross-kind plumbing is
 * needed, only reading what's already there.
 */
const sequenceOwnedColumns = (
	changes: ReadonlyArray<KindChange>,
): ReadonlySet<string> =>
	new Set(
		changes
			.filter((change) => change.kind === "sequence" && change.next !== null)
			.map((change) => asSequenceSnapshot(change.next))
			.map(
				(sequence) => `${sequence.schema}.${sequence.table}.${sequence.column}`,
			),
	);

/**
 * Warns when a table `alter` change adds a `not null` column with no
 * `default` — such a migration fails on any table that already has rows.
 * Built in (not a preset `Validator`, D37): validators only see the built
 * snapshot and declarations, never the previous snapshot, so this check
 * needs the diff itself — `generateMigration` calls it right after
 * `diffSnapshots` and folds the result into `warnings` (#27).
 *
 * Only genuinely *new* columns are flagged (present in `next`, absent
 * from `previous`); a `create` change (a brand-new table) never appears
 * here because `notNullWithoutDefaultWarnings` only looks at `alter`
 * changes. A column owned by a `sequence` change in the same diff is
 * never flagged either (#23/D66) — see {@link sequenceOwnedColumns}.
 */
export const notNullWithoutDefaultWarnings = (
	changes: ReadonlyArray<KindChange>,
): ReadonlyArray<Diagnostic> => {
	const ownedBySequence = sequenceOwnedColumns(changes);
	return changes.flatMap((change) => {
		if (
			change.kind !== "table" ||
			change.operation !== "alter" ||
			change.previous === null ||
			change.next === null
		) {
			return [];
		}
		const previous = asTableSnapshot(change.previous);
		const next = asTableSnapshot(change.next);
		const previousColumnNames = new Set(
			previous.columns.map((column) => column.name),
		);
		const addedWithoutDefault = next.columns.filter(
			(column) =>
				!previousColumnNames.has(column.name) &&
				columnNotNull(column) &&
				columnDefault(column) === null &&
				!ownedBySequence.has(`${next.schema}.${next.name}.${column.name}`),
		);
		return addedWithoutDefault.map((column) =>
			diagnostic(
				"warning",
				"not-null-without-default",
				`column "${next.schema}"."${next.name}"."${column.name}" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.`,
			),
		);
	});
};
