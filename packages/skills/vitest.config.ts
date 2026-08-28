import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		// snippet-compile.test.ts type-checks the whole dependency graph
		// behind every `paths` entry (core/query/pg/cli/supabase) in one
		// `ts.Program` — the default 5s budget is tight on a cold cache.
		testTimeout: 20_000,
	},
});
