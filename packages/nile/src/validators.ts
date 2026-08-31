import type {
	Diagnostic,
	FunctionDeclaration,
	GrantDeclaration,
	HejbroDeclaration,
	PolicyDeclaration,
	RlsDeclaration,
	TableDeclaration,
	TriggerDeclaration,
	Validator,
} from "@hejbro/core";
import { diagnostic } from "@hejbro/core";

/**
 * Per-`declarationKind` narrowers (tasks 4.1-4.4, #566) -- mirrors
 * `@hejbro/supabase`'s own private `validators/schema-of.ts` pattern, not
 * imported from it: the narrower *functions* are package-internal there,
 * so each preset writes its own over the same public `declarationKind`
 * discriminant (`HejbroDeclaration`'s own public shape, `.claude/rules/
 * provider-preset.md`'s "core's public extension interface").
 */
const isRlsDeclaration = (
	declaration: HejbroDeclaration,
): declaration is RlsDeclaration => declaration.declarationKind === "rls";

const isPolicyDeclaration = (
	declaration: HejbroDeclaration,
): declaration is PolicyDeclaration => declaration.declarationKind === "policy";

const isFunctionDeclaration = (
	declaration: HejbroDeclaration,
): declaration is FunctionDeclaration =>
	declaration.declarationKind === "function";

const isTriggerDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TriggerDeclaration =>
	declaration.declarationKind === "trigger";

const isGrantDeclaration = (
	declaration: HejbroDeclaration,
): declaration is GrantDeclaration => declaration.declarationKind === "grant";

const isTableDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TableDeclaration => declaration.declarationKind === "table";

/**
 * The two evidence-grade clauses every message below ends with (task 4.6,
 * spec: "A refusal states the evidence behind it") -- verbatim substrings
 * a caller can grep for, and what tasks 4.1-4.3/4.4's own tests assert
 * on. `PLATFORM_DOCUMENTED` names the platform's published limitations
 * table as the source; `MEASURED_ONLY` says the refusal instead rests on
 * this preset's own measurement against Nile's testing container
 * (proposal.md's "Measurement protocol"), never on that published table.
 */
const PLATFORM_DOCUMENTED =
	"this is documented in the platform's published limitations";
const MEASURED_ONLY =
	"this refusal rests on a measurement, not on the platform's published limitations";

const rlsMessage = (schemaName: string, tableName: string): string =>
	`Nile's platform does not support row-level security -- "${schemaName}"."${tableName}" declares it, and ${PLATFORM_DOCUMENTED}. Next: remove the rls()/policy() declaration; this preset enforces tenant isolation through its own tenant context (asTenant(...)) instead of Postgres RLS.`;

const policyMessage = (schemaName: string, tableName: string): string =>
	`Nile's platform does not support row-level security policies -- "${schemaName}"."${tableName}" declares one, and ${PLATFORM_DOCUMENTED}. Next: remove the policy() declaration; this preset enforces tenant isolation through its own tenant context (asTenant(...)) instead of Postgres RLS.`;

const functionMessage = (schemaName: string, functionName: string): string =>
	`Nile's platform does not support SQL functions -- "${schemaName}"."${functionName}" is declared, and ${PLATFORM_DOCUMENTED}. Next: remove the defineFunction() declaration; move this logic to application code.`;

const triggerMessage = (
	schemaName: string,
	tableName: string,
	triggerName: string,
): string =>
	`Nile's platform does not support triggers -- "${triggerName}" on "${schemaName}"."${tableName}" is declared, and ${PLATFORM_DOCUMENTED}. Next: remove the defineTrigger() declaration; move this logic to application code.`;

const grantMessage = (schemaName: string, role: string): string =>
	`Nile's platform refuses GRANT on schema "${schemaName}" to "${role}" -- ${MEASURED_ONLY}. Next: remove the grant() declaration; Nile does not use Postgres roles/grants for access control.`;

const serialMessage = (
	schemaName: string,
	tableName: string,
	columnName: string,
): string =>
	`Nile's platform refuses a serial-family column ("${columnName}") in the tenant-aware table "${schemaName}"."${tableName}" -- ${MEASURED_ONLY} (the platform's published table documents CREATE SEQUENCE as unsupported for tenant tables, an adjacent but not identical declaration). Next: use a uuid primary key instead, or drop the tenant_id column if this table is not tenant-scoped.`;

const primaryKeyMessage = (schemaName: string, tableName: string): string =>
	`Nile's platform refuses a primary key on the tenant-aware table "${schemaName}"."${tableName}" that excludes "tenant_id" -- ${MEASURED_ONLY}. Next: include tenant_id in the primary key.`;

/**
 * Refuses RLS enablement and policies (task 4.1, #566, spec: "RLS and
 * policies are refused"). Both `declarationKind`s are checked
 * independently -- `generate.ts`'s own `resolveDeclarations` fans a
 * table's `rls` block out into one `RlsDeclaration` plus one
 * `PolicyDeclaration` per policy, both as top-level entries in
 * `declarations`, so a table declaring RLS with no policies still
 * produces exactly one diagnostic (from the `RlsDeclaration` alone).
 */
export const nileRlsValidator: Validator = (_snapshot, declarations) => [
	...declarations
		.filter(isRlsDeclaration)
		.map(
			(rlsDeclaration): Diagnostic =>
				diagnostic(
					"error",
					"nile-rls-unsupported",
					rlsMessage(rlsDeclaration.schemaName, rlsDeclaration.tableName),
					rlsDeclaration.declaredAt,
				),
		),
	...declarations
		.filter(isPolicyDeclaration)
		.map(
			(policyDeclaration): Diagnostic =>
				diagnostic(
					"error",
					"nile-rls-unsupported",
					policyMessage(
						policyDeclaration.schemaName,
						policyDeclaration.tableName,
					),
					policyDeclaration.declaredAt,
				),
		),
];

/**
 * Refuses functions and triggers (task 4.2, #566, spec: "Functions and
 * triggers are refused"), the platform-documented attribution.
 */
export const nileFunctionTriggerValidator: Validator = (
	_snapshot,
	declarations,
) => [
	...declarations
		.filter(isFunctionDeclaration)
		.map(
			(functionDeclaration): Diagnostic =>
				diagnostic(
					"error",
					"nile-function-unsupported",
					functionMessage(
						functionDeclaration.schemaName,
						functionDeclaration.functionName,
					),
					functionDeclaration.declaredAt,
				),
		),
	...declarations
		.filter(isTriggerDeclaration)
		.map(
			(triggerDeclaration): Diagnostic =>
				diagnostic(
					"error",
					"nile-trigger-unsupported",
					triggerMessage(
						triggerDeclaration.schemaName,
						triggerDeclaration.tableName,
						triggerDeclaration.triggerName,
					),
					triggerDeclaration.declaredAt,
				),
		),
];

/**
 * Refuses grants (task 4.3, #566, spec: "Grants are refused, and the
 * error says it was measured") -- `GRANT` is not in the platform's
 * published limitations table, so this attribution is measured-only,
 * never platform-documented.
 */
export const nileGrantValidator: Validator = (_snapshot, declarations) =>
	declarations
		.filter(isGrantDeclaration)
		.map(
			(grantDeclaration): Diagnostic =>
				diagnostic(
					"error",
					"nile-grant-unsupported",
					grantMessage(grantDeclaration.schemaName, grantDeclaration.role),
					grantDeclaration.declaredAt,
				),
		);

/** Canonical Postgres names for the three `serial`-family pseudo-types -- `SerialTypeName`/`isSerialTypeNode` are `@hejbro/core`-internal (not part of its public `index.ts`), so this preset states its own copy of the same three names over the public `TypeNode.typeName` field. */
const SERIAL_TYPE_NAMES: ReadonlySet<string> = new Set([
	"serial",
	"smallserial",
	"bigserial",
]);

/** A table is tenant-aware exactly when it carries a `tenant_id uuid` column (proposal.md, quoting the platform: "creating a table with a 'tenant_id' column of type uuid… This is all it takes"). */
const isTenantAwareTable = (table: TableDeclaration): boolean =>
	table.columns.some(
		(column) =>
			column.columnName === "tenant_id" &&
			column.columnState.typeNode.typeName === "uuid",
	);

/**
 * Refuses every `serial`/`smallserial`/`bigserial` column in a
 * tenant-aware table (task 4.4, #566, spec: "Every serial-family column
 * in a tenant-aware table is refused"). A table with no `tenant_id uuid`
 * column is untouched (task 4.4's other scenario) -- `isTenantAwareTable`
 * filters the table set before any column is inspected, so the preset
 * never widens the platform's own restriction beyond tenant-aware tables.
 */
export const nileSerialValidator: Validator = (_snapshot, declarations) =>
	declarations
		.filter(isTableDeclaration)
		.filter(isTenantAwareTable)
		.flatMap(
			(table): ReadonlyArray<Diagnostic> =>
				table.columns
					.filter((column) =>
						SERIAL_TYPE_NAMES.has(column.columnState.typeNode.typeName),
					)
					.map((column) =>
						diagnostic(
							"error",
							"nile-serial-in-tenant-table",
							serialMessage(
								table.schema.schemaName,
								table.tableName,
								column.columnName,
							),
							table.declaredAt,
						),
					),
		);

/**
 * Refuses a primary key on a tenant-aware table that excludes
 * `tenant_id` (task added after G5's own live-witness measurement, #567:
 * the platform's testing container rejected a `create table` whose
 * primary key was `id` alone on a table also carrying `tenant_id uuid`,
 * with "primary key of tenant-aware table must have the tenant_id
 * column"). Measured, never platform-documented -- this refusal is not
 * in the platform's published limitations table.
 *
 * Scope is exactly what was measured, no wider: a tenant-aware table
 * that declares **no** primary key at all is untouched here -- that
 * shape was never exercised against the container, so this validator
 * makes no claim about it (recorded as unmeasured in the preset's own
 * documentation, not assumed safe or unsafe). Column *order* within the
 * primary key is likewise never asserted -- only that `tenant_id` is
 * one of its columns, the only fact the measurement actually supports.
 */
export const nileTenantPrimaryKeyValidator: Validator = (
	_snapshot,
	declarations,
) =>
	declarations
		.filter(isTableDeclaration)
		.filter(isTenantAwareTable)
		.flatMap((table): ReadonlyArray<Diagnostic> => {
			const primaryKeyColumns = table.columns.filter(
				(column) => column.columnState.primaryKey,
			);
			if (primaryKeyColumns.length === 0) {
				return [];
			}
			const includesTenantId = primaryKeyColumns.some(
				(column) => column.columnName === "tenant_id",
			);
			if (includesTenantId) {
				return [];
			}
			return [
				diagnostic(
					"error",
					"nile-tenant-primary-key-missing",
					primaryKeyMessage(table.schema.schemaName, table.tableName),
					table.declaredAt,
				),
			];
		});
