import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

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
			// #131, same reasoning as the @hejbro/core alias above: resolves
			// straight to source so this package's tests never pass against a
			// stale (or, since @hejbro/query is source-pointing, nonexistent)
			// build.
			"@hejbro/query": resolve(import.meta.dirname, "../query/src/index.ts"),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		// Task 6.4 (real-stack RLS integration) lives outside the default
		// `pnpm test`/CI gate -- it needs a live `supabase start` stack and
		// stays local-only (roundtrip.sh convention, group 5 header). Two
		// patterns, not one: the suffix form catches a same-directory file
		// named `*.integration.test.ts` (6.4's own
		// `rls-context.integration.test.ts`), the directory form catches a
		// future `test/integration/**` layout -- a suite that grows into a
		// directory must not silently rejoin the default gate. Spreads
		// `configDefaults.exclude` rather than replacing it, so vitest's own
		// defaults (`node_modules`, etc.) aren't lost.
		exclude: [
			...configDefaults.exclude,
			"test/**/*integration.test.ts",
			"test/integration/**",
		],
		coverage: {
			provider: "v8",
			reporter: ["json", "text"],
			include: ["src/**/*.ts"],
		},
	},
});
