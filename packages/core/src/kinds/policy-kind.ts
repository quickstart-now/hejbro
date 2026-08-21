import type { PolicyCommand, PolicyDeclaration } from "../dsl/rls";
import { assertNever, throwHejbroError } from "../error";
import type { ExprNode, TableRefNode } from "../expr/ast";
import { renderExpr } from "../expr/render-sql";
import { sameJson } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import {
	qualifyName,
	quoteIdentifier,
	renderRoleName,
} from "../sql/identifier";
import { predropStatement, statement } from "../sql/statement";

/**
 * A policy's fully-rendered snapshot node — expressions are pre-rendered
 * SQL text (D16 precedent, same as a column's default). **Compact** (Task
 * 3 audit / D33): `permissive` is present only when `false` (declared
 * default `true` — a restrictive policy); `using`/`withCheck` are present
 * only when set (default `null`, meaning the command doesn't take that
 * clause) — read via {@link policyPermissive}/{@link policyUsing}/
 * {@link policyWithCheck}.
 */
export type PolicySnapshot = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly permissive?: false;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly using?: string;
	readonly withCheck?: string;
};

/** `snapshot.permissive`, defaulting to `true` when absent (compact snapshot). */
export const policyPermissive = (snapshot: PolicySnapshot): boolean =>
	snapshot.permissive !== false;

/** `snapshot.using`, defaulting to `null` when absent (compact snapshot). */
export const policyUsing = (snapshot: PolicySnapshot): string | null =>
	snapshot.using ?? null;

/** `snapshot.withCheck`, defaulting to `null` when absent (compact snapshot). */
export const policyWithCheck = (snapshot: PolicySnapshot): string | null =>
	snapshot.withCheck ?? null;

// Internal invariant: this shape is exactly what policyKind.serialize below produces.
const asPolicySnapshot = (snapshot: JsonValue): PolicySnapshot =>
	snapshot as PolicySnapshot;

const policyIdentity = (schema: string, table: string, name: string): string =>
	`${schema}.${table}.${name}`;

const POLICY_CHANGED_NOTE = "policy changed; recreating";

const renderClauseExpr = (
	expr: ExprNode | null,
	outerScope: ReadonlyArray<TableRefNode>,
): string | null => {
	if (expr === null) {
		return null;
	}
	return renderExpr(expr, outerScope);
};

const dropPolicySql = (snapshot: PolicySnapshot): string =>
	`drop policy if exists ${quoteIdentifier(snapshot.name)} on ${qualifyName(snapshot.schema, snapshot.table)};`;

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

/** `{ using: <sql> }` when set, else `{}` (compact snapshot). */
const usingField = (value: string | null): Pick<PolicySnapshot, "using"> => {
	if (value === null) {
		return {};
	}
	return { using: value };
};

/** `{ withCheck: <sql> }` when set, else `{}` (compact snapshot). */
const withCheckField = (
	value: string | null,
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
 * `trigger-kind.ts`'s equivalent note and #55) whose `emit` returns the
 * `drop policy if exists` and `create policy` statements in that order
 * (idempotent recreate, spec §6.5), including on a true first-time create.
 * The `alter`'s and a true `drop`'s drop halves go out on the `predrop`
 * stage — a policy's `using`/`withCheck` expression can reference a column
 * that a `main`-stage alter on that same table is about to drop (#122), so
 * the policy must be gone before that alter runs. A true first-time
 * create's `drop policy if exists` is just idempotent guard text (nothing
 * can depend on a policy that doesn't exist yet), so it stays in `main`
 * alongside its own `create policy`.
 */
export const policyKind: ObjectKind<PolicyDeclaration> = {
	kind: "policy",
	dependsOn: ["rls", "table"],
	owns: (declaration): declaration is PolicyDeclaration =>
		declaration.declarationKind === "policy",
	serialize: (declaration) => {
		const outerScope: ReadonlyArray<TableRefNode> = [
			{ schemaName: declaration.schemaName, tableName: declaration.tableName },
		];
		const snapshot: PolicySnapshot = {
			schema: declaration.schemaName,
			table: declaration.tableName,
			name: declaration.policyName,
			command: declaration.command,
			roles: declaration.roles,
			...permissiveField(declaration.permissive),
			...usingField(renderClauseExpr(declaration.using, outerScope)),
			...withCheckField(renderClauseExpr(declaration.withCheck, outerScope)),
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
		if (previous === null && next !== null) {
			return [
				{
					kind: "policy",
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
					kind: "policy",
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
		return [
			{
				kind: "policy",
				operation: "alter",
				identity,
				previous,
				next,
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
					statement(dropPolicySql(nextSnapshot)),
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
					predropStatement(dropPolicySql(nextSnapshot)),
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
					predropStatement(dropPolicySql(asPolicySnapshot(change.previous))),
				];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
