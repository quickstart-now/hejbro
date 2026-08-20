import type { Role } from "@hejbro/core";
import { roleName } from "@hejbro/core";

/** The `anon` Postgres role Supabase's PostgREST layer uses for unauthenticated API requests. */
export const anonRole: Role = roleName("anon");

/** The `authenticated` Postgres role Supabase's PostgREST layer uses once a request carries a valid JWT. */
export const authenticatedRole: Role = roleName("authenticated");

/** The `service_role` Postgres role Supabase's server-side clients use — bypasses RLS, never expose it to browser code. */
export const serviceRole: Role = roleName("service_role");
