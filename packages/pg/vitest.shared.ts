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
	// #481 (enforce-driver-contract, task 1.4/1.7): the one deliberate
	// exception to "public entry points only" above -- the driver
	// conformance kit is repo-internal by ratified decision (never
	// `./index.ts`, never `package.json`'s `exports` map), so this test
	// file is its only way in. A named, single-file alias, not a
	// directory mapping into `../query/src/`, so no other internal stays
	// reachable by accident. Declared *before* the plain `@hejbro/query`
	// entry below -- Vite's alias resolution treats a string `find` as
	// matching either an exact id or `id + "/"` prefix, in array/object
	// insertion order, so the shorter `@hejbro/query` key would otherwise
	// prefix-match this specifier first and mangle it into
	// `.../index.ts/testing/driver-conformance` (measured).
	"@hejbro/query/testing/driver-conformance": resolve(
		import.meta.dirname,
		"../query/src/testing/driver-conformance.ts",
	),
	"@hejbro/query": resolve(import.meta.dirname, "../query/src/index.ts"),
};
