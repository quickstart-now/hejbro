import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		coverage: {
			provider: "v8",
			// "json" is istanbul's coverage-final.json format (statementMap,
			// branchMap, fnMap with per-location hit counts) -- what
			// scripts/check-crap.mjs reads to compute per-function coverage.
			// "text" is for humans running this locally.
			reporter: ["json", "text"],
			include: ["src/**/*.ts"],
		},
	},
});
