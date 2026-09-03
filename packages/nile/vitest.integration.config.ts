import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

/**
 * The Docker-gated local witness suite's own config (task 5.1, #567,
 * mirrors `packages/neon`'s own `vitest.integration.config.ts`) --
 * deliberately **not** the default `vitest.config.ts` plus an override:
 * that config's own `exclude` carries the very patterns that keep these
 * files out of `pnpm test`/CI, so inheriting it here would filter this
 * config's own `include` right back out.
 */
export default defineConfig({
	resolve: {
		alias: hejbroSourceAlias,
	},
	test: {
		include: ["test/integration/**/*.integration.test.ts"],
		exclude: configDefaults.exclude,
		testTimeout: 30_000,
	},
});
