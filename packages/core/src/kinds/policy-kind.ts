import type { PolicyCommand, PolicyDeclaration } from "../dsl/rls";
import { assertNever, throwHejbroError } from "../error";
import type { ExprNode, TableRefNode } from "../expr/ast";
import { decodeExprNode, encodeExprNode } from "../expr/codec";
import { renderExpr } from "../expr/render-sql";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import {
	qualifyName,
	quoteIdentifier,
	renderRoleName,
} from "../sql/identifier";
import { predropStatement, statement } from "../sql/statement";

/**
 * A policy's serialized snapshot node. **Compact** (Task 3 audit / D33):
 * `permissive` is present only when `false` (declared default `true` — a
 * restrictive policy); `using`/`withCheck` are present only when set
 * (default `null`, meaning the command doesn't take that clause) — read
 * via {@link policyPermissive}/{@link policyUsing}/{@link policyWithCheck}.
 *
 * `using`/`withCheck` are **structured expression nodes** (D67/D70),
 * encoded by the expression codec (`expr/codec.ts`) — not pre-rendered
 * SQL text (that was D16's original shape; D67 amended it so a rename
 * can retarget the identifiers inside them exactly). The accessors decode
 * and render back to SQL text on demand, using this policy's own
 * `schema`/`table` as the `renderExpr` outer scope (an `exists()`
 * subquery's correlation needs it) — so every caller is unaffected by
 * this shape change.
 */
export type PolicySnapshot = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly permissive?: false;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly using?: JsonValue;
	readonly withCheck?: JsonValue;
};

/** `snapshot.permissive`, defaulting to `true` when absent (compact snapshot). */
export const policyPermissive = (snapshot: PolicySnapshot): boolean =>
	snapshot.permissive !== false;

const outerScopeOf = (
	snapshot: PolicySnapshot,
): ReadonlyArray<TableRefNode> => [
	{ schemaName: snapshot.schema, tableName: snapshot.table },
];

/** `snapshot.using` decoded and rendered back to SQL text, defaulting to `null` when absent (compact snapshot). */
export const policyUsing = (snapshot: PolicySnapshot): string | null => {
	if (snapshot.using === undefined || snapshot.using === null) {
		return null;
	}
	return renderExpr(decodeExprNode(snapshot.using), outerScopeOf(snapshot));
};

/** `snapshot.withCheck` decoded and rendered back to SQL text, defaulting to `null` when absent (compact snapshot). */
export const policyWithCheck = (snapshot: PolicySnapshot): string | null => {
	if (snapshot.withCheck === undefined || snapshot.withCheck === null) {
		return null;
	}
	return renderExpr(decodeExprNode(snapshot.withCheck), outerScopeOf(snapshot));
};

// Internal invariant: this shape is exactly what policyKind.serialize below produces.
const asPolicySnapshot = (snapshot: JsonValue): PolicySnapshot =>
	snapshot as PolicySnapshot;

const policyIdentity = (schema: string, table: string, name: string): string =>
	`${schema}.${table}.${name}`;

const POLICY_CHANGED_NOTE = "policy changed; recreating";

/**
 * Encodes a `using`/`withCheck` clause into its snapshot form (D67/D70).
 * Used to also call `renderExpr` here first, purely for its validating
 * side effect — a correlated `exists()` subquery referencing a column
 * outside scope threw `foreign-column-ref` from inside `renderSelect`'s
 * own scope check, and `assertOwnColumnsOnly` (`dsl/rls.ts`) used to only
 * catch a *direct* out-of-table ref (it never descended into `exists()`),
 * so this was the only place that caught a bad ref buried inside a
 * correlated subquery. `assertOwnColumnsOnly` now descends into
 * `exists()` too (`findExprScopeViolation`, #160) and runs at declaration
 * time, before a `PolicyDeclaration` — let alone this snapshot node —
 * exists at all, so this encode-time re-check was pure duplication: no
 * `PolicyInput` can reach this function without already having passed
 * the declaration-time check, and nothing between declaration and here
 * (a rename's own retargeting, `engine/rename-plan.ts`) can turn an
 * already-in-scope reference into an out-of-scope one, only rename what
 * it already legally pointed at.
 */
const encodeClauseExpr = (expr: ExprNode | null): JsonValue | null => {
	if (expr === null) {
		return null;
	}
	return encodeExprNode(expr);
};

const dropPolicyGuardClause = (ifExists: boolean): string => {
	if (ifExists) {
		return "if exists ";
	}
	return "";
};

/**
 * `ifExists` true for a first-time create's idempotent guard text
 * (nothing can already depend on a policy that doesn't exist yet),
 * `false` for a real alter/drop's own drop half (D75) — so an out-of-
 * band removal of a policy hejbro still declares fails loudly at the
 * next change instead of `if exists` silently re-creating it.
 */
const dropPolicySql = (snapshot: PolicySnapshot, ifExists: boolean): string =>
	`drop policy ${dropPolicyGuardClause(ifExists)}${quoteIdentifier(snapshot.name)} on ${qualifyName(snapshot.schema, snapshot.table)};`;

const kindClause = (permissive: boolean): string => {
	if (permissive) {
		return "";
	}
	return " as restrictive";
};

const usingClause = (using: string | null): string => {
	if (using === null) {
		return "";
	}
	return ` using (${using})`;
};

const withCheckClause = (withCheck: string | null): string => {
	if (withCheck === null) {
		return "";
	}
	return ` with check (${withCheck})`;
};

const createPolicySql = (snapshot: PolicySnapshot): string => {
	const tableRef = qualifyName(snapshot.schema, snapshot.table);
	const rolesSql = snapshot.roles.map(renderRoleName).join(", ");
	return `create policy ${quoteIdentifier(snapshot.name)} on ${tableRef}${kindClause(policyPermissive(snapshot))} for ${snapshot.command} to ${rolesSql}${usingClause(policyUsing(snapshot))}${withCheckClause(policyWithCheck(snapshot))};`;
};

/** `{ permissive: false }` when restrictive, else `{}` (compact snapshot — default `true`). */
const permissiveField = (
	value: boolean,
): Pick<PolicySnapshot, "permissive"> => {
	if (value) {
		return {};
	}
	return { permissive: false };
};

/** `{ using: <node> }` when set, else `{}` (compact snapshot). */
const usingField = (value: JsonValue | null): Pick<PolicySnapshot, "using"> => {
	if (value === null) {
		return {};
	}
	return { using: value };
};

/** `{ withCheck: <node> }` when set, else `{}` (compact snapshot). */
const withCheckField = (
	value: JsonValue | null,
): Pick<PolicySnapshot, "withCheck"> => {
	if (value === null) {
		return {};
	}
	return { withCheck: value };
};

/**
 * The built-in object kind for Postgres row-level-security policies.
 * Identity is `"<schema>.<table>.<name>"`. Postgres has no `alter policy`
 * for clause/role/command changes, so `diff` treats any field difference
 * as a single `alter` change (**not** a separate drop + create pair — see
 * `trigger-kind.ts`'s equivalent note and #55) whose `emit` returns a
 * drop and a `create policy` statement in that order (idempotent
 * recreate on create only, spec §6.5). Only a true first-time create's
 * drop half uses `if exists` (idempotent guard text — nothing can
 * already depend on a policy that doesn't exist yet, so it stays in
 * `main` alongside its own `create policy`); `alter`/`drop` emit a bare
 * `drop policy` (D75) so an out-of-band removal of a policy hejbro still
 * declares fails loudly at the next change instead of `if exists`
 * silently re-creating it. The `alter`'s and a true `drop`'s drop halves
 * go out on the `predrop` stage — a policy's `using`/`withCheck`
 * expression can reference a column that a `main`-stage alter on that
 * same table is about to drop (#122), so the policy must be gone before
 * that alter runs.
 */
export const policyKind: ObjectKind<PolicyDeclaration> = {
	kind: "policy",
	dependsOn: ["rls", "table"],
	requiredKeys: ["schema", "table", "name", "command", "roles"],
	owns: (declaration): declaration is PolicyDeclaration =>
		declaration.declarationKind === "policy",
	serialize: (declaration) => {
		const snapshot: PolicySnapshot = {
			schema: declaration.schemaName,
			table: declaration.tableName,
			name: declaration.policyName,
			command: declaration.command,
			roles: declaration.roles,
			...permissiveField(declaration.permissive),
			...usingField(encodeClauseExpr(declaration.using)),
			...withCheckField(encodeClauseExpr(declaration.withCheck)),
		};
		return snapshot;
	},
	identify: (snapshot) => {
		const policySnapshot = asPolicySnapshot(snapshot);
		return policyIdentity(
			policySnapshot.schema,
			policySnapshot.table,
			policySnapshot.name,
		);
	},
	diff: (previous, next, identity) => {
		const guard = createOrDropDiff("policy", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}
		if (sameJson(guard.previous, guard.next)) {
			return [];
		}
		return [
			{
				kind: "policy",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: [POLICY_CHANGED_NOTE],
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"policy create change is missing its next snapshot.",
					);
				}
				// Idempotent guard text, not a real drop (#122/A′) — see the
				// doc comment above.
				const nextSnapshot = asPolicySnapshot(change.next);
				return [
					statement(dropPolicySql(nextSnapshot, true)),
					statement(createPolicySql(nextSnapshot)),
				];
			}
			case "alter": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"policy alter change is missing its next snapshot.",
					);
				}
				const nextSnapshot = asPolicySnapshot(change.next);
				return [
					predropStatement(dropPolicySql(nextSnapshot, false)),
					statement(createPolicySql(nextSnapshot)),
				];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"policy drop change is missing its previous snapshot.",
					);
				}
				return [
					predropStatement(
						dropPolicySql(asPolicySnapshot(change.previous), false),
					),
				];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
