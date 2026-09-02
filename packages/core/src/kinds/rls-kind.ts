import type { RlsDeclaration } from "../dsl/rls";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import { requireNext, requirePrevious } from "../kind/emit-helpers";
import type {
	ChangeOperation,
	KindChange,
	ObjectKind,
} from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import { qualifyName } from "../sql/identifier";
import type { SqlStatement } from "../sql/statement";
import { statement } from "../sql/statement";
import { tableIdentity } from "./table-snapshot";

/**
 * A table's row-level-security enable/force state — policies are separate
 * `policy` declarations, not serialized here (D25). **Compact** (Task 3
 * audit / D33): `force` is present only when `true` (declared default
 * `false`) — read via {@link rlsForce}.
 */
export type RlsSnapshot = {
	readonly schema: string;
	readonly table: string;
	readonly force?: true;
};

/** `snapshot.force`, defaulting to `false` when absent (compact snapshot). */
export const rlsForce = (snapshot: RlsSnapshot): boolean =>
	snapshot.force === true;

/** `{ force: true }` when forced, else `{}` (compact snapshot). */
const forceField = (value: boolean): Pick<RlsSnapshot, "force"> => {
	if (!value) {
		return {};
	}
	return { force: true };
};

// Internal invariant: this shape is exactly what rlsKind.serialize below produces.
const asRlsSnapshot = (snapshot: JsonValue): RlsSnapshot =>
	snapshot as RlsSnapshot;

const rlsIdentity = (schema: string, table: string): string =>
	`${schema}.${table}`;

const forceNote = (force: boolean): string => {
	if (force) {
		return "force row level security";
	}
	return "no force row level security";
};

const forceStatementSql = (snapshot: RlsSnapshot): string => {
	const tableRef = qualifyName(snapshot.schema, snapshot.table);
	if (rlsForce(snapshot)) {
		return `alter table ${tableRef} force row level security;`;
	}
	return `alter table ${tableRef} no force row level security;`;
};

const enableStatementSql = (snapshot: RlsSnapshot): string =>
	`alter table ${qualifyName(snapshot.schema, snapshot.table)} enable row level security;`;

const disableStatementSql = (snapshot: RlsSnapshot): string =>
	`alter table ${qualifyName(snapshot.schema, snapshot.table)} disable row level security;`;

/** {@link rlsKind}'s `emit`, `"create"` case: enable RLS, and force it too when the declaration asks for that. */
const emitCreate = (change: KindChange): ReadonlyArray<SqlStatement> => {
	const nextSnapshot = asRlsSnapshot(requireNext(change));
	if (rlsForce(nextSnapshot)) {
		return [
			statement(enableStatementSql(nextSnapshot)),
			statement(forceStatementSql(nextSnapshot)),
		];
	}
	return [statement(enableStatementSql(nextSnapshot))];
};

/** {@link rlsKind}'s `emit`, `"alter"` case: only `force` can change once RLS is already enabled. */
const emitAlter = (change: KindChange): ReadonlyArray<SqlStatement> => [
	statement(forceStatementSql(asRlsSnapshot(requireNext(change)))),
];

/** {@link rlsKind}'s `emit`, `"drop"` case: disable RLS. */
const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => [
	statement(disableStatementSql(asRlsSnapshot(requirePrevious(change)))),
];

/**
 * One handler per {@link ChangeOperation}, same technique used across this
 * phase's other `emit` splits (e.g. `@hejbro/supabase`'s `bucket-kind.ts`,
 * #241): a mapped type over the closed operation union, so a missing
 * entry is a compile error instead of a `switch`'s `default:
 * assertNever(...)` at runtime.
 */
type EmitHandlers = {
	readonly [K in ChangeOperation]: (
		change: KindChange,
	) => ReadonlyArray<SqlStatement>;
};

const emitHandlers: EmitHandlers = {
	create: emitCreate,
	alter: emitAlter,
	drop: emitDrop,
};

/**
 * The built-in object kind for a table's row-level-security enable/force
 * state. Identity is `"<schema>.<table>"`. Policies are separate `policy`
 * declarations (D25) — this kind only tracks whether RLS is enabled and
 * whether it's forced on table owners.
 */
export const rlsKind: ObjectKind<RlsDeclaration> = {
	kind: "rls",
	dependsOn: ["table"],
	requiredKeys: ["schema", "table"],
	owns: (declaration): declaration is RlsDeclaration =>
		declaration.declarationKind === "rls",
	serialize: (declaration) => {
		const snapshot: RlsSnapshot = {
			schema: declaration.schemaName,
			table: declaration.tableName,
			...forceField(declaration.force),
		};
		return snapshot;
	},
	identify: (snapshot) => {
		const rlsSnapshot = asRlsSnapshot(snapshot);
		return rlsIdentity(rlsSnapshot.schema, rlsSnapshot.table);
	},
	diff: (previous, next, identity) => {
		const guard = createOrDropDiff("rls", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}
		if (sameJson(guard.previous, guard.next)) {
			return [];
		}
		const nextSnapshot = asRlsSnapshot(guard.next);
		return [
			{
				kind: "rls",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: [forceNote(rlsForce(nextSnapshot))],
			},
		];
	},
	emit: (change) => emitHandlers[change.operation](change),
	ownerTableIdentity: (node) => {
		const snapshot = asRlsSnapshot(node);
		return tableIdentity(snapshot.schema, snapshot.table);
	},
};
