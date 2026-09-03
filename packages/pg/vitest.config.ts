import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

export default defineConfig({
	resolve: {
		alias: hejbroSourceAlias,
	},
	test: {
		include: ["test/**/*.test.ts"],
		// Owner decision ⑤ (tasks.md group 5 header): the Docker-gated
		// integration suite (task 5.6) stays out of the default `pnpm
		// test`/CI run -- local-only, never CI. Excluded here (not just
		// left out of `include`, which alone wouldn't stop a future
		// `include` widening from picking it back up) by *pattern*, not a
		// hardcoded filename: `test/**/*integration.test.ts` catches both
		// the flat `test/integration.test.ts` tasks.md 5.6 names and any
		// `*.integration.test.ts` suffix form, and `test/integration/**`
		// catches the common next step of a single integration file
		// growing into its own directory -- a bare filename pattern would
		// silently stop matching the moment that happens. `configDefaults`
		// is spread first so vitest's own exclusions (`node_modules`, …)
		// are never lost.
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
