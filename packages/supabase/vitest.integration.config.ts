import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

/**
 * `pnpm test:integration`'s own config (task 6.4) — `mergeConfig`
 * inherits `vitest.config.ts` wholesale (the #131 `@hejbro/core`/
 * `@hejbro/query` source aliases included, never hand-copied: a manual
 * copy here would silently drift to a stale path the moment the base
 * config's alias changes, and nothing in CI would catch it since this
 * config never runs there).
 *
 * `include`/`exclude` are applied as a **plain object spread after**
 * `mergeConfig`, not through `mergeConfig` itself — Vite's `mergeConfig`
 * concatenates array-valued config fields rather than replacing them
 * (confirmed by running this file: passing `exclude: []` to
 * `mergeConfig` still left the base config's own
 * `test/**​/*.integration.test.ts` exclusion pattern in the merged
 * result, silently excluding the very file this config exists to run,
 * while `include`'s concatenation meant the base's `test/**​/*.test.ts`
 * pattern *also* stayed active — the merged config quietly ran the
 * default unit suite instead of the integration one, passing green with
 * zero integration tests actually collected). The base config's own
 * `exclude` is exactly what keeps `*.integration.test.ts` out of the
 * default gate, so inheriting it unreplaced here would defeat this
 * config's only reason to exist.
 */
const merged = mergeConfig(baseConfig, defineConfig({ test: {} }));

export default defineConfig({
	...merged,
	test: {
		...merged.test,
		include: ["test/**/*.integration.test.ts"],
		exclude: [],
	},
});
