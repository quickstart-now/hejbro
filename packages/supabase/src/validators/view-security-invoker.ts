import type {
	FromNode,
	HejbroDeclaration,
	SelectNode,
	SetOpNode,
	TableRefNode,
	Validator,
	WithNode,
} from "@hejbro/core";
import { diagnostic } from "@hejbro/core";
import { declaredAtOf, isRlsDeclaration, isViewDeclaration } from "./schema-of";

/**
 * A `from`/join target's real table, or `undefined` for a CTE reference
 * (add-ctes, task 4.4) — a CTE is statement-local, never an object an RLS
 * declaration can bind to, so it contributes nothing here rather than
 * being reported as a table that does not exist. This is the reason the
 * proposal chose the `FromNode` union over a side-channel field (D105):
 * under a field this validator would compile untouched and warn about
 * nothing, a silent false negative exactly where a security check must
 * not have one.
 */
const tableRefOf = (from: FromNode): TableRefNode | undefined => {
	if ("cteName" in from) {
		return undefined;
	}
	return from;
};

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

/**
 * Every table a view's query touches: each leaf select's `from` plus join
 * targets — BOTH branches of a set operation (an RLS bypass through either
 * branch is equally a bypass, add-set-operations) and, since add-ctes
 * (task 4.4), every CTE entry's own body too — a table read only inside a
 * CTE is still read, and the RLS bypass it risks is exactly as real as one
 * read directly in the outer body. The CTE name itself is filtered out by
 * `tableRefOf` returning `undefined` for it, never by skipping the entry.
 */
const referencedTables = (
	query: SelectNode | SetOpNode | WithNode,
): ReadonlyArray<TableRefNode> => {
	if (query.queryKind === "with") {
		return [
			...query.ctes.flatMap((entry) => referencedTables(entry.query)),
			...referencedTables(query.body),
		];
	}
	if (query.queryKind === "setOp") {
		return [...referencedTables(query.left), ...referencedTables(query.right)];
	}
	return [
		tableRefOf(query.from),
		...query.joins.map((join) => tableRefOf(join.table)),
	].filter((ref): ref is TableRefNode => ref !== undefined);
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
