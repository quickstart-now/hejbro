import type { KindChange } from "../kind/object-kind";
import {
	asTableSnapshot,
	columnDefault,
	columnNotNull,
} from "../kinds/table-snapshot";
import type { Diagnostic } from "./validate";
import { diagnostic } from "./validate";

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
 * changes.
 */
export const notNullWithoutDefaultWarnings = (
	changes: ReadonlyArray<KindChange>,
): ReadonlyArray<Diagnostic> =>
	changes.flatMap((change) => {
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
				columnDefault(column) === null,
		);
		return addedWithoutDefault.map((column) =>
			diagnostic(
				"warning",
				"not-null-without-default",
				`column "${next.schema}"."${next.name}"."${column.name}" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.`,
			),
		);
	});
