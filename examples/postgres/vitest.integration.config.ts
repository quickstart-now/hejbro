import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The Docker-gated integration suite's own config (#474 3.3) — deliberately
 * **not** the default `vitest.config.ts` plus an override: that config's
 * own `exclude` carries the very patterns that keep this file out of
 * `pnpm test`, so inheriting it here would filter this config's own
 * `include` right back out (same reasoning `packages/pg/
 * vitest.integration.config.ts` already documents; this file mirrors it
 * one level up, for the same Docker/local-only convention). The alias pair
 * is duplicated from `vitest.config.ts` rather than shared, on purpose:
 * this suite never runs in CI, so a hand-copied alias here is exactly the
 * kind of silent drift that could let it alone resolve against a stale
 * `dist` while the default config stays correct, unnoticed.
 */
export default defineConfig({
	resolve: {
		alias: {
			hejbro: resolve(import.meta.dirname, "../../packages/cli/src/index.ts"),
			"@hejbro/core": resolve(
				import.meta.dirname,
				"../../packages/core/src/index.ts",
			),
		},
	},
	test: {
		include: ["test/**/*integration.test.ts", "test/integration/**/*.test.ts"],
		exclude: configDefaults.exclude,
		testTimeout: 60_000,
	},
});
