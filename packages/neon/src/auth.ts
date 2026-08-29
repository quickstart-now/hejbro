import type { Expr } from "@hejbro/core";
import { expr } from "@hejbro/core";

/**
 * `auth.uid()` — the calling user's subject, as `pg_session_jwt` exposes
 * it. Renders the same `functionCall` node the Supabase preset's own
 * {@link authUid}-named helper renders (task 4.2): not a copy, but the
 * result of two platforms exposing the same function name in the same
 * `auth` schema. No `*Cached` variant here — that encodes Supabase's own
 * documented RLS performance guidance, unconfirmed for Neon (out of
 * scope, proposal.md).
 */
export const authUid = (): Expr<"uuid"> =>
	expr("uuid", {
		nodeKind: "functionCall",
		schemaName: "auth",
		functionName: "uid",
		args: [],
	});

/** `auth.jwt()` — the calling user's JWT claims (jsonb), as `pg_session_jwt` exposes it. Same platform-agreement note as {@link authUid}. */
export const authJwt = (): Expr<"json"> =>
	expr("json", {
		nodeKind: "functionCall",
		schemaName: "auth",
		functionName: "jwt",
		args: [],
	});
