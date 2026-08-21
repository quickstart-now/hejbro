import type { PolicyCommand, PolicyDeclaration } from "../dsl/rls";
import { assertNever, throwHejbroError } from "../error";
import type { ExprNode, TableRefNode } from "../expr/ast";
import { decodeExprNode, encodeExprNode } from "../expr/codec";
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
 * Still calls `renderExpr` first, at declaration time, purely for its
 * validating side effect — a correlated `exists()` subquery referencing a
 * column outside `[query's own from/joins, ...outerScope]` throws
 * `foreign-column-ref` from inside `renderSelect`'s scope check, and
 * `assertOwnColumnsOnly` (dsl/rls.ts) only catches a *direct* out-of-table
 * ref (it doesn't descend into `exists()`), so this is the only place
 * that catches a bad ref buried inside a correlated subquery. Rendering
 * to text and discarding it looks wasteful, but calling `encodeExprNode`
 * alone would silently skip this validation until whenever `emit` next
 * decodes and renders the node — which, for a policy that never changes
 * again, could be never.
 */
const encodeClauseExpr = (
	expr: ExprNode | null,
	outerScope: ReadonlyArray<TableRefNode>,
): JsonValue | null => {
	if (expr === null) {
		return null;
	}
	renderExpr(expr, outerScope);
	return encodeExprNode(expr);
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
			...usingField(encodeClauseExpr(declaration.using, outerScope)),
			...withCheckField(encodeClauseExpr(declaration.withCheck, outerScope)),
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
