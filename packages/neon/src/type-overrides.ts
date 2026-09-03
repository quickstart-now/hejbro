import type { CustomTypesConfig } from "@neondatabase/serverless";
import { types as neonTypes } from "@neondatabase/serverless";

/**
 * Same builtin oids `@hejbro/pg` pins (`packages/pg/src/driver.ts`) --
 * duplicated here, never imported: a preset may only use `@hejbro/query`'s
 * driver contract type, never a concrete driver implementation
 * (`.claude/rules/provider-preset.md`). This is the only copy inside
 * this package (task 6.4); both drivers import it.
 */
const INTERVAL_OID = 1186;
const INTERVAL_ARRAY_OID = 1187;
const NUMERIC_ARRAY_OID = 1231;

/**
 * The per-statement `types` override every query on either connection
 * path sends: oid 1186/1187/1231 pass through as raw text for
 * `@hejbro/query`'s own conversion layer to parse, every other oid keeps
 * `@neondatabase/serverless`'s own default parser (its bundled
 * `pg-types` fallback, re-exported here as `neonTypes`). Without this,
 * Neon's client (its own bundled parsers, not `pg-types`) would hand
 * back a parsed `interval` object and an already-`parseFloat`'d
 * `numeric[]` -- the two arrival shapes the driver contract's
 * "Vanilla driver row arrival shapes" requirement forbids, one of them
 * lossy (`numeric`'s exact scale/precision).
 */
export const intervalPassthroughTypes: CustomTypesConfig = {
	getTypeParser: (oid, format) => {
		const oidValue = oid as number;
		if (
			oidValue === INTERVAL_OID ||
			oidValue === INTERVAL_ARRAY_OID ||
			oidValue === NUMERIC_ARRAY_OID
		) {
			return (value: string): string => value;
		}
		return neonTypes.getTypeParser(oid, format);
	},
};
