import { captureDeclarationSite } from "../declaration-site";
import type { SelectNode, SetOpNode } from "../expr/ast";
import type { SelectLimited, SetOpStage } from "../query/select";
import type { SchemaDeclaration } from "./schema";

/** A declared Postgres view: a named `select` query, optionally rendered `with (security_invoker = true)`. */
export type ViewDeclaration = {
	readonly declarationKind: "view";
	readonly schema: SchemaDeclaration;
	readonly viewName: string;
	readonly query: SelectNode | SetOpNode;
	readonly securityInvoker: boolean;
	readonly declaredAt: string | null;
};

/**
 * Declares a Postgres view under `owner`. `query` is any `select()` chain
 * stage (they all structurally satisfy `SelectLimited`) — its already-
 * validated query node is copied in as-is. `securityInvoker` defaults to
 * `false`; the "view over an RLS-enabled table without security_invoker"
 * warning is Supabase-preset territory, not core's job — discharged by
 * `@hejbro/supabase`'s `viewSecurityInvokerValidator` (Phase 6, #66, D39),
 * run via `generateMigration({ validators: supabaseValidators })`.
 */
const queryNodeOf = (
	query: SelectLimited | SetOpStage,
): SelectNode | SetOpNode => {
	if ("setOpQuery" in query) {
		return query.setOpQuery;
	}
	return query.selectQuery;
};

export const defineView = (
	owner: SchemaDeclaration,
	viewName: string,
	query: SelectLimited | SetOpStage,
	options?: { readonly securityInvoker?: boolean },
): ViewDeclaration => ({
	declarationKind: "view",
	schema: owner,
	viewName,
	query: queryNodeOf(query),
	securityInvoker: options?.securityInvoker ?? false,
	declaredAt: captureDeclarationSite(),
});
