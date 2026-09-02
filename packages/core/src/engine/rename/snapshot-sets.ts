import type { TableSnapshot } from "../../kinds/table-snapshot";
import {
	asTableSnapshot,
	tableExisting,
	tableIdentity,
} from "../../kinds/table-snapshot";
import type { Snapshot } from "../../snapshot/snapshot";
import type { JsonValue } from "../../snapshot/stable-json";
import type { RenameSpec, TableRenameSpec } from "./types";

export const TABLE_PREFIX = "table:";
export const RLS_PREFIX = "rls:";
export const POLICY_PREFIX = "policy:";
export const TRIGGER_PREFIX = "trigger:";
export const VIEW_PREFIX = "view:";
export const SEQUENCE_PREFIX = "sequence:";

export type ObjectsRecord = Snapshot["objects"];

export const entriesWithPrefix = (
	objects: ObjectsRecord,
	prefix: string,
): ReadonlyArray<readonly [string, JsonValue]> =>
	Object.entries(objects).filter(([key]) => key.startsWith(prefix));

export const tableEntries = (
	objects: ObjectsRecord,
): ReadonlyMap<string, TableSnapshot> =>
	new Map(
		entriesWithPrefix(objects, TABLE_PREFIX).map(([key, node]) => [
			key.slice(TABLE_PREFIX.length),
			asTableSnapshot(node),
		]),
	);

/** Whether `identity` is marked existing on either side of the run — present and `existing: true` in `previousTables`, or present and `existing: true` in `nextTables`. A table whose identity appears on only one side reads as not-existing on the side it's absent from, which is exactly right: a genuinely dropped or created *managed* table's own identity is absent from one side too, and this check must not treat that absence as an existing marker. */
const isExistingOnEitherSide = (
	previousTables: ReadonlyMap<string, TableSnapshot>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
	identity: string,
): boolean => {
	const previousTable = previousTables.get(identity);
	const nextTable = nextTables.get(identity);
	return (
		(previousTable !== undefined && tableExisting(previousTable)) ||
		(nextTable !== undefined && tableExisting(nextTable))
	);
};

/**
 * `previousTables`/`nextTables`, each with every identity marked
 * existing on *either* side removed from *both* (D106 R3, R3-B2 — the
 * fix R2-B1 claimed but did not implement: excluding each map on its
 * own left a table managed in `previous` and existing in `next` — a
 * handover — still present in `previousTables` alone, which reads as a
 * genuine drop, and the mirror case (an adoption) as a genuine create).
 * Computed over the *union* of identities first, not two independent
 * per-map filters, precisely so a handover's or an adoption's identity
 * disappears from the side it would otherwise still occupy. Rename
 * planning is a managed-table concern only — hejbro neither drops nor
 * creates an existing table (`table-kind.ts`'s own bidirectional
 * guard), so one is never a rename candidate and never a rename
 * ambiguity source, on either side of a run. Applied where
 * `previousTables`/`nextTables` are built (`rename-plan.ts`), so both
 * `computeSchemaTableSets` and `computeTableColumnSets` — and, through
 * them, every ambiguity/pairing computation downstream — never see one.
 */
export const excludeExisting = (
	previousTables: ReadonlyMap<string, TableSnapshot>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
): {
	readonly previousTables: ReadonlyMap<string, TableSnapshot>;
	readonly nextTables: ReadonlyMap<string, TableSnapshot>;
} => {
	const identities = new Set([...previousTables.keys(), ...nextTables.keys()]);
	const existingIdentities = new Set(
		Array.from(identities).filter((identity) =>
			isExistingOnEitherSide(previousTables, nextTables, identity),
		),
	);
	const withoutExisting = (
		tables: ReadonlyMap<string, TableSnapshot>,
	): ReadonlyMap<string, TableSnapshot> =>
		new Map(
			Array.from(tables).filter(
				([identity]) => !existingIdentities.has(identity),
			),
		);
	return {
		previousTables: withoutExisting(previousTables),
		nextTables: withoutExisting(nextTables),
	};
};

export type NameSets = {
	readonly dropped: ReadonlySet<string>;
	readonly added: ReadonlySet<string>;
};

/** Per-schema dropped/added table-name sets (raw — before any rename/confirm-drop resolution). */
export type SchemaTableSets = ReadonlyMap<string, NameSets>;

/** Per-table (identity `schema.table`, present in both snapshots) dropped/added column-name sets. */
export type TableColumnSets = ReadonlyMap<string, NameSets>;

/** Every value of `source` not present in `remove`. */
export const setDifference = (
	source: ReadonlySet<string>,
	remove: ReadonlySet<string>,
): ReadonlySet<string> =>
	new Set(Array.from(source).filter((value) => !remove.has(value)));

export const computeSchemaTableSets = (
	previousTables: ReadonlyMap<string, TableSnapshot>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
): SchemaTableSets => {
	const schemaNames = new Set([
		...Array.from(previousTables.values(), (t) => t.schema),
		...Array.from(nextTables.values(), (t) => t.schema),
	]);
	return new Map(
		Array.from(schemaNames).map((schemaName) => {
			const previousNames = new Set(
				Array.from(previousTables.values())
					.filter((t) => t.schema === schemaName)
					.map((t) => t.name),
			);
			const nextNames = new Set(
				Array.from(nextTables.values())
					.filter((t) => t.schema === schemaName)
					.map((t) => t.name),
			);
			return [
				schemaName,
				{
					dropped: setDifference(previousNames, nextNames),
					added: setDifference(nextNames, previousNames),
				},
			] as const;
		}),
	);
};

/**
 * Every valid table-rename candidate (schema-level dropped/added check
 * only — duplicates aren't resolved yet), `oldIdentity → newIdentity`. Used
 * only to *pair* tables for column-set computation below; applying the
 * rename still goes through the full `partitionRenameSpecs` validation.
 */
export const tableRenamePairings = (
	renames: ReadonlyArray<RenameSpec>,
	schemaTableSets: SchemaTableSets,
): ReadonlyMap<string, string> => {
	const candidates = renames.filter(
		(spec): spec is TableRenameSpec => spec.target === "table",
	);
	const valid = candidates.filter((spec) => {
		const sets = schemaTableSets.get(spec.schemaName);
		return (
			(sets?.dropped.has(spec.oldName) ?? false) &&
			(sets?.added.has(spec.newName) ?? false)
		);
	});
	return new Map(
		valid.map((spec) => [
			tableIdentity(spec.schemaName, spec.oldName),
			tableIdentity(spec.schemaName, spec.newName),
		]),
	);
};

/**
 * Per-table dropped/added column-name sets, keyed by the table's *previous*
 * identity — for tables unchanged by name (same identity in both
 * snapshots) and for tables paired by a valid `--rename` table spec (M1
 * fix: without this pairing, a table-rename+column-change combo would miss
 * rule A's ambiguity check entirely, and any accompanying column spec would
 * be rejected as `unknown-rename-target` since its table never appeared to
 * have changed columns).
 */
export const computeTableColumnSets = (
	previousTables: ReadonlyMap<string, TableSnapshot>,
	nextTables: ReadonlyMap<string, TableSnapshot>,
	renamedPairings: ReadonlyMap<string, string>,
): TableColumnSets => {
	const columnSetEntry = (
		oldIdentity: string,
		nextIdentity: string,
	): readonly [string, NameSets] | null => {
		const previousTable = previousTables.get(oldIdentity);
		const nextTable = nextTables.get(nextIdentity);
		if (previousTable === undefined || nextTable === undefined) {
			return null;
		}
		const previousNames = new Set(previousTable.columns.map((c) => c.name));
		const nextNames = new Set(nextTable.columns.map((c) => c.name));
		return [
			oldIdentity,
			{
				dropped: setDifference(previousNames, nextNames),
				added: setDifference(nextNames, previousNames),
			},
		];
	};

	const unchangedEntries = Array.from(previousTables.keys())
		.filter((identity) => nextTables.has(identity))
		.map((identity) => columnSetEntry(identity, identity));
	const renamedEntries = Array.from(renamedPairings.entries()).map(
		([oldIdentity, newIdentity]) => columnSetEntry(oldIdentity, newIdentity),
	);

	return new Map(
		[...unchangedEntries, ...renamedEntries].filter(
			(entry): entry is readonly [string, NameSets] => entry !== null,
		),
	);
};

// --- Step 2: validation -----------------------------------------------
