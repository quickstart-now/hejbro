import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

/**
 * The Docker-gated integration suite's own config (#474 3.3) — deliberately
 * **not** the default `vitest.config.ts` plus an override: that config's
 * own `exclude` carries the very patterns that keep this file out of
 * `pnpm test`, so inheriting it here would filter this config's own
 * `include` right back out (same reasoning `packages/pg/
 * vitest.integration.config.ts` already documents; this file mirrors it
 * one level up, for the same Docker/local-only convention). The alias
 * comes from `./vitest.shared.ts` — **shared**, not copied, with `vitest.
 * config.ts`: this suite never runs in CI, so a hand-copied alias here
 * would be exactly the kind of silent drift that could let it alone
 * resolve against a stale `dist` while the default config stayed correct,
 * unnoticed. `hejbroSourceAlias` covers all four of `hejbro`/`@hejbro/
 * core`/`@hejbro/query`/`@hejbro/pg` — this suite is the one test file in
 * the example that imports `@hejbro/pg` directly and drives `db()`
 * through a real driver, so leaving either of the query-layer packages
 * unaliased would resolve them against `node_modules`' built `dist`
 * instead (see `vitest.shared.ts`'s own doc comment for why that risks a
 * duplicate `@hejbro/core` module instance in one process).
 */
export default defineConfig({
	resolve: {
		alias: hejbroSourceAlias,
	},
	test: {
		include: ["test/**/*integration.test.ts", "test/integration/**/*.test.ts"],
		exclude: configDefaults.exclude,
		testTimeout: 60_000,
	},
});
