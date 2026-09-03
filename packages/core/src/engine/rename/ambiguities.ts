import type { HejbroError } from "../../error";
import { hejbroError } from "../../error";
import type { TableSnapshot } from "../../kinds/table-snapshot";
import { tableExisting, tableIdentity } from "../../kinds/table-snapshot";
import { compareKeys } from "../../sort";
import type {
	NameSets,
	SchemaTableSets,
	TableColumnSets,
} from "./snapshot-sets";
import { setDifference } from "./snapshot-sets";
import type {
	ColumnRenameSpec,
	ConfirmDropSpec,
	RenameAmbiguity,
	RenameSpec,
	TableRenameSpec,
} from "./types";

export const consumedColumnNamesByTable = (
	validSpecs: ReadonlyArray<RenameSpec>,
	validDrops: ReadonlyArray<ConfirmDropSpec>,
): ReadonlyMap<
	string,
	{ readonly dropped: ReadonlySet<string>; readonly added: ReadonlySet<string> }
> => {
	const columnRenames = validSpecs.filter(
		(spec): spec is ColumnRenameSpec => spec.target === "column",
	);
	const entries = [
		...columnRenames.map((spec) => ({
			identity: tableIdentity(spec.schemaName, spec.tableName),
			dropped: spec.oldName,
			added: spec.newName,
		})),
		...validDrops
			.filter(
				(spec): spec is Extract<ConfirmDropSpec, { target: "column" }> =>
					spec.target === "column",
			)
			.map((spec) => ({
				identity: tableIdentity(spec.schemaName, spec.tableName),
				dropped: spec.columnName,
				added: null,
			})),
	];
	return entries.reduce((acc, entry) => {
		const existing = acc.get(entry.identity) ?? {
			dropped: new Set<string>(),
			added: new Set<string>(),
		};
		const dropped = new Set(existing.dropped);
		dropped.add(entry.dropped);
		const added = new Set(existing.added);
		if (entry.added !== null) {
			added.add(entry.added);
		}
		acc.set(entry.identity, { dropped, added });
		return acc;
	}, new Map<string, { dropped: Set<string>; added: Set<string> }>());
};

export const consumedTableNamesBySchema = (
	validSpecs: ReadonlyArray<RenameSpec>,
	validDrops: ReadonlyArray<ConfirmDropSpec>,
): ReadonlyMap<
	string,
	{ readonly dropped: ReadonlySet<string>; readonly added: ReadonlySet<string> }
> => {
	const tableRenames = validSpecs.filter(
		(spec): spec is TableRenameSpec => spec.target === "table",
	);
	const entries = [
		...tableRenames.map((spec) => ({
			schemaName: spec.schemaName,
			dropped: spec.oldName,
			added: spec.newName,
		})),
		...validDrops
			.filter(
				(spec): spec is Extract<ConfirmDropSpec, { target: "table" }> =>
					spec.target === "table",
			)
			.map((spec) => ({
				schemaName: spec.schemaName,
				dropped: spec.tableName,
				added: null,
			})),
	];
	return entries.reduce((acc, entry) => {
		const existing = acc.get(entry.schemaName) ?? {
			dropped: new Set<string>(),
			added: new Set<string>(),
		};
		const dropped = new Set(existing.dropped);
		dropped.add(entry.dropped);
		const added = new Set(existing.added);
		if (entry.added !== null) {
			added.add(entry.added);
		}
		acc.set(entry.schemaName, { dropped, added });
		return acc;
	}, new Map<string, { dropped: Set<string>; added: Set<string> }>());
};

/** `1 column was dropped ("x")` / `2 columns were dropped ("x", "y")` — the owner-approved count-based singular/plural convention. */
export const countedClause = (
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

/**
 * The exact-1:1 case uses the owner-approved verbatim text (naming the two
 * columns directly, with the concrete rerun commands inline); anything
 * else (2+ on either side) falls back to a generic count-based message —
 * the CLI's terminal renderer (Task 13) itemizes every dropped column's
 * `--rename`/`--confirm-drop` options separately.
 */
export const ambiguousColumnRenameMessage = (
	identity: string,
	dropped: ReadonlyArray<string>,
	added: ReadonlyArray<string>,
): string => {
	if (dropped.length === 1 && added.length === 1) {
		const oldName = dropped[0] ?? "";
		const newName = added[0] ?? "";
		return `table "${identity}" has an ambiguous column change: column "${oldName}" was dropped and column "${newName}" was added in the same generate run, and hejbro cannot tell whether this is a rename. Next: rerun with \`--rename ${identity}.${oldName}=${newName}\` (if this is a rename) or \`--confirm-drop ${identity}.${oldName}\` (if these are unrelated changes).`;
	}
	const droppedClause = countedClause("column", "dropped", dropped);
	const addedClause = countedClause("column", "added", added);
	return `table "${identity}" has an ambiguous column change: ${droppedClause} and ${addedClause} in the same generate run, and hejbro cannot infer which pairs (if any) are renames. Next: resolve each dropped column with --rename or --confirm-drop and rerun — see the flags to add below.`;
};

/**
 * The exact-1:1 case's own `Next:` clause (#703): `--rename` onto a
 * `newName` declared with `existingTable()` would itself be refused by
 * `unknown-rename-target` the moment this rerun tried it -- suggesting
 * it here would be the same "the prescribed remedy is the command that
 * just failed" shape D106 R5-B1 was filed against, one door over. Names
 * the two-run path instead of the doomed flag.
 */
const tableRenameNextClause = (
	schemaName: string,
	oldName: string,
	newName: string,
	newNameIsExisting: boolean,
): string => {
	if (newNameIsExisting) {
		return `Next: "${schemaName}.${newName}" is declared with existingTable(), so hejbro can't rename onto it -- if the table really is the same one changing hands, do it in two runs: first \`--rename ${schemaName}.${oldName}=${newName}\` while both sides are still table() declarations, then hand it over to existingTable() in a later run. If these are unrelated tables, rerun with \`--confirm-drop ${schemaName}.${oldName}\`.`;
	}
	return `Next: rerun with \`--rename ${schemaName}.${oldName}=${newName}\` (if this is a rename) or \`--confirm-drop ${schemaName}.${oldName}\` (if these are unrelated tables).`;
};

/** @see ambiguousColumnRenameMessage — the table/schema-level counterpart. `existingCreatedTables` (#703) is the sorted subset of `added` declared with `existingTable()`, used only by the exact-1:1 case's own concrete suggestion (see {@link tableRenameNextClause}) -- the multi-name case never names a specific flag inline, so it needs no such check. */
export const ambiguousTableRenameMessage = (
	schemaName: string,
	dropped: ReadonlyArray<string>,
	added: ReadonlyArray<string>,
	existingCreatedTables: ReadonlyArray<string>,
): string => {
	if (dropped.length === 1 && added.length === 1) {
		const oldName = dropped[0] ?? "";
		const newName = added[0] ?? "";
		const nextClause = tableRenameNextClause(
			schemaName,
			oldName,
			newName,
			existingCreatedTables.includes(newName),
		);
		return `schema "${schemaName}" has an ambiguous table change: table "${oldName}" was dropped and table "${newName}" was created in the same generate run — a table rename recreates every column, index, foreign key, RLS policy, and trigger attached to it, so hejbro refuses to guess. ${nextClause}`;
	}
	const droppedClause = countedClause("table", "dropped", dropped);
	const createdClause = countedClause("table", "created", added);
	return `schema "${schemaName}" has an ambiguous table change: ${droppedClause} and ${createdClause} in the same generate run — a table rename recreates every column, index, foreign key, RLS policy, and trigger attached to it, so hejbro refuses to guess. Next: resolve each dropped table with --rename or --confirm-drop and rerun — see the flags to add below.`;
};

export type AmbiguityResult = {
	readonly error: HejbroError;
	readonly ambiguity: RenameAmbiguity;
};

/** Splits a `schema.table` identity on its first `.` — safe since schema/table names never contain `.` (decision ⑧'s `^[a-z][a-z0-9_]*$`). */
export const splitTableIdentity = (
	identity: string,
): { readonly schemaName: string; readonly tableName: string } => {
	const dotIndex = identity.indexOf(".");
	if (dotIndex === -1) {
		return { schemaName: identity, tableName: "" };
	}
	return {
		schemaName: identity.slice(0, dotIndex),
		tableName: identity.slice(dotIndex + 1),
	};
};

export const residualColumnAmbiguities = (
	tableColumnSets: TableColumnSets,
	consumed: ReadonlyMap<
		string,
		{
			readonly dropped: ReadonlySet<string>;
			readonly added: ReadonlySet<string>;
		}
	>,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): ReadonlyArray<AmbiguityResult> =>
	Array.from(tableColumnSets.entries())
		.sort((a, b) => compareKeys(a[0], b[0]))
		.flatMap(([identity, sets]) => {
			const consumedSets = consumed.get(identity) ?? {
				dropped: new Set<string>(),
				added: new Set<string>(),
			};
			const residualDropped = setDifference(sets.dropped, consumedSets.dropped);
			const residualAdded = setDifference(sets.added, consumedSets.added);
			if (residualDropped.size === 0 || residualAdded.size === 0) {
				return [];
			}
			const declaredAt = declaredAtByIdentity.get(identity) ?? null;
			const droppedNames = Array.from(residualDropped).sort(compareKeys);
			const addedNames = Array.from(residualAdded).sort(compareKeys);
			const { schemaName, tableName } = splitTableIdentity(identity);
			return [
				{
					error: hejbroError(
						"ambiguous-column-rename",
						ambiguousColumnRenameMessage(identity, droppedNames, addedNames),
						declaredAt,
					),
					ambiguity: {
						kind: "column",
						schemaName,
						tableName,
						identity,
						dropped: droppedNames,
						added: addedNames,
						declaredAt,
					},
				},
			];
		});

export type ConsumedNameSets = {
	readonly dropped: ReadonlySet<string>;
	readonly added: ReadonlySet<string>;
};

/** `consumed`'s entry for `schemaName` — empty sets (nothing consumed yet) when this schema has none on record. */
export const consumedSetsFor = (
	consumed: ReadonlyMap<string, ConsumedNameSets>,
	schemaName: string,
): ConsumedNameSets =>
	consumed.get(schemaName) ?? { dropped: new Set(), added: new Set() };

/** The `declaredAt` on record for the first (sorted) residual added table name. */
export const declaredAtForFirstAdded = (
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
	schemaName: string,
	addedNames: ReadonlyArray<string>,
): string | null =>
	declaredAtByIdentity.get(tableIdentity(schemaName, addedNames[0] ?? "")) ??
	null;

/** The sorted subset of `addedNames` that `nextTables` marks existing (#703) — see {@link TableRenameAmbiguity.existingCreatedTables}. */
const existingNamesOf = (
	nextTables: ReadonlyMap<string, TableSnapshot>,
	schemaName: string,
	addedNames: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	addedNames.filter((name) => {
		const table = nextTables.get(tableIdentity(schemaName, name));
		return table !== undefined && tableExisting(table);
	});

/**
 * {@link residualTableAmbiguities}'s own diagnostics for one schema —
 * extracted to module scope (not a nested closure) the same way
 * {@link checksPatch} above was, so this shape's own branches don't fold
 * into the calling function's complexity. `nextTables` is the RAW
 * (un-`excludeExisting`d) map, the same one `computeSchemaTableSets`
 * itself reads (#703) -- the existing marker this needs was already
 * erased from `excludeExisting`'s own output before this point.
 */
export const residualTableAmbiguityFor = (
	schemaName: string,
	sets: NameSets,
	consumed: ReadonlyMap<string, ConsumedNameSets>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): ReadonlyArray<AmbiguityResult> => {
	const consumedSets = consumedSetsFor(consumed, schemaName);
	const residualDropped = setDifference(sets.dropped, consumedSets.dropped);
	const residualAdded = setDifference(sets.added, consumedSets.added);
	if (residualDropped.size === 0 || residualAdded.size === 0) {
		return [];
	}
	const droppedNames = Array.from(residualDropped).sort(compareKeys);
	const addedNames = Array.from(residualAdded).sort(compareKeys);
	const existingCreatedTables = existingNamesOf(
		nextTables,
		schemaName,
		addedNames,
	);
	const declaredAt = declaredAtForFirstAdded(
		declaredAtByIdentity,
		schemaName,
		addedNames,
	);
	return [
		{
			error: hejbroError(
				"ambiguous-table-rename",
				ambiguousTableRenameMessage(
					schemaName,
					droppedNames,
					addedNames,
					existingCreatedTables,
				),
				declaredAt,
			),
			ambiguity: {
				kind: "table",
				schemaName,
				droppedTables: droppedNames,
				createdTables: addedNames,
				existingCreatedTables,
				declaredAt,
			},
		},
	];
};

export const residualTableAmbiguities = (
	schemaTableSets: SchemaTableSets,
	consumed: ReadonlyMap<string, ConsumedNameSets>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): ReadonlyArray<AmbiguityResult> =>
	Array.from(schemaTableSets.entries())
		.sort((a, b) => compareKeys(a[0], b[0]))
		.flatMap(([schemaName, sets]) =>
			residualTableAmbiguityFor(
				schemaName,
				sets,
				consumed,
				nextTables,
				declaredAtByIdentity,
			),
		);
