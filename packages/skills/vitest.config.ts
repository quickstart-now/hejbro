import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		// snippet-compile.test.ts type-checks the whole dependency graph
		// behind every `paths` entry (core/query/pg/cli/supabase) in one
		// `ts.Program` — the default 5s budget is tight on a cold cache.
		//
		// 60s, not 20s: on GitHub's runners this test measured 15.7s, 18.5s
		// and 19.4s across three unrelated branches on 2026-08-28 — passing,
		// but one slow runner from flaking, with nothing about the change
		// under test to blame. A 2.2s local run (this machine) is ~8x faster
		// than the same test in CI, so the budget has to be sized for the
		// slow end, not the fast one. The real fix is to stop building a
		// fresh `ts.Program` per snippet; until then this is a budget, not a
		// speed limit — if a change ever pushes it near 60s, that IS a
		// finding.
		testTimeout: 60_000,
	},
});
