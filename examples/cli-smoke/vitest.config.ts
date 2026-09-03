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
			// #673 candidate `c`: moved to vitest.types.config.ts's own
			// `test:types` turbo task, run after this one.
			"test/**/*.types.test.ts",
		],
		// Every case here drives the built CLI via child_process (not
		// in-process), so no dedupe trick is needed — see
		// packages/cli/test/support/cli-runner.ts for the fuller
		// rationale this fixture's own runner mirrors.
		//
		// G3.2 (2026-09-04): kept at 120_000, half of #730's raise --
		// `e2e.types.test.ts` (the other tsc-spawning file) moved to
		// vitest.types.config.ts's own 30s, but this file's own suite is
		// now just `vendored-contract.test.ts` (§2's 2026-09-04
		// correction: it spawns a real `tsc` too, `TSC_PATH`/`execFile`),
		// which stays in the contended `test` phase and measured
		// 24 168ms at 32 burners here (c32-L1.log) -- only 1.24x headroom
		// under a 30s ceiling, and the same suite that measured 30.09s on
		// GitHub's own runner (#673, PR #289 run 33720669210).
		testTimeout: 120_000,
	},
});
