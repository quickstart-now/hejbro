import { configDefaults, defineConfig } from "vitest/config";

/**
 * #673 candidate `c`: `e2e.types.test.ts` spawns the built CLI several
 * times and a real `tsc`. Moved to its own turbo task (`test:types`),
 * run only after the root script's own `turbo run test` has finished
 * (root `package.json`'s `&&`, not `dependsOn` -- turbo's per-package
 * graph can't express "after every package's `test`").
 */
export default defineConfig({
	test: {
		include: ["test/**/*.types.test.ts"],
		exclude: [
			...configDefaults.exclude,
			"test/**/*integration.test.ts",
			"test/integration/**",
		],
		// G3.2 (2026-09-04): reverted to the sibling 30s ceiling, half of
		// #730's 120s raise -- this file's own suite (e2e.types.test.ts)
		// now runs isolated in the test:types phase, and its slowest case
		// measured 15 182ms at 32 burners here (c32-L1.log), 1.98x
		// headroom. vitest.config.ts's own testTimeout stays 120_000: the
		// third tsc-spawning file (vendored-contract.test.ts, §2's
		// 2026-09-04 correction) is not moved by candidate `c` and stays
		// in the contended `test` phase, where it measured 24 168ms at 32
		// burners -- only 1.24x headroom under 30s, and the same suite
		// that measured 30.09s on GitHub's own runner (#673, PR #289 run
		// 33720669210).
		testTimeout: 30_000,
	},
});
