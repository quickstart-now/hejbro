import type { DbContext } from "@hejbro/query";
import { anonymousRole, authenticatedRole } from "./roles";

/**
 * `asUser(claims)`'s own argument (task 5.2) — an arbitrary claims object
 * that must carry `sub`, the subject `auth.uid()` reads. Structurally the
 * same shape as the Supabase preset's own `Claims`, but never imported
 * from it: a preset may only use `@hejbro/query`'s driver contract type
 * across a preset boundary, never another preset's internals
 * (`.claude/rules/provider-preset.md`) — this is its own, independent
 * type.
 */
export type Claims = {
	readonly sub: string;
	readonly [claim: string]: unknown;
};

/**
 * `pg_session_jwt`'s two mutually exclusive identity sources (design.md,
 * "The authentication mode is stated once, at construction"): `"claims"`
 * reads `request.jwt.claims` (no JWK configured on the database), `"jwt"`
 * reads `pg_session_jwt.jwt` — a raw token the database verifies itself
 * against a configured key. Named for what the caller hands across the
 * boundary in each mode (a claims object vs. a token), not for who
 * verifies it — `neonAuth("jwt")`'s own name would otherwise misattribute
 * verification to this preset, which never decodes or checks anything.
 * {@link neonAuth} fixes which one a codebase can use, once, at
 * construction.
 */
export type NeonAuthMode = "claims" | "jwt";

const claimsSettingKey = "request.jwt.claims";
const jwtSettingKey = "pg_session_jwt.jwt";

/** Builds and throws the `claims-subject-missing`-coded enriched `Error` (D57, same code family as the Supabase preset's own guard — no new code invented for the same failure) — a `function` declaration, not `const f = (): never => …`, so a caller after this line is actually narrowed. */
function throwClaimsSubjectMissing(): never {
	throw Object.assign(
		new Error(
			'asUser(claims) requires a "sub" claim identifying the user. Next: include "sub" in the claims object, e.g. asUser({ sub: user.id }).',
		),
		{ code: "claims-subject-missing" },
	);
}

/**
 * `asUser(claims)` (task 5.2, claims mode): fixes role `authenticated`
 * and sets exactly one session setting, `request.jwt.claims`, to `claims`
 * merged with `role: "authenticated"` — any caller-supplied `role` claim
 * is discarded, never trusted, as in the Supabase preset. The `sub`
 * requirement is checked again here at runtime (`claims-subject-missing`)
 * as a fail-fast guard for a caller that bypasses the type: a policy
 * silently reading `auth.uid()` as NULL because `sub` was missing would
 * be far harder to notice than an upfront throw.
 */
const asUser = (claims: Claims): DbContext => {
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
 * `asJwtUser(token)` (task 5.3, `jwt` mode): fixes role `authenticated`
 * and carries `token` opaquely as the `pg_session_jwt.jwt` setting —
 * never decoded, inspected, or validated by the preset
 * (`rls-execution-context`'s "Token verification never happens in the
 * preset" requirement). The database checks the token's signature
 * against its configured key the first time identity is read, not when
 * this context is applied; an invalid token surfaces there, not here.
 */
const asJwtUser = (token: string): DbContext => ({
	role: authenticatedRole,
	settings: { [jwtSettingKey]: token },
});

/**
 * `asAnonymous()` (task 5.4, both modes): fixes role `anonymous` — Neon's
 * own role name — with no identity setting at all, matching Neon's
 * unauthenticated request shape.
 */
const asAnonymous = (): DbContext => ({
	role: anonymousRole,
});

/** The claims-mode auth surface (task 5.1) — `neonAuth("claims")`'s return value. */
type ClaimsAuthSurface = {
	readonly asUser: (claims: Claims) => DbContext;
	readonly asAnonymous: () => DbContext;
};

/** The `jwt`-mode auth surface (task 5.1) — `neonAuth("jwt")`'s return value. */
type JwtAuthSurface = {
	readonly asJwtUser: (token: string) => DbContext;
	readonly asAnonymous: () => DbContext;
};

const claimsSurface: ClaimsAuthSurface = { asUser, asAnonymous };
const jwtSurface: JwtAuthSurface = { asJwtUser, asAnonymous };

/**
 * Resolves `M` to the one auth surface type `mode` fixes (task 5.1's
 * `[design]` type shape). `M extends NeonAuthMode` here is a **naked**
 * type parameter, so this distributes over a union: called with a
 * literal (`"claims"` or `"jwt"`), `M` is exactly that literal and this
 * resolves to exactly one surface — the other mode's builder is then a
 * property that structurally does not exist. Called with an unnarrowed
 * `NeonAuthMode` (both members), this distributes to
 * `ClaimsAuthSurface | JwtAuthSurface`, and TypeScript refuses property
 * access for any key not present on **every** union member — `asUser`
 * and `asJwtUser` both become inaccessible, with no `never` escape hatch
 * required to force it. `asAnonymous` stays accessible either way, on
 * purpose: it is identical on both surfaces and nothing requires gating
 * it.
 */
type NeonAuthSurfaceFor<M extends NeonAuthMode> = M extends "claims"
	? ClaimsAuthSurface
	: M extends "jwt"
		? JwtAuthSurface
		: never;

/**
 * The auth surface factory (task 5.1): takes the database's
 * authentication mode once and returns only that mode's builders. Never
 * discovers the mode by querying the database — that would be a probe,
 * and the surface is fixed as data before any connection exists, exactly
 * like a driver's capabilities (`driver-contract`'s "instead of probing
 * behavior at runtime", applied a second time here).
 */
export const neonAuth = <M extends NeonAuthMode>(
	mode: M,
): NeonAuthSurfaceFor<M> => {
	if (mode === "claims") {
		return claimsSurface as NeonAuthSurfaceFor<M>;
	}
	return jwtSurface as NeonAuthSurfaceFor<M>;
};
