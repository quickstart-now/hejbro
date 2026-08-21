// @hejbro/supabase — the first provider preset, built ONLY on the public
// provider extension interface of @hejbro/core (object kinds, role presets,
// expression helpers, reserved-schema protection). If implementing this
// package requires a special case inside core, the core interface is wrong —
// fix the interface instead. Neon and Nile presets will follow the same path.
// See /docs/specs/2026-08-19-hejbro-design.md before implementing anything here.

import type {
	HejbroDeclaration,
	KindRegistry,
	ObjectKind,
	Preset,
	Validator,
} from "@hejbro/core";
import { storageBucketKind } from "./storage/bucket-kind";
import { exposedTableValidator } from "./validators/exposed-tables";
import { reservedSchemaValidator } from "./validators/reserved-schemas";
import { viewSecurityInvokerValidator } from "./validators/view-security-invoker";

export { authJwt, authJwtCached, authUid, authUidCached } from "./auth";
export { authUsers } from "./auth-tables";
export { anonRole, authenticatedRole, serviceRole } from "./roles";
export type {
	StorageBucketDeclaration,
	StorageBucketOptions,
} from "./storage/bucket";
export { storageBucket } from "./storage/bucket";
export type { StorageBucketSnapshot } from "./storage/bucket-kind";
export { storageBucketKind } from "./storage/bucket-kind";
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

/** The Supabase preset as a config-listable data object (D55): `presets: [supabasePreset]` in `hejbro.config.ts`. The cast to the erased `ObjectKind<HejbroDeclaration>` is sanctioned (a registry is heterogeneous across kinds), like `roleName()`'s `as Role` in core. */
export const supabasePreset: Preset = {
	name: "supabase",
	kinds: [storageBucketKind as ObjectKind<HejbroDeclaration>],
	validators: supabaseValidators,
};

/** Registers every Supabase preset object kind (currently `storageBucketKind`) into `registry`. */
export const registerSupabaseKinds = (registry: KindRegistry): void => {
	registry.register(storageBucketKind);
};
