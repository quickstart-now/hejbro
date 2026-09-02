import { resolve } from "node:path";

/**
 * Mirrors `examples/postgres/vitest.shared.ts`'s own reasoning (this
 * package has no default `vitest.config.ts`/`pnpm test` at all -- every
 * test here is Docker-gated, `test:integration` only -- so this alias is
 * consumed by exactly one config): `hejbro`/`@hejbro/core` resolve
 * straight to their public entry points in source, never `dist/index.js`,
 * so `test:integration` invoked directly (outside turbo's `^build`
 * dependency graph) can't silently pass against a stale build for
 * anything this suite imports in-process. The suite also spawns the
 * *built* CLI (`dist/cli.js`) via `execFile`, which this alias has no
 * effect on -- `test/support/cli-runner.ts`'s own `assertBuiltCli` covers
 * that half.
 */
export const hejbroSourceAlias = {
	hejbro: resolve(import.meta.dirname, "../../packages/cli/src/index.ts"),
	"@hejbro/core": resolve(
		import.meta.dirname,
		"../../packages/core/src/index.ts",
	),
};
