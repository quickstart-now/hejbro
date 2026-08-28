import type {
	HejbroDeclaration,
	SelectNode,
	SetOpNode,
	TableRefNode,
	Validator,
} from "@hejbro/core";
import { diagnostic } from "@hejbro/core";
import { declaredAtOf, isRlsDeclaration, isViewDeclaration } from "./schema-of";

const viewOverRlsMessage = (
	viewSchema: string,
	viewName: string,
	tableSchema: string,
	tableName: string,
): string =>
	`view "${viewSchema}"."${viewName}" reads RLS-protected table "${tableSchema}"."${tableName}" without security_invoker — the view runs with its owner's rights and bypasses row-level security (PG15+). Pass { securityInvoker: true } to defineView, or confirm the bypass is intended.`;

/** `"<schema>.<table>"` keys for every table with an RLS declaration bound to it. */
const rlsProtectedTables = (
	declarations: ReadonlyArray<HejbroDeclaration>,
): ReadonlySet<string> =>
	new Set(
		declarations
			.filter(isRlsDeclaration)
			.map((rls) => `${rls.schemaName}.${rls.tableName}`),
	);

/** Every table a view's query touches: each leaf select's `from` plus join targets — BOTH branches of a set operation (an RLS bypass through either branch is equally a bypass, add-set-operations). */
const referencedTables = (
	query: SelectNode | SetOpNode,
): ReadonlyArray<TableRefNode> => {
	if (query.queryKind === "setOp") {
		return [...referencedTables(query.left), ...referencedTables(query.right)];
	}
	return [query.from, ...query.joins.map((join) => join.table)];
};

/**
 * Warns when a `defineView` reads an RLS-protected table (its `from` or
 * any `inner join` target) without `{ securityInvoker: true }` (#66, D39):
 * the view then runs with its owner's privileges and silently bypasses
 * row-level security on PG15+. Judges from the original declarations
 * (`query.from`/`joins` cross-checked against `rls` declarations), not
 * from snapshots — `ViewSnapshot` stays untouched.
 */
export const viewSecurityInvokerValidator: Validator = (
	_snapshot,
	declarations,
) => {
	const protectedTables = rlsProtectedTables(declarations);
	return declarations.filter(isViewDeclaration).flatMap((view) => {
		if (view.securityInvoker) {
			return [];
		}
		const exposedTable = referencedTables(view.query).find((ref) =>
			protectedTables.has(`${ref.schemaName}.${ref.tableName}`),
		);
		if (exposedTable === undefined) {
			return [];
		}
		return [
			diagnostic(
				"warning",
				"view-over-rls-without-security-invoker",
				viewOverRlsMessage(
					view.schema.schemaName,
					view.viewName,
					exposedTable.schemaName,
					exposedTable.tableName,
				),
				declaredAtOf(view),
			),
		];
	});
};
