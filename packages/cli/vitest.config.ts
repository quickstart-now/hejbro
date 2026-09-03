import { configDefaults, defineConfig } from "vitest/config";
import { hejbroSourceAlias } from "./vitest.shared.ts";

export default defineConfig({
	test: {
		// #533: the capture harness is wired in permanently, not on
		// request -- see failure-capture-setup.ts's own doc comment. It
		// writes nothing on a green path (onTestFailed never fires, and
		// dumpTranscript no-ops on an empty transcript), so this carries
		// no cost for a routine passing run.
		setupFiles: ["./test/support/failure-capture-setup.ts"],
		include: ["test/**/*.test.ts"],
		// Group 6's Docker-gated live-server suite stays out of the
		// default `pnpm test`/CI run (packages/pg's own split, same
		// reasoning) -- excluded by *pattern*, not a hardcoded filename,
		// matching packages/pg/vitest.config.ts's own comment on this
		// exact pair of patterns. `configDefaults` is spread first so
		// vitest's own exclusions are never lost.
		exclude: [
			...configDefaults.exclude,
			"test/**/*integration.test.ts",
			"test/integration/**",
		],
		// Informational only -- #154 scopes the CRAP gate to @hejbro/core and
		// @hejbro/supabase, not this package. This in-process number
		// undercounts packages/cli/src/commands specifically: those are
		// exercised end-to-end through a spawned child process (see
		// scripts/check-crap.mjs's file comment), which V8 coverage can't see.
		coverage: {
			provider: "v8",
			reporter: ["json", "text"],
			include: ["src/**/*.ts"],
		},
		// Most of this package's own tests (generate-command.test.ts,
		// golden.test.ts, verify.test.ts, flag-equals.test.ts) drive the
		// built CLI via child_process through test/support/cli-runner.ts,
		// same as examples/{cli-smoke,postgres,supabase}'s e2e tests --
		// which already carry this exact `testTimeout: 30_000` (added in
		// #90, well before #117). This package's own vitest.config.ts was
		// the one config in that family that never got it, and it's what
		// broke: a real CI run (dev@67b9670's first check) hit vitest's
		// 5s default and failed test/verify.test.ts:106 on the node 22
		// leg only (node 24 and this same PR's own re-run both passed) --
		// a flake, not a regression, from CI-runner contention that
		// pushes a spawned-subprocess test past 5s under load,
		// intermittently. Measured locally (not guessed): three repeated
		// full-suite runs on this machine put the slowest single test
		// between ~1.7s and ~3.2s, varying by which test happened to be
		// slowest each run (contention among parallel subprocess-spawning
		// tests, not one consistently slow test) -- 30s matches the
		// sibling configs and gives roughly 10x headroom over the worst
		// observed here.
		//
		// Distinct from #117 (which hardened the e2e harness for a
		// different root cause -- jiti's fs cache going stale across
		// repeated CLI invocations within one test run -- and did not
		// touch any vitest.config.ts's testTimeout): that fix didn't
		// cover this gap because it wasn't the same failure mode.
		testTimeout: 30_000,
	},
	resolve: {
		// loader.test.ts's fixtures are loaded through jiti, which imports
		// "@hejbro/core" via its own module resolution; without dedupe, Vite's
		// SSR transform can instantiate a second copy of the module, giving
		// `tableMeta` (a per-instance Symbol()) two different identities and
		// making `isTable()` return false across the boundary — this forces a
		// single shared instance, matching real (non-test) Node module caching.
		dedupe: ["@hejbro/core"],
		// #131 aliases, shared with vitest.integration.config.ts (group 6)
		// via vitest.shared.ts rather than duplicated -- see that file's
		// own comment (a copy here would drift silently since the
		// integration config never runs in CI). Covers this package's own
		// in-process tests (config.test.ts, diagnostics.test.ts,
		// rename-diagnostics.test.ts, loader.test.ts); the subprocess e2e
		// tests (generate-command.test.ts etc., which spawn the built
		// `dist/cli.js`) are unaffected either way -- a child process
		// resolves modules on its own, outside this vitest process's
		// module graph -- and get a dist-freshness guard instead
		// (test/support/cli-runner.ts).
		alias: hejbroSourceAlias,
	},
});
