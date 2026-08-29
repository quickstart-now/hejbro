import type { Role } from "@hejbro/core";
import { roleName } from "@hejbro/core";

/** The `authenticated` Postgres role Neon's Data API uses once a request carries a valid JWT. */
export const authenticatedRole: Role = roleName("authenticated");

/**
 * The `anonymous` Postgres role Neon's Data API uses for an unauthenticated
 * request (task 4.1's `[design]` decision) — Neon's own name, **not**
 * Supabase's `anon`. The constant emits the SQL identifier it names, so
 * matching Supabase here would make it lie about the platform it targets.
 */
export const anonymousRole: Role = roleName("anonymous");
