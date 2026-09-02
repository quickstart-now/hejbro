import type { HejbroDeclaration, Validator } from "@hejbro/core";
import { diagnostic } from "@hejbro/core";
import {
	declaredAtOf,
	isGrantDeclaration,
	isManagedTableDeclaration,
	isRlsDeclaration,
} from "./schema-of";

const apiRoles: ReadonlyArray<string> = ["anon", "authenticated"];
const exposingGrantKinds: ReadonlyArray<string> = [
	"all-tables-privileges",
	"default-table-privileges",
];

const exposedTableMessage = (schemaName: string, tableName: string): string =>
	`table "${schemaName}"."${tableName}" is reachable by API roles (grant to "anon"/"authenticated" on schema "${schemaName}") but has no row-level security — every row is readable/writable through the API. Declare rls(...) on the table, or drop the schema grant.`;

/** Schemas carrying an `all-tables-privileges`/`default-table-privileges` grant to `anon`/`authenticated` (D40). */
const exposedSchemas = (
	declarations: ReadonlyArray<HejbroDeclaration>,
): ReadonlySet<string> =>
	new Set(
		declarations
			.filter(isGrantDeclaration)
			.filter(
				(grantDeclaration) =>
					exposingGrantKinds.includes(grantDeclaration.grantKind) &&
					apiRoles.includes(grantDeclaration.role),
			)
			.map((grantDeclaration) => grantDeclaration.schemaName),
	);

/** `"<schema>.<table>"` keys for every table with an RLS declaration bound to it. */
const rlsProtectedTables = (
	declarations: ReadonlyArray<HejbroDeclaration>,
): ReadonlySet<string> =>
	new Set(
		declarations
			.filter(isRlsDeclaration)
			.map((rls) => `${rls.schemaName}.${rls.tableName}`),
	);

/**
 * Warns when a table sits in a schema granted to `anon`/`authenticated`
 * (`all-tables-privileges`/`default-table-privileges`) but declares no RLS
 * (D40) — every row in that table is then readable/writable through the
 * Supabase API. Order is declaration order. Skips an `existingTable()`
 * declaration (add-unmanaged-objects, J6-2): this judges whether hejbro
 * should have declared `rls(...)` on a table it manages, and an unmanaged
 * table's builder has no `rls(...)` option to declare in the first place —
 * the warning's own "declare rls(...) on the table" advice would be
 * unactionable for it.
 */
export const exposedTableValidator: Validator = (_snapshot, declarations) => {
	const schemas = exposedSchemas(declarations);
	const protectedTables = rlsProtectedTables(declarations);
	return declarations.filter(isManagedTableDeclaration).flatMap((table) => {
		const identity = `${table.schema.schemaName}.${table.tableName}`;
		if (
			!schemas.has(table.schema.schemaName) ||
			protectedTables.has(identity)
		) {
			return [];
		}
		return [
			diagnostic(
				"warning",
				"exposed-table-without-rls",
				exposedTableMessage(table.schema.schemaName, table.tableName),
				declaredAtOf(table),
			),
		];
	});
};
