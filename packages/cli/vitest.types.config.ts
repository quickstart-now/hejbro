import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

/**
 * #673 candidate `c`: `declare-emit-callback-shadow.types.test.ts` spawns
 * a real `tsc` and competes for CPU with every other workspace's vitest
 * workers under a full parallel `pnpm test`. Moved to its own turbo task
 * (`test:types`), run only after the root script's own `turbo run test`
 * has finished (root `package.json`'s `&&`, not `dependsOn` -- turbo's
 * per-package graph can't express "after every package's `test`").
 */
export default defineConfig({
	test: {
		// #533: this is the suite that was actually dying under load
		// (declare-emit-callback-shadow.types.test.ts, base32/b32's own
		// failing file) -- the capture harness must cover it too, not
		// only vitest.config.ts's own default suite.
		setupFiles: ["./test/support/failure-capture-setup.ts"],
		include: ["test/**/*.types.test.ts"],
		exclude: [
			...configDefaults.exclude,
			"test/**/*integration.test.ts",
			"test/integration/**",
		],
		// Same rationale and value as vitest.config.ts's own
		// `testTimeout` -- this file is one of the subprocess-spawning
		// suites that comment documents.
		testTimeout: 30_000,
	},
	resolve: {
		// Same as vitest.config.ts's own `resolve` -- see that file's
		// comment. This test's fixtures load through jiti the same way
		// loader.test.ts's do.
		dedupe: ["@hejbro/core"],
		alias: hejbroSourceAlias,
	},
});
