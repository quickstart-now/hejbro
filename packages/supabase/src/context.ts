import type { DbContext } from "@hejbro/query";
import { anonRole, authenticatedRole } from "./roles";

/**
 * `asUser(claims)`'s own argument (owner decision ②, tasks.md group 6
 * header): an arbitrary claims object that must carry `sub` — the
 * subject `auth.uid()` reads (task 6.0's scout) — required both here at
 * the type level and again at runtime (`asUser` itself) for an untyped
 * caller. Any `role` claim is accepted structurally but never trusted:
 * `asUser` always overwrites it with `"authenticated"`.
 */
export type Claims = {
	readonly sub: string;
	readonly [claim: string]: unknown;
};

const claimsSettingKey = "request.jwt.claims";

/** Builds and throws the `claims-subject-missing`-coded enriched `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). */
function throwClaimsSubjectMissing(): never {
	throw Object.assign(
		new Error(
			'asUser(claims) requires a "sub" claim identifying the user. Next: include "sub" in the claims object, e.g. asUser({ sub: user.id }).',
		),
		{ code: "claims-subject-missing" },
	);
}

/**
 * `db.as(asUser(claims))`: fixes role `authenticated` and sets exactly
 * one session setting — `request.jwt.claims` — to `claims` merged with
 * `role: "authenticated"` (owner decision ②; any caller-supplied `role`
 * claim is discarded, never trusted). The `sub` requirement is checked
 * again here at runtime (`claims-subject-missing`) as a fail-fast guard
 * for a caller that bypasses the type (plain JS, an `any`-typed value):
 * an RLS policy silently reading `auth.uid()` as `null` because `sub`
 * was missing would be far harder to notice than an upfront throw.
 */
export const asUser = (claims: Claims): DbContext => {
	if (typeof claims.sub !== "string") {
		throwClaimsSubjectMissing();
	}
	return {
		role: authenticatedRole,
		settings: {
			[claimsSettingKey]: JSON.stringify({
				...claims,
				role: "authenticated",
			}),
		},
	};
};

/**
 * `db.as(asAnon())`: fixes role `anon` with claims `{"role":"anon"}`
 * (owner decision ②) — no `sub`, matching Supabase's own unauthenticated
 * request shape.
 */
export const asAnon = (): DbContext => ({
	role: anonRole,
	settings: {
		[claimsSettingKey]: JSON.stringify({ role: "anon" }),
	},
});
