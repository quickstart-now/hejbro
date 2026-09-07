import { throwHejbroError } from "@hejbro/core";
import type { ContractOrigin } from "./emit";
import type { TableComputation } from "./tables";

type CollisionGroup = {
	readonly sqlName: string;
	readonly qualified: ReadonlyArray<string>;
};

const qualify = (computation: TableComputation): string =>
	`"${computation.table.schema}"."${computation.table.name}"`;

const byIdentity = (x: TableComputation, y: TableComputation): number => {
	const bySchema = x.table.schema.localeCompare(y.table.schema);
	if (bySchema !== 0) {
		return bySchema;
	}
	return x.table.name.localeCompare(y.table.name);
};

/** The SQL names carried by more than one table, each with every
 * schema-qualified table that carries it, both levels in identity order
 * (schema-vendoring spec, "Two carried tables with one SQL name are
 * refused at emission"). Grouping is by the SQL name exactly as the
 * payload carries it: `Tables` is keyed by that string and nothing
 * else, so no normalization may widen or narrow the group. */
export const tableNameCollisions = (
	tables: ReadonlyArray<TableComputation>,
): ReadonlyArray<CollisionGroup> => {
	const sorted = [...tables].sort(byIdentity);
	const names = [...new Set(sorted.map((entry) => entry.table.name))].sort(
		(x, y) => x.localeCompare(y),
	);
	return names
		.map((sqlName) => ({
			sqlName,
			qualified: sorted
				.filter((entry) => entry.table.name === sqlName)
				.map(qualify),
		}))
		.filter((group) => group.qualified.length > 1);
};

const REMEDIES: Record<
	ContractOrigin["source"],
	{ readonly code: string; readonly command: string; readonly next: string }
> = {
	git: {
		code: "vendor-table-name-collision",
		command: "hejbro vendor",
		next: "Next: --schema is reserved on vendor, so the export itself must carry one table per SQL name; that is the declaring repository's to change.",
	},
	database: {
		code: "pull-table-name-collision",
		command: "hejbro pull",
		next: "Next: drop one of the schemas from --schema and rerun hejbro pull.",
	},
};

const describeGroup = (group: CollisionGroup): string =>
	`more than one table named "${group.sqlName}" (${group.qualified.join(", ")})`;

/** Refuses a payload whose contract could not be well formed: the
 * emitted `Tables` would carry one key twice. Runs before any rendering
 * and before either command writes a file, so a refusal leaves no vendor
 * layout behind. One code per command because the remedies differ. */
export const assertUniqueTableNames = (
	tables: ReadonlyArray<TableComputation>,
	origin: ContractOrigin,
): void => {
	const groups = tableNameCollisions(tables);
	if (groups.length === 0) {
		return;
	}
	const remedy = REMEDIES[origin.source];
	throwHejbroError(
		remedy.code,
		`${remedy.command} cannot emit the contract: "Tables" is keyed by the table's SQL name alone, and the carried tables hold ${groups.map(describeGroup).join("; ")}. ${remedy.next}`,
	);
};
