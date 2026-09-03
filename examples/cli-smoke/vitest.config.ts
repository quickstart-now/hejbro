import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		// #587 3.2's Docker-gated live-witness suite stays out of the
		// default `pnpm test`/CI run — local-only, its own `vitest.
		// integration.config.ts`, the same convention `examples/postgres`
		// and `packages/{cli,pg}` already established. Excluded by
		// *pattern*, not a hardcoded filename, for the same reason those
		// configs give.
		exclude: [
			...configDefaults.exclude,
			"test/**/*integration.test.ts",
			"test/integration/**",
		],
		// The e2e test drives the built CLI via child_process (not
		// in-process), so no dedupe trick is needed here — see
		// packages/cli/test/support/cli-runner.ts for the fuller
		// rationale this fixture's own runner mirrors. Every case here
		// spawns the built CLI several times and a real `tsc`; under a
		// full parallel `pnpm test` on a shared runner one case measured
		// 30.09s against the old 30s ceiling (#673) — the ceiling is for
		// a hang, not for a slow but healthy run.
		testTimeout: 120_000,
	},
});
