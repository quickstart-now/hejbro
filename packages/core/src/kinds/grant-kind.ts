import type { GrantDeclaration, GrantKind, TablePrivilege } from "../dsl/grant";
import { tablePrivileges } from "../dsl/grant";
import { assertNever, throwHejbroError } from "../error";
import { sameJson } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import { quoteIdentifier, renderRoleName } from "../sql/identifier";
import type { SqlStatement } from "../sql/statement";
import { statement } from "../sql/statement";

/** A grant's serialized snapshot node. `privileges` is always `[]` for `schema-usage`. */
export type GrantSnapshot = {
	readonly schema: string;
	readonly grantKind: GrantKind;
	readonly role: string;
	readonly privileges: ReadonlyArray<TablePrivilege>;
};

// Internal invariant: this shape is exactly what grantKind.serialize below produces.
const asGrantSnapshot = (snapshot: JsonValue): GrantSnapshot =>
	snapshot as GrantSnapshot;

const grantIdentity = (
	schema: string,
	grantKind: GrantKind,
	role: string,
): string => `${schema}.${grantKind}.${role}`;

const privilegeList = (privileges: ReadonlyArray<TablePrivilege>): string =>
	privileges.join(", ");

/** The privilege-set delta between two snapshots, in canonical order, `+`/`-` prefixed — display-only banner text (never read back by `emit`). */
const privilegeDelta = (
	previous: ReadonlyArray<TablePrivilege>,
	next: ReadonlyArray<TablePrivilege>,
): ReadonlyArray<string> =>
	tablePrivileges.flatMap((privilege) => {
		const wasPresent = previous.includes(privilege);
		const isPresent = next.includes(privilege);
		if (wasPresent === isPresent) {
			return [];
		}
		if (isPresent) {
			return [`+${privilege}`];
		}
		return [`-${privilege}`];
	});

const addedPrivileges = (
	previous: ReadonlyArray<TablePrivilege>,
	next: ReadonlyArray<TablePrivilege>,
): ReadonlyArray<TablePrivilege> =>
	tablePrivileges.filter(
		(privilege) => next.includes(privilege) && !previous.includes(privilege),
	);

const removedPrivileges = (
	previous: ReadonlyArray<TablePrivilege>,
	next: ReadonlyArray<TablePrivilege>,
): ReadonlyArray<TablePrivilege> =>
	tablePrivileges.filter(
		(privilege) => previous.includes(privilege) && !next.includes(privilege),
	);

/** Renders a `grant`/`alter default privileges ... grant` statement for `grantKind`. `privileges` is ignored for `schema-usage` (always `usage`). */
const renderGrantStatement = (
	grantKind: GrantKind,
	schema: string,
	role: string,
	privileges: ReadonlyArray<TablePrivilege>,
): string => {
	const schemaRef = quoteIdentifier(schema);
	const roleRef = renderRoleName(role);
	switch (grantKind) {
		case "schema-usage":
			return `grant usage on schema ${schemaRef} to ${roleRef};`;
		case "all-tables-privileges":
			return `grant ${privilegeList(privileges)} on all tables in schema ${schemaRef} to ${roleRef};`;
		case "default-table-privileges":
			return `alter default privileges in schema ${schemaRef} grant ${privilegeList(privileges)} on tables to ${roleRef};`;
		default:
			return assertNever(grantKind);
	}
};

/** Renders a `revoke`/`alter default privileges ... revoke` statement for `grantKind`. `privileges` is ignored for `schema-usage` (always `usage`). */
const renderRevokeStatement = (
	grantKind: GrantKind,
	schema: string,
	role: string,
	privileges: ReadonlyArray<TablePrivilege>,
): string => {
	const schemaRef = quoteIdentifier(schema);
	const roleRef = renderRoleName(role);
	switch (grantKind) {
		case "schema-usage":
			return `revoke usage on schema ${schemaRef} from ${roleRef};`;
		case "all-tables-privileges":
			return `revoke ${privilegeList(privileges)} on all tables in schema ${schemaRef} from ${roleRef};`;
		case "default-table-privileges":
			return `alter default privileges in schema ${schemaRef} revoke ${privilegeList(privileges)} on tables from ${roleRef};`;
		default:
			return assertNever(grantKind);
	}
};

/** Zero or one statement, depending on whether `privileges` is non-empty — the `if` helper an alter's optional grant/revoke half needs instead of a ternary. */
const statementIfAny = (
	privileges: ReadonlyArray<TablePrivilege>,
	renderSql: (privileges: ReadonlyArray<TablePrivilege>) => string,
): ReadonlyArray<SqlStatement> => {
	if (privileges.length === 0) {
		return [];
	}
	return [statement(renderSql(privileges))];
};

/**
 * The built-in object kind for grants (D28): `schema-usage`,
 * `all-tables-privileges`, and `default-table-privileges` (the original
 * production schema's subset of `alter default privileges`). Identity is
 * `"<schema>.<grantKind>.<role>"`. `diff` is a privilege-set delta: a
 * changed privilege list emits a single `alter` whose `emit` re-derives
 * the added/removed privileges from `previous`/`next` (notes are
 * display-only banner text — the equivalent PR #71 review fix applied
 * here from the start). `schema-usage` never alters — its privilege list
 * is always `[]`, so two `schema-usage` snapshots are never merely
 * "different privileges".
 */
export const grantKind: ObjectKind<GrantDeclaration> = {
	kind: "grant",
	dependsOn: ["schema"],
	owns: (declaration): declaration is GrantDeclaration =>
		declaration.declarationKind === "grant",
	serialize: (declaration) => {
		const snapshot: GrantSnapshot = {
			schema: declaration.schemaName,
			grantKind: declaration.grantKind,
			role: declaration.role,
			privileges: declaration.privileges,
		};
		return snapshot;
	},
	identify: (snapshot) => {
		const grantSnapshot = asGrantSnapshot(snapshot);
		return grantIdentity(
			grantSnapshot.schema,
			grantSnapshot.grantKind,
			grantSnapshot.role,
		);
	},
	diff: (previous, next, identity) => {
		if (previous === null && next !== null) {
			return [
				{
					kind: "grant",
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
					kind: "grant",
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
		const previousSnapshot = asGrantSnapshot(previous);
		const nextSnapshot = asGrantSnapshot(next);
		return [
			{
				kind: "grant",
				operation: "alter",
				identity,
				previous,
				next,
				notes: privilegeDelta(
					previousSnapshot.privileges,
					nextSnapshot.privileges,
				),
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"grant create change is missing its next snapshot.",
					);
				}
				const nextSnapshot = asGrantSnapshot(change.next);
				return [
					statement(
						renderGrantStatement(
							nextSnapshot.grantKind,
							nextSnapshot.schema,
							nextSnapshot.role,
							nextSnapshot.privileges,
						),
					),
				];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"grant drop change is missing its previous snapshot.",
					);
				}
				const previousSnapshot = asGrantSnapshot(change.previous);
				return [
					statement(
						renderRevokeStatement(
							previousSnapshot.grantKind,
							previousSnapshot.schema,
							previousSnapshot.role,
							previousSnapshot.privileges,
						),
					),
				];
			}
			case "alter": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"grant alter change is missing its previous snapshot.",
					);
				}
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"grant alter change is missing its next snapshot.",
					);
				}
				const previousSnapshot = asGrantSnapshot(change.previous);
				const nextSnapshot = asGrantSnapshot(change.next);
				const added = addedPrivileges(
					previousSnapshot.privileges,
					nextSnapshot.privileges,
				);
				const removed = removedPrivileges(
					previousSnapshot.privileges,
					nextSnapshot.privileges,
				);
				const grantStatement = statementIfAny(added, (privileges) =>
					renderGrantStatement(
						nextSnapshot.grantKind,
						nextSnapshot.schema,
						nextSnapshot.role,
						privileges,
					),
				);
				const revokeStatement = statementIfAny(removed, (privileges) =>
					renderRevokeStatement(
						nextSnapshot.grantKind,
						nextSnapshot.schema,
						nextSnapshot.role,
						privileges,
					),
				);
				return [...grantStatement, ...revokeStatement];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
