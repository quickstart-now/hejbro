import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

export default defineConfig({
	resolve: {
		alias: hejbroSourceAlias,
	},
	test: {
		include: ["test/**/*.test.ts"],
		// Same exclusion shape as packages/pg's vitest.config.ts: the
		// Docker-gated integration suite (group 7) stays out of the default
		// `pnpm test`/CI run -- excluded by pattern, not a hardcoded
		// filename, so a future `include` widening can't silently pick it
		// back up.
		exclude: [
			...configDefaults.exclude,
			"test/**/*integration.test.ts",
			"test/integration/**",
		],
		coverage: {
			provider: "v8",
			reporter: ["json", "text"],
			include: ["src/**/*.ts"],
		},
	},
});
