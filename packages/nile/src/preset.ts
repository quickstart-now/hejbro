import type {
	HejbroDeclaration,
	ObjectKind,
	Preset,
	Validator,
} from "@hejbro/core";
import {
	nileFunctionTriggerValidator,
	nileGrantValidator,
	nileRlsValidator,
	nileSerialValidator,
} from "./validators";

/**
 * The Nile preset's own object kinds (task 1.2, #563) -- empty: the
 * platform's tenant-aware tables are ordinary declared tables (a plain
 * `tenant_id uuid` column, no dedicated kind), and this preset registers
 * no `ObjectKind` of its own the way `@hejbro/supabase`'s storage bucket
 * kind does. Reserved as a real (empty, not omitted) array so a reader
 * of {@link nilePreset} sees the decision stated, not merely absent.
 */
const nileKinds: ReadonlyArray<ObjectKind<HejbroDeclaration>> = [];

/**
 * The Nile preset's own validators (task 1.2/4.1-4.4, #563/#566) -- the
 * platform-refusal set attached additively here, never by replacing this
 * array's own declaration site: RLS/policies, functions/triggers, grants,
 * and the tenant-aware serial family, each with its own evidence grade
 * (`packages/nile/src/validators.ts`).
 */
const nileValidators: ReadonlyArray<Validator> = [
	nileRlsValidator,
	nileFunctionTriggerValidator,
	nileGrantValidator,
	nileSerialValidator,
];

/**
 * The Nile preset as a config-listable data object (D55):
 * `presets: [nilePreset]` in `hejbro.config.ts`. Registrable today with
 * both arrays empty -- `registerPresets`/`presetValidators` (core) treat
 * an empty preset as a no-op contribution, never an error -- so this
 * bundle is a real, usable `Preset` value from the moment the package
 * ships, before group 4 gives it anything to refuse.
 */
export const nilePreset: Preset = {
	name: "nile",
	kinds: nileKinds,
	validators: nileValidators,
};
