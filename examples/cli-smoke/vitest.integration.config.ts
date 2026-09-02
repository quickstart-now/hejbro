import { configDefaults, defineConfig } from "vitest/config";

/**
 * The Docker-gated live-witness suite's own config (#587 3.2) — mirrors
 * `examples/postgres/vitest.integration.config.ts` and
 * `packages/{cli,pg}/vitest.integration.config.ts`'s own reasoning for
 * staying separate from `vitest.config.ts` rather than extending it:
 * that config's own `exclude` carries the very patterns that keep these
 * files out of `pnpm test`, so inheriting it here would filter this
 * config's own `include` right back out. No `hejbroSourceAlias`, unlike
 * those sibling configs — every live call in this suite runs through a
 * spawned `node` process against a real, symlinked `node_modules/hejbro`
 * (the built CLI's own `hejbro` re-export) and `node_modules/@hejbro/pg`,
 * never an in-process import of either package by this vitest process
 * itself, so there is nothing here for an alias to redirect.
 */
export default defineConfig({
	test: {
		include: ["test/**/*integration.test.ts", "test/integration/**/*.test.ts"],
		exclude: configDefaults.exclude,
		testTimeout: 120_000,
	},
});
