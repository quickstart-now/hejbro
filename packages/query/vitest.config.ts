import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// #131: resolves `@hejbro/core` straight to its public entry point in
	// source, not `dist/index.js` — otherwise this package's tests can
	// pass against a stale build when vitest is invoked directly (outside
	// turbo's `^build` dependency graph). The public index only, never a
	// deep `../core/src/...` path.
	resolve: {
		alias: {
			"@hejbro/core": resolve(import.meta.dirname, "../core/src/index.ts"),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["json", "text"],
			include: ["src/**/*.ts"],
		},
	},
});
