import { beforeEach, onTestFailed } from "vitest";
import { captureFailure } from "./failure-capture";

/**
 * #533: wires `captureFailure` into Vitest's own per-test `onTestFailed`
 * hook -- opt-in only (loaded via `vitest.config.ts`'s `setupFiles` when
 * someone is actively chasing a flake, not on every routine `pnpm test`
 * run). `onTestFailed` must be called while a test is "current", so it is
 * registered inside `beforeEach`, not at this module's own top level.
 *
 * Worker/pool identity is approximated from what a single test's own
 * process can see (`process.pid`, `VITEST_POOL_ID`/`VITEST_MAX_WORKERS`
 * if the active pool sets them) -- a full custom Reporter would see the
 * whole run's file list and could name concurrently-running suites
 * directly, but guessing that class's hook shapes against a version this
 * module hasn't been run against is worse than an honest gap: this
 * always emits `concurrentSuites: []`, not a guess.
 */
beforeEach(() => {
	onTestFailed((context) => {
		const [firstError] = context.task.result?.errors ?? [];
		captureFailure({
			testName: context.task.name,
			filePath: context.task.file?.filepath ?? "unknown",
			error: firstError ?? new Error("onTestFailed fired with no errors"),
			workerId: `pid-${process.pid}${
				process.env.VITEST_POOL_ID ? `/pool-${process.env.VITEST_POOL_ID}` : ""
			}`,
			poolSize: Number(process.env.VITEST_MAX_WORKERS ?? Number.NaN),
			concurrentSuites: [],
		});
	});
});
