import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

/**
 * The only vitest config this package has (#714) -- every test here is
 * Docker-gated, local-only (D49), never run under `pnpm test`/CI. Mirrors
 * `examples/postgres/vitest.integration.config.ts` and `packages/cli/
 * vitest.integration.config.ts`'s own reasoning for staying separate from
 * a default `vitest.config.ts` rather than extending one: there is no
 * default config here to extend or drift from, since this package has no
 * plain `test` script (no `*.test.ts` outside `test/**​/*integration.test.ts`
 * -- see package.json's own comment for why one wasn't added).
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
