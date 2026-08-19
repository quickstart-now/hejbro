import type { RlsDeclaration } from "../dsl/rls";
import { assertNever, throwHejbroError } from "../error";
import { sameJson } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import { qualifyName } from "../sql/identifier";
import { statement } from "../sql/statement";

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

/**
 * The built-in object kind for a table's row-level-security enable/force
 * state. Identity is `"<schema>.<table>"`. Policies are separate `policy`
 * declarations (D25) — this kind only tracks whether RLS is enabled and
 * whether it's forced on table owners.
 */
export const rlsKind: ObjectKind<RlsDeclaration> = {
	kind: "rls",
	dependsOn: ["table"],
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
		if (previous === null && next !== null) {
			return [
				{
					kind: "rls",
					operation: "create",
					identity,
					previous: null,
					next,
					notes: [],
				},
			];
		}
		if (previous !== null && next === null) {
			return [
				{
					kind: "rls",
					operation: "drop",
					identity,
					previous,
					next: null,
					notes: [],
				},
			];
		}
		if (previous === null || next === null) {
			return [];
		}
		if (sameJson(previous, next)) {
			return [];
		}
		const nextSnapshot = asRlsSnapshot(next);
		return [
			{
				kind: "rls",
				operation: "alter",
				identity,
				previous,
				next,
				notes: [forceNote(rlsForce(nextSnapshot))],
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"rls create change is missing its next snapshot.",
					);
				}
				const nextSnapshot = asRlsSnapshot(change.next);
				if (rlsForce(nextSnapshot)) {
					return [
						statement(enableStatementSql(nextSnapshot)),
						statement(forceStatementSql(nextSnapshot)),
					];
				}
				return [statement(enableStatementSql(nextSnapshot))];
			}
			case "alter": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"rls alter change is missing its next snapshot.",
					);
				}
				return [statement(forceStatementSql(asRlsSnapshot(change.next)))];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"rls drop change is missing its previous snapshot.",
					);
				}
				return [statement(disableStatementSql(asRlsSnapshot(change.previous)))];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
