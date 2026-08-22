import type { GrantDeclaration } from "../dsl/grant";
import type { PolicyDeclaration } from "../dsl/rls";
import type { HejbroDeclaration, KindChange } from "../kind/object-kind";
import { asSequenceSnapshot } from "../kinds/sequence-kind";
import type { ColumnSnapshot } from "../kinds/table-snapshot";
import {
	asTableSnapshot,
	columnDefault,
	columnNotNull,
} from "../kinds/table-snapshot";
import type { JsonValue } from "../snapshot/stable-json";
import type { Diagnostic } from "./validate";
import { diagnostic } from "./validate";

/**
 * `"<schema>.<table>.<column>"` for every `sequence` change in this diff
 * whose sequence still exists in `next` (a `create` or an `alter`, never a
 * `drop`) — the set of columns that effectively *do* have a default, even
 * though a `serial`-family column's default lives in the `sequence` kind's
 * own snapshot node, not `ColumnSnapshot.default` (#23/D66). Read by
 * {@link notNullWithoutDefaultWarnings} below so it doesn't warn on a
 * column whose default this diff is about to attach via a sibling
 * `sequence` change — the two kinds' changes live in the same `changes`
 * array this function already receives, so no new cross-kind plumbing is
 * needed, only reading what's already there.
 */
const sequenceOwnedColumns = (
	changes: ReadonlyArray<KindChange>,
): ReadonlySet<string> =>
	new Set(
		changes
			.filter((change) => change.kind === "sequence" && change.next !== null)
			.map((change) => asSequenceSnapshot(change.next))
			.map(
				(sequence) => `${sequence.schema}.${sequence.table}.${sequence.column}`,
			),
	);

/** A `table` `alter` change — {@link notNullWithoutDefaultWarnings}'s own concern, everything else it skips. */
type TableAlterChange = KindChange & {
	readonly previous: JsonValue;
	readonly next: JsonValue;
};

/** Is `change` a `table` `alter` with both snapshots present (an `alter` always carries both — this also excludes `create`/`drop`, which have one side `null` by definition)? */
const isTableAlterChange = (change: KindChange): change is TableAlterChange =>
	change.kind === "table" &&
	change.operation === "alter" &&
	change.previous !== null &&
	change.next !== null;

/** Was `column` just added, as `not null`, with no default — the one shape {@link notNullWithoutDefaultWarnings} warns about? */
const isAddedWithoutDefault = (
	column: ColumnSnapshot,
	previousColumnNames: ReadonlySet<string>,
	ownedBySequence: ReadonlySet<string>,
	tableIdentity: string,
): boolean =>
	!previousColumnNames.has(column.name) &&
	columnNotNull(column) &&
	columnDefault(column) === null &&
	!ownedBySequence.has(`${tableIdentity}.${column.name}`);

/** {@link notNullWithoutDefaultWarnings}'s own warnings for one `table` `alter` change. */
const tableAlterWarnings = (
	change: TableAlterChange,
	ownedBySequence: ReadonlySet<string>,
): ReadonlyArray<Diagnostic> => {
	const previous = asTableSnapshot(change.previous);
	const next = asTableSnapshot(change.next);
	const previousColumnNames = new Set(
		previous.columns.map((column) => column.name),
	);
	const addedWithoutDefault = next.columns.filter((column) =>
		isAddedWithoutDefault(
			column,
			previousColumnNames,
			ownedBySequence,
			`${next.schema}.${next.name}`,
		),
	);
	return addedWithoutDefault.map((column) =>
		diagnostic(
			"warning",
			"not-null-without-default",
			`column "${next.schema}"."${next.name}"."${column.name}" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.`,
		),
	);
};

/**
 * Warns when a table `alter` change adds a `not null` column with no
 * `default` — such a migration fails on any table that already has rows.
 * Built in (not a preset `Validator`, D37): validators only see the built
 * snapshot and declarations, never the previous snapshot, so this check
 * needs the diff itself — `generateMigration` calls it right after
 * `diffSnapshots` and folds the result into `warnings` (#27).
 *
 * Only genuinely *new* columns are flagged (present in `next`, absent
 * from `previous`); a `create` change (a brand-new table) never appears
 * here because `notNullWithoutDefaultWarnings` only looks at `alter`
 * changes. A column owned by a `sequence` change in the same diff is
 * never flagged either (#23/D66) — see {@link sequenceOwnedColumns}.
 */
export const notNullWithoutDefaultWarnings = (
	changes: ReadonlyArray<KindChange>,
): ReadonlyArray<Diagnostic> => {
	const ownedBySequence = sequenceOwnedColumns(changes);
	return changes
		.filter(isTableAlterChange)
		.flatMap((change) => tableAlterWarnings(change, ownedBySequence));
};

const isPolicyDeclaration = (
	declaration: HejbroDeclaration,
): declaration is PolicyDeclaration => declaration.declarationKind === "policy";

const isGrantDeclaration = (
	declaration: HejbroDeclaration,
): declaration is GrantDeclaration => declaration.declarationKind === "grant";

/** PostgreSQL's `PUBLIC` pseudo-role, as it appears in a `.to(...)`/`grant(...).usage.to(...)` role list -- not the `public` *schema* (unrelated, no special-casing here; see #203). */
const PUBLIC_ROLE = "public";

/** Schema name -> the set of roles a `schema-usage` grant names for it. A `"public"` member is PostgreSQL's PUBLIC pseudo-role -- `grant usage on schema … to public` covers every role, not only one literally named `"public"` (read by {@link policyReachable}). */
const schemaUsageGrantedRoles = (
	declarations: ReadonlyArray<HejbroDeclaration>,
): ReadonlyMap<string, ReadonlySet<string>> => {
	const grants = declarations
		.filter(isGrantDeclaration)
		.filter((grant) => grant.grantKind === "schema-usage");
	const schemaNames = new Set(grants.map((grant) => grant.schemaName));
	return new Map(
		[...schemaNames].map((schemaName) => [
			schemaName,
			new Set(
				grants
					.filter((grant) => grant.schemaName === schemaName)
					.map((grant) => grant.role),
			),
		]),
	);
};

/**
 * Whether at least one role bound by `policy` can actually reach
 * `policy`'s schema, given `grantedRoles` (the schema's granted
 * `schema-usage` roles). Two PUBLIC-pseudo-role cases, both real
 * PostgreSQL semantics rather than a hejbro-specific carve-out: a grant
 * *to* `"public"` covers every role, so it satisfies any policy; a
 * policy *targeting* `"public"` (`.to("public")`, applies to every role)
 * is reachable as soon as the schema grants usage to any role at all --
 * that role is bound by the policy too and can reach it, so the policy
 * isn't universally dead the way it would be with zero grants.
 */
const policyReachable = (
	policy: PolicyDeclaration,
	grantedRoles: ReadonlySet<string>,
): boolean => {
	if (policy.roles.includes(PUBLIC_ROLE)) {
		return grantedRoles.size > 0;
	}
	if (grantedRoles.has(PUBLIC_ROLE)) {
		return true;
	}
	return policy.roles.some((role) => grantedRoles.has(role));
};

const rlsUnreachableSchemaMessage = (policy: PolicyDeclaration): string => {
	const roleList = [...policy.roles]
		.sort()
		.map((role) => `"${role}"`)
		.join(", ");
	return `policy "${policy.policyName}" on "${policy.schemaName}"."${policy.tableName}" targets role(s) ${roleList} but schema "${policy.schemaName}" grants usage to none of them — every row is unreachable through this policy (permission denied for schema before RLS is even consulted). Next: grant(schema).usage.to(${roleList}), or add the missing role(s) to an existing schema-usage grant.`;
};

/**
 * Warns when a policy's schema grants `usage` to none of the roles it
 * targets (#203) — Postgres checks schema `usage` before RLS is even
 * consulted, so such a policy can never run at all; the failure is
 * `permission denied for schema`, not an RLS denial. Plain PostgreSQL
 * semantics, not Supabase-specific, so this lives in core and runs
 * unconditionally — like {@link notNullWithoutDefaultWarnings}, called
 * directly by `generateMigration` rather than gated behind a preset's
 * opt-in `options.validators` (D37).
 *
 * Judges from the normalized declarations, matching every existing
 * preset `Validator` in this codebase (`exposed-tables`/
 * `reserved-schemas`/`view-security-invoker`, all `packages/supabase`)
 * — `PolicyDeclaration`/`GrantDeclaration` are already flattened to
 * top-level declarations by `resolveDeclarations` (D28's `grant(...).to(...)`
 * fan-out), so no snapshot decoding is needed.
 *
 * Known limitation: hejbro doesn't model superuser roles or schema
 * ownership, both of which bypass PostgreSQL's schema-usage check in
 * reality (a superuser, or the schema's owner, can use any schema
 * regardless of grants) — a policy scoped to such a role can warn here
 * despite being reachable in practice.
 *
 * No PUBLIC-by-omission case to handle: `rls.ts`'s policy builder forces
 * a `.to(...)` call with at least one role (a zero-arg `.to()` throws
 * `rls-policy-missing-roles`) before `using`/`withCheck` even become
 * reachable, so `PolicyDeclaration.roles` is never empty — a policy can
 * target PUBLIC only by naming it explicitly, `.to("public")`.
 */
export const rlsUnreachableSchemaWarnings = (
	declarations: ReadonlyArray<HejbroDeclaration>,
): ReadonlyArray<Diagnostic> => {
	const grantsBySchema = schemaUsageGrantedRoles(declarations);
	return declarations.filter(isPolicyDeclaration).flatMap((policy) => {
		const grantedRoles =
			grantsBySchema.get(policy.schemaName) ?? new Set<string>();
		if (policyReachable(policy, grantedRoles)) {
			return [];
		}
		return [
			diagnostic(
				"warning",
				"rls-unreachable-schema",
				rlsUnreachableSchemaMessage(policy),
				policy.declaredAt,
			),
		];
	});
};
