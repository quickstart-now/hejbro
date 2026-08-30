import { resolve } from "node:path";

/**
 * The #131 alias pair every vitest config in this package shares --
 * `@hejbro/core`/`@hejbro/query` resolve straight to their public entry
 * points in source, never `dist/index.js`, so a test can't silently pass
 * against a stale build when vitest is invoked directly (outside turbo's
 * `^build` dependency graph). Public entry points only, never a deep
 * `../query/src/db/...` path -- except the one named exception below.
 *
 * Exported once and imported by both `vitest.config.ts` and
 * `vitest.integration.config.ts` -- a copy in each file would drift
 * silently (the integration config is never exercised in CI, so a
 * missed alias there would go unnoticed until someone ran it locally
 * against a stale `dist`).
 */
export const hejbroSourceAlias = {
	"@hejbro/core": resolve(import.meta.dirname, "../core/src/index.ts"),
	// #481: the one named exception to "public entry points only" above --
	// the repo-internal conformance kit's only way in. Must precede the
	// shorter `@hejbro/query` key below, or Vite's prefix-matching alias
	// resolution mangles this specifier into the wrong path.
	"@hejbro/query/testing/driver-conformance": resolve(
		import.meta.dirname,
		"../query/src/testing/driver-conformance.ts",
	),
	"@hejbro/query": resolve(import.meta.dirname, "../query/src/index.ts"),
};
