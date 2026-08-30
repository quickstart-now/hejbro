import type { GrantDeclaration, GrantKind, TablePrivilege } from "../dsl/grant";
import { tablePrivileges } from "../dsl/grant";
import { assertNever } from "../error";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import { requireNext, requirePrevious } from "../kind/emit-helpers";
import type {
	ChangeOperation,
	KindChange,
	ObjectKind,
} from "../kind/object-kind";
import type { Snapshot } from "../snapshot/snapshot";
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

/** `"<schema>.<grantKind>.<role>"` — exported so `tableKind`'s `create` emit can tell a *newly created* schema-wide grant (already `siblingChanges`-visible, D74) apart from a *standing* one it's re-issuing for a new table (#121/D78, `standingAllTablesGrants`) — the former's own `create` emit already covers this table via `on all tables in schema`, so re-issuing it too would be a harmless but confusing duplicate statement. */
export const grantIdentity = (
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

/**
 * Renders a `grant`/`alter default privileges ... grant` statement for
 * `grantKind`. `privileges` is ignored for `schema-usage` (always
 * `usage`). Exported (not just `grantKind`-internal) so `tableKind`'s
 * `create` emit can re-issue the exact same `all-tables-privileges`
 * statement a standing grant's own `create` used, to catch up a table
 * created after it (#121/D78, `standingAllTablesGrants`) — deliberately
 * the *schema-wide* form, not a table-scoped `grant ... on table ...`: a
 * hand-rolled table-scoped statement produces the same end privileges but
 * a different Postgres ACL-array insertion order than the schema-wide
 * form used everywhere else, which a real `pg_dump` (the local
 * round-trip's own comparison) can tell apart even though `information_
 * schema.role_table_grants` (#219's check) can't — re-issuing the
 * identical statement sidesteps that entirely rather than fighting it.
 */
export const renderGrantStatement = (
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

const GRANT_KEY_PREFIX = "grant:";

/**
 * Every `all-tables-privileges` grant already declared for `schema` in
 * `snapshot` — the standing schema-wide grants whose own Postgres
 * statement (`grant ... on all tables in schema ...`) only ever covers
 * whatever tables existed *when it ran*, so a table created by a later
 * migration needs it re-issued to end up covered too (#121/D78). Read by
 * `tableKind`'s `create` emit via the `nextSnapshot` it's handed (D78) —
 * this never produces a new `KindChange`: the grant node itself never
 * changes when an unrelated table is added, so `grantKind`'s own
 * identity/diff stay untouched.
 */
export const standingAllTablesGrants = (
	schema: string,
	snapshot: Snapshot,
): ReadonlyArray<GrantSnapshot> =>
	Object.entries(snapshot.objects)
		.filter(([key]) => key.startsWith(GRANT_KEY_PREFIX))
		.map(([, node]) => asGrantSnapshot(node))
		.filter(
			(grant) =>
				grant.schema === schema && grant.grantKind === "all-tables-privileges",
		);

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

/** {@link grantKind}'s `emit`, `"create"` case. */
const emitCreate = (change: KindChange): ReadonlyArray<SqlStatement> => {
	const nextSnapshot = asGrantSnapshot(requireNext(change));
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
};

/** {@link grantKind}'s `emit`, `"drop"` case. */
const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => {
	const previousSnapshot = asGrantSnapshot(requirePrevious(change));
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
};

/** {@link grantKind}'s `emit`, `"alter"` case: re-grants the added privileges and revokes the removed ones, re-deriving both sets from `previous`/`next` (notes are display-only). */
const emitAlter = (change: KindChange): ReadonlyArray<SqlStatement> => {
	// #472 trap 2: previous is checked before next here — the reverse of
	// view-kind.ts's alter — and that order is the observable both-null
	// message, not a stylistic choice to harmonize.
	const previousSnapshot = asGrantSnapshot(requirePrevious(change));
	const nextSnapshot = asGrantSnapshot(requireNext(change));
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
};

/**
 * One handler per {@link ChangeOperation}, same technique used across this
 * phase's other `emit` splits (#154 ratchet-5).
 */
type EmitHandlers = {
	readonly [K in ChangeOperation]: (
		change: KindChange,
	) => ReadonlyArray<SqlStatement>;
};

const emitHandlers: EmitHandlers = {
	create: emitCreate,
	drop: emitDrop,
	alter: emitAlter,
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
	requiredKeys: ["schema", "grantKind", "role", "privileges"],
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
		const guard = createOrDropDiff("grant", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}
		if (sameJson(guard.previous, guard.next)) {
			return [];
		}
		const previousSnapshot = asGrantSnapshot(guard.previous);
		const nextSnapshot = asGrantSnapshot(guard.next);
		return [
			{
				kind: "grant",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: privilegeDelta(
					previousSnapshot.privileges,
					nextSnapshot.privileges,
				),
			},
		];
	},
	emit: (change) => emitHandlers[change.operation](change),
};
