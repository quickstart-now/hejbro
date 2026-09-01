import { schema } from "../../src/dsl/schema";
import type { Table } from "../../src/dsl/table";
import { getTableMeta, table, tableMeta } from "../../src/dsl/table";
import type { ColumnBuilder } from "../../src/types/column-builder";

/**
 * A hand-assembled `"usage"`-authority table, standing in for the deleted
 * `syncedTable()` constructor (D87 polyrepo-sync, R2-G1, seal B): nothing
 * in this package builds one anymore, so the runtime chokepoint's
 * provenance independence — it refuses any value tagged `"usage"`,
 * however it was built — can only be exercised here by constructing one
 * by hand, exactly as the caller the type layer never saw would.
 */
export const buildUsageTable = <TColumns extends Record<string, ColumnBuilder>>(
	schemaName: string,
	tableName: string,
	columns: TColumns,
): Table<TColumns, "usage"> => {
	const declared = table(schema(schemaName), tableName, columns);
	return {
		...declared,
		[tableMeta]: { ...getTableMeta(declared), authority: "usage" },
	} as Table<TColumns, "usage">;
};
