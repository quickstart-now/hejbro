// @hejbro/supabase — the first provider preset, built ONLY on the public
// provider extension interface of @hejbro/core (object kinds, role presets,
// expression helpers, reserved-schema protection). If implementing this
// package requires a special case inside core, the core interface is wrong —
// fix the interface instead. Neon and Nile presets will follow the same path.
// See /docs/specs/2026-08-19-hejbro-design.md before implementing anything here.

import type { Validator } from "@hejbro/core";
import { exposedTableValidator } from "./validators/exposed-tables";
import { reservedSchemaValidator } from "./validators/reserved-schemas";
import { viewSecurityInvokerValidator } from "./validators/view-security-invoker";

export { authJwt, authUid } from "./auth";
export { authUsers } from "./auth-tables";
export { anonRole, authenticatedRole, serviceRole } from "./roles";
export { exposedTableValidator } from "./validators/exposed-tables";
export {
	reservedSchemas,
	reservedSchemaValidator,
} from "./validators/reserved-schemas";
export { viewSecurityInvokerValidator } from "./validators/view-security-invoker";

/** All three Supabase preset validators (D38/D40/#66 view-security-invoker), in the order `generateMigration` should run them. */
export const supabaseValidators: ReadonlyArray<Validator> = [
	reservedSchemaValidator,
	exposedTableValidator,
	viewSecurityInvokerValidator,
];
