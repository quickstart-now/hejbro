import { resolve } from "node:path";

/**
 * The alias pair every vitest config in this example shares (mirrors
 * `packages/pg/vitest.shared.ts`'s own reasoning) — `hejbro`/`@hejbro/core`/
 * `@hejbro/query`/`@hejbro/pg` all resolve straight to their public entry
 * points in source, never `dist/index.js`, so a test can't silently pass
 * against a stale build when vitest is invoked directly (outside turbo's
 * `^build` dependency graph). All four, not just the two `vitest.config.ts`
 * needed before #474 3.3: `test/integration.test.ts` imports `@hejbro/pg`
 * directly and `db()` (via `hejbro`, itself source-aliased) pulls in
 * `@hejbro/query` transitively — leaving either unaliased would resolve it
 * against `node_modules`' built `dist`, and if that dist's own `@hejbro/core`
 * import were ALSO unaliased, a single test run could end up with two
 * separate `@hejbro/core` module instances (source here, dist inside
 * `@hejbro/query`'s own dependency tree) — exactly what `packages/cli/
 * vitest.config.ts`'s `dedupe: ["@hejbro/core"]` exists to prevent one
 * level up.
 *
 * Exported once and imported by both `vitest.config.ts` and `vitest.
 * integration.config.ts` — a copy in each file would drift silently (the
 * integration config is never exercised in CI, so a missed alias there
 * would go unnoticed until someone ran it locally against a stale `dist`).
 */
export const hejbroSourceAlias = {
	hejbro: resolve(import.meta.dirname, "../../packages/cli/src/index.ts"),
	"@hejbro/core": resolve(
		import.meta.dirname,
		"../../packages/core/src/index.ts",
	),
	"@hejbro/query": resolve(
		import.meta.dirname,
		"../../packages/query/src/index.ts",
	),
	"@hejbro/pg": resolve(import.meta.dirname, "../../packages/pg/src/index.ts"),
};
