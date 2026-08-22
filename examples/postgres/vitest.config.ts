import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// #131: chain.test.ts runs in-process against "hejbro"'s (and
	// transitively "@hejbro/core"'s) public entry point in source, not
	// dist -- see packages/supabase/vitest.config.ts for the full
	// rationale. cli.test.ts drives the built CLI via child_process
	// instead, unaffected either way (a child process resolves modules on
	// its own); it gets a dist-freshness guard instead
	// (packages/cli/test/support/cli-runner.ts).
	resolve: {
		alias: {
			hejbro: resolve(import.meta.dirname, "../../packages/cli/src/index.ts"),
			"@hejbro/core": resolve(
				import.meta.dirname,
				"../../packages/core/src/index.ts",
			),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		// The e2e test drives the built CLI via child_process (not
		// in-process), so no dedupe trick is needed here — see
		// packages/cli/test/support/cli-runner.ts for the fuller
		// rationale this fixture's own runner mirrors.
		testTimeout: 30_000,
	},
});
