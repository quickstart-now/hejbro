import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// #131: resolves `@hejbro/core` straight to its public entry point in
	// source, not `dist/index.js` -- otherwise this package's tests can
	// pass against a stale build when vitest is invoked directly (outside
	// turbo's `^build` dependency graph), the same mechanism
	// `packages/core`'s own tests already get for free by importing from
	// `../src`. The public index only (never a deep `../core/src/...`
	// path) -- this package may only use core's public extension
	// interface (provider-preset boundary rule). Packaging/export-surface
	// coverage (a missing file, a broken `exports` map) is `pnpm
	// smoke:pack-install`'s job, not a per-package unit test's.
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
