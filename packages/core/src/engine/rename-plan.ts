import { guardSnapshotRead } from "../error";
import type { Snapshot } from "../snapshot/snapshot";
import { compareKeys } from "../sort";
import {
	consumedColumnNamesByTable,
	consumedTableNamesBySchema,
	residualColumnAmbiguities,
	residualTableAmbiguities,
} from "./rename/ambiguities";
import { applyRenameSpecs } from "./rename/apply";
import { partitionConfirmDrops, partitionRenameSpecs } from "./rename/claims";
import {
	computeSchemaTableSets,
	computeTableColumnSets,
	excludeExisting,
	tableEntries,
	tableRenamePairings,
} from "./rename/snapshot-sets";
import type { ConfirmDropSpec, RenamePlan, RenameSpec } from "./rename/types";

export type {
	ColumnRenameAmbiguity,
	ColumnRenameSpec,
	ConfirmDropSpec,
	RenameAmbiguity,
	RenamePlan,
	RenameSpec,
	TableRenameAmbiguity,
	TableRenameSpec,
} from "./rename/types";

/**
 * Resolves `--rename`/`--confirm-drop` flags against a `previous`→`next`
 * snapshot pair (decision D32, rule A): validates each flag, applies valid
 * renames to `previous` (including the derived index/FK name drift guard,
 * algorithm step 4), and reports any residual same-table/-schema drop+add
 * pair left unresolved as a batch of diagnostics.
 */
export const planRenames = (options: {
	readonly previous: Snapshot;
	readonly next: Snapshot;
	readonly renames: ReadonlyArray<RenameSpec>;
	readonly confirmedDrops: ReadonlyArray<ConfirmDropSpec>;
	readonly declaredAtByIdentity: ReadonlyMap<string, string | null>;
}): RenamePlan =>
	guardSnapshotRead("planning renames from the on-disk snapshot", () => {
		const { previousTables, nextTables } = excludeExisting(
			tableEntries(options.previous.objects),
			tableEntries(options.next.objects),
		);
		const schemaTableSets = computeSchemaTableSets(previousTables, nextTables);
		const renamedPairings = tableRenamePairings(
			options.renames,
			schemaTableSets,
		);
		const tableColumnSets = computeTableColumnSets(
			previousTables,
			nextTables,
			renamedPairings,
		);

		const renameResult = partitionRenameSpecs(
			options.renames,
			schemaTableSets,
			tableColumnSets,
			options.declaredAtByIdentity,
		);
		const dropResult = partitionConfirmDrops(
			options.confirmedDrops,
			schemaTableSets,
			tableColumnSets,
		);

		const applied = applyRenameSpecs(
			options.previous.objects,
			renameResult.validSpecs,
		);

		const consumedColumns = consumedColumnNamesByTable(
			renameResult.validSpecs,
			dropResult.validDrops,
		);
		const consumedTables = consumedTableNamesBySchema(
			renameResult.validSpecs,
			dropResult.validDrops,
		);

		const columnAmbiguityResults = residualColumnAmbiguities(
			tableColumnSets,
			consumedColumns,
			options.declaredAtByIdentity,
		);
		const tableAmbiguityResults = residualTableAmbiguities(
			schemaTableSets,
			consumedTables,
			options.declaredAtByIdentity,
		);
		const ambiguityResults = [
			...tableAmbiguityResults,
			...columnAmbiguityResults,
		];

		const errors = [
			...renameResult.errors,
			...dropResult.errors,
			...ambiguityResults.map((result) => result.error),
		];
		const ambiguities = ambiguityResults.map((result) => result.ambiguity);

		const rewrittenPrevious: Snapshot = {
			...options.previous,
			objects: applied.objects,
		};

		return {
			rewrittenPrevious,
			renameStatements: applied.statements,
			renameChanges: [...applied.changes].sort((a, b) =>
				compareKeys(a.identity, b.identity),
			),
			errors,
			ambiguities,
		};
	});
