import type { Snapshot, TableSnapshot } from "@hejbro/core";

/**
 * An enum object node's own shape (`core/src/kinds/enum-kind.ts`'s
 * `EnumSnapshot`) — restated here rather than imported, since core
 * exports only `enumKind` itself, not this internal shape (the same
 * constraint the proposal names for the table snapshot: "parsing a
 * snapshot node's object keys stays out of the pure core, which is why
 * the reader restates an internal shape rather than importing it").
 */
export type ContractEnumFact = {
	readonly schema: string;
	readonly name: string;
	readonly values: ReadonlyArray<string>;
};

const KIND_PREFIX = {
	table: "table:",
	enum: "enum:",
} as const;

/**
 * Every `"table:…"` entry in `snapshot.objects`, cast to `TableSnapshot`
 * — `core` exports the type but not a reader over `objects`' own
 * `"kind:identity"` keying convention (that convention itself is
 * core-internal), so this restates the one-line cast `table-snapshot.ts`'s
 * own (unexported) `asTableSnapshot` makes.
 */
export const tablesInSnapshot = (
	snapshot: Snapshot,
): ReadonlyArray<TableSnapshot> =>
	Object.entries(snapshot.objects)
		.filter(([key]) => key.startsWith(KIND_PREFIX.table))
		.map(([, node]) => node as TableSnapshot);

/** Every `"enum:…"` entry in `snapshot.objects`, cast to {@link ContractEnumFact}. */
export const enumsInSnapshot = (
	snapshot: Snapshot,
): ReadonlyArray<ContractEnumFact> =>
	Object.entries(snapshot.objects)
		.filter(([key]) => key.startsWith(KIND_PREFIX.enum))
		.map(([, node]) => node as ContractEnumFact);

/** Whether `snapshot.objects` carries a table whose identity is `identity` (schema-qualified, `tableIdentity`'s own shape) — used to tell a managed foreign-key target from an unmanaged one (5.9). */
export const snapshotHasTable = (
	snapshot: Snapshot,
	identity: string,
): boolean => `${KIND_PREFIX.table}${identity}` in snapshot.objects;
