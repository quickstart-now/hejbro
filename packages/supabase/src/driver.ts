import type { Driver } from "@hejbro/query";
import { anonRole, authenticatedRole, serviceRole } from "./roles";

/**
 * Decorates any contract {@link Driver} with Supabase's own role
 * contribution (owner decision ③, tasks.md group 6 header) — `anon`,
 * `authenticated`, and `service_role`, exactly, always overwritten
 * regardless of what `driver` already carries — so a grant-less schema
 * still unlocks `db.as(asAnon())`/`db.as(asUser(...))` (task 6.3). Every
 * other member of `driver` passes through by reference (object spread),
 * so a future contract addition to {@link Driver} is carried automatically
 * for **own enumerable** properties — object spread's own boundary; a
 * prototype-chain or non-enumerable member would not be copied, and
 * neither this decorator nor its test would catch that (reviewer note,
 * batch A review). This file is a pure decorator: it never
 * imports a concrete driver implementation (e.g. `@hejbro/pg`), only the
 * `@hejbro/query` contract type — parallel-safe with group 5 by
 * construction (owner decision ①).
 */
export const supabaseDriver = (driver: Driver): Driver => ({
	...driver,
	contributedRoles: [anonRole, authenticatedRole, serviceRole],
});
