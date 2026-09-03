import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

/**
 * The Docker-gated live-witness suite's own config (group 6) -- mirrors
 * packages/pg/vitest.integration.config.ts, including its own reasoning
 * for staying separate from `vitest.config.ts` rather than extending it:
 * that config's own `exclude` carries the very patterns that keep these
 * files out of `pnpm test`, so inheriting it here would filter this
 * config's own `include` right back out. Longer `testTimeout` than the
 * default suite -- a real `docker run` plus a migration chain plus
 * several `hejbro check` runs against a live server is measured slower
 * than the subprocess CLI tests this package's own default config
 * already budgets 30s for.
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
