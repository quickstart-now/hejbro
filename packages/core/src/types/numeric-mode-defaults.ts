import type { NumericMode } from "./column-builder";

/**
 * `bigint({mode})`'s default mode (task 3.4) — the one place this default is
 * spelled out (#310). `column-builder-factories.ts`'s `bigint()` reads this
 * constant's own runtime value; `ts-type-map.ts`'s `BaseScalarTsType` reads
 * {@link DefaultBigintMode} (this constant's own type) for the no-mode
 * fallback — one structurally shared literal, not two hand-spelled copies
 * that could drift apart.
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
 *
 * Also never added to `@hejbro/core`'s own public barrel (`src/index.ts`):
 * these two constants are internal wiring between
 * `column-builder-factories.ts` and `ts-type-map.ts`, not part of the
 * package's public API surface, and exporting them there would be a public
 * API change this task never decided.
 */
export const DEFAULT_BIGINT_MODE = "bigint" as const satisfies NumericMode;

/** {@link DEFAULT_BIGINT_MODE}'s own type — what `ts-type-map.ts`'s no-mode fallback for `bigint` resolves to. */
export type DefaultBigintMode = typeof DEFAULT_BIGINT_MODE;

/**
 * `numeric({mode})`'s default mode (task 3.4) — see
 * {@link DEFAULT_BIGINT_MODE} for why this lives here and stays out of both
 * `column-builder-factories.ts`'s own export surface and core's public
 * barrel. `numeric`'s own default differs (`'string'`, not `'bigint'`)
 * since a `numeric` column can be fractional, where `bigint` never is.
 */
export const DEFAULT_NUMERIC_MODE = "string" as const satisfies NumericMode;

/** {@link DEFAULT_NUMERIC_MODE}'s own type — what `ts-type-map.ts`'s no-mode fallback for `numeric` resolves to. */
export type DefaultNumericMode = typeof DEFAULT_NUMERIC_MODE;
