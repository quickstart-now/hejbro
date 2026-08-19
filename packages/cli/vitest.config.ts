import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["test/**/*.test.ts"] },
	// loader.test.ts's fixtures are loaded through jiti, which imports
	// "@hejbro/core" via its own module resolution; without dedupe, Vite's
	// SSR transform can instantiate a second copy of the module, giving
	// `tableMeta` (a per-instance Symbol()) two different identities and
	// making `isTable()` return false across the boundary — this forces a
	// single shared instance, matching real (non-test) Node module caching.
	resolve: { dedupe: ["@hejbro/core"] },
});
