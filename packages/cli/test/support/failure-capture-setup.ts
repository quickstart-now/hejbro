import { beforeEach, onTestFailed } from "vitest";
import { dumpTranscript, transcript } from "./call-transcript";
import { captureFailure } from "./failure-capture";

/** `pid-<pid>` plus `/pool-<id>` when vitest assigned a pool id (workers only; the main process has none). */
const workerIdOf = (pid: number, poolId: string | undefined): string => {
	if (poolId === undefined || poolId === "") {
		return `pid-${pid}`;
	}
	return `pid-${pid}/pool-${poolId}`;
};

/**
 * #533: wires `captureFailure` and the call transcript into vitest's own
 * per-test `onTestFailed` hook. Registered by `vitest.config.ts`'s
 * `setupFiles` **permanently** -- this is the standing capture path, not
 * an opt-in a session has to remember to enable, because the issue this
 * closes is precisely "nobody remembered to capture anything before the
 * process was gone." On a green path this module runs `transcript.reset()`
 * per test and nothing else: `onTestFailed`'s own callback, and
 * `dumpTranscript`'s own no-op-when-empty guard, mean a passing suite
 * never writes a line.
 *
 * `onTestFailed` must be called while a test is "current", so it is
 * registered inside `beforeEach`, not at this module's own top level.
 *
 * Worker/pool identity is approximated from what a single test's own
 * process can see (`process.pid`, `VITEST_POOL_ID`/`VITEST_MAX_WORKERS`
 * if the active pool sets them) -- a full custom Reporter would see the
 * whole run's file list and could name concurrently-running suites
 * directly, but a per-package reporter still couldn't see another
 * package's files running concurrently under turbo either, so this
 * always emits `concurrentSuites: []` rather than a partial answer.
 */
beforeEach(() => {
	transcript.reset();
	onTestFailed((context) => {
		const [firstError] = context.task.result?.errors ?? [];
		captureFailure({
			testName: context.task.name,
			filePath: context.task.file?.filepath ?? "unknown",
			error: firstError ?? new Error("onTestFailed fired with no errors"),
			workerId: workerIdOf(process.pid, process.env.VITEST_POOL_ID),
			poolSize: Number(process.env.VITEST_MAX_WORKERS ?? Number.NaN),
			concurrentSuites: [],
		});
		dumpTranscript();
	});
});
