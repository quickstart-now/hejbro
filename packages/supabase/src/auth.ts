import type { Expr } from "@hejbro/core";
import { expr } from "@hejbro/core";

/**
 * `auth.uid()` — the calling user's id (uuid), as Supabase's `auth` schema
 * exposes it. Renders the plain call (D45): no automatic
 * `(select auth.uid())` initPlan wrapping, since that wrapping is illegal
 * inside a column `default`/`check` expression, where this helper is also
 * idiomatic. See the package README for the RLS performance note.
 */
export const authUid = (): Expr<"uuid"> =>
	expr("uuid", {
		nodeKind: "functionCall",
		schemaName: "auth",
		functionName: "uid",
		args: [],
	});

/** `auth.jwt()` — the calling user's JWT claims (jsonb), as Supabase's `auth` schema exposes it. */
export const authJwt = (): Expr<"json"> =>
	expr("json", {
		nodeKind: "functionCall",
		schemaName: "auth",
		functionName: "jwt",
		args: [],
	});
