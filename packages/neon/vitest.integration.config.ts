import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

/**
 * The Docker-gated local witness suite's own config (task 7.1, mirrors
 * `packages/pg`'s own `vitest.integration.config.ts`) -- deliberately
 * **not** the default `vitest.config.ts` plus an override: that config's
 * own `exclude` carries the very patterns that keep these files out of
 * `pnpm test`/CI, so inheriting it here would filter this config's own
 * `include` right back out. Shares {@link hejbroSourceAlias} rather than
 * copying it -- a hand-copied alias here is exactly the kind of silent
 * drift that would let this config alone resolve against a stale `dist`
 * while `vitest.config.ts` stays correct, unnoticed because this suite
 * never runs in CI.
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
