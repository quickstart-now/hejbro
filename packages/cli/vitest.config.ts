import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		// Informational only -- #154 scopes the CRAP gate to @hejbro/core and
		// @hejbro/supabase, not this package. This in-process number
		// undercounts packages/cli/src/commands specifically: those are
		// exercised end-to-end through a spawned child process (see
		// scripts/check-crap.mjs's file comment), which V8 coverage can't see.
		coverage: {
			provider: "v8",
			reporter: ["json", "text"],
			include: ["src/**/*.ts"],
		},
	},
	// loader.test.ts's fixtures are loaded through jiti, which imports
	// "@hejbro/core" via its own module resolution; without dedupe, Vite's
	// SSR transform can instantiate a second copy of the module, giving
	// `tableMeta` (a per-instance Symbol()) two different identities and
	// making `isTable()` return false across the boundary — this forces a
	// single shared instance, matching real (non-test) Node module caching.
	resolve: { dedupe: ["@hejbro/core"] },
});
