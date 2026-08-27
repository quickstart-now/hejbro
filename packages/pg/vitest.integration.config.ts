import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

/**
 * The Docker-gated integration suite's own config (task 5.6, owner
 * decision ⑤) -- deliberately **not** the default `vitest.config.ts`
 * plus an override: that config's own `exclude` carries the very
 * patterns that keep these files out of `pnpm test`, so inheriting it
 * here would filter this config's own `include` right back out. Shares
 * {@link hejbroSourceAlias} rather than copying it -- a hand-copied
 * alias here is exactly the kind of silent drift that would let this
 * config alone resolve against a stale `dist` while `vitest.config.ts`
 * stays correct, unnoticed because this suite never runs in CI.
 */
export default defineConfig({
	resolve: {
		alias: hejbroSourceAlias,
	},
	test: {
		include: ["test/**/*integration.test.ts", "test/integration/**/*.test.ts"],
		exclude: configDefaults.exclude,
	},
});
