import type { NumericMode } from "./column-builder";

/**
 * `bigint({mode})`'s default mode (task 3.4) — the one place this default is
 * spelled out (#310). `column-builder-factories.ts`'s `bigint()` reads this
 * constant's own runtime value; `ts-type-map.ts`'s `BaseScalarTsType` reads
 * its type (`typeof DEFAULT_BIGINT_MODE`) for the no-mode fallback — one
 * structurally shared literal, not two hand-spelled copies that could drift
 * apart.
 *
 * Lives in its own module, deliberately outside
 * `column-builder-factories.ts`'s own export surface: that file is swept by
 * `column-builder.test.ts`'s "every factory's mode is accounted for (C19)"
 * exhaustiveness check (`Object.keys(columnBuilderFactories)` against a
 * hand-maintained factory list), and exporting a non-factory value from
 * there would pollute that inventory (reproduced the false-positive red
 * before landing this module). **Never "fix" that by weakening C19's own
 * exhaustiveness assertion instead** — that check is what caught the
 * original drift risk; the fix belongs on this side of the boundary, not on
 * C19's.
 */
export const DEFAULT_BIGINT_MODE = "bigint" as const satisfies NumericMode;

/**
 * `numeric({mode})`'s default mode (task 3.4) — see
 * {@link DEFAULT_BIGINT_MODE} for why this lives here and stays out of
 * `column-builder-factories.ts`'s own export surface. `numeric`'s own
 * default differs (`'string'`, not `'bigint'`) since a `numeric` column can
 * be fractional, where `bigint` never is.
 */
export const DEFAULT_NUMERIC_MODE = "string" as const satisfies NumericMode;
