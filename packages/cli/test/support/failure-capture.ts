/**
 * #533: no failing run's stdout/stderr has ever been captured verbatim --
 * every observation so far ends in "error bodies not captured" or a
 * withdrawn attribution built on resemblance instead of the actual text
 * (see the issue's own correction). This module is the capture step:
 * given a failed test's own inputs, it builds one serializable record
 * and hands it to a sink -- by default, a single greppable JSON line on
 * stderr, so the record survives even if the process is later killed by
 * a timeout (stderr is flushed synchronously; a separate file would not
 * be, and run-one.sh already tees stdout/stderr to a `.log` per run, so
 * a second capture file would just duplicate what's already on disk).
 *
 * Wiring this into a real Vitest reporter (registered in
 * `vitest.config.ts`) is deliberately not done in this file -- G2.1's
 * own constraint is that this must not collide with G0's edits to that
 * file, and Vitest's reporter hook shapes are worth confirming against a
 * real run rather than guessed. See G2.4.
 */

export type FailureInput = {
	readonly testName: string;
	readonly filePath: string;
	readonly error: unknown;
	readonly workerId: string;
	readonly poolSize: number;
	readonly concurrentSuites: ReadonlyArray<string>;
};

export type FailureRecord = {
	readonly testName: string;
	readonly filePath: string;
	readonly errorText: string;
	readonly workerId: string;
	readonly poolSize: number;
	readonly concurrentSuites: ReadonlyArray<string>;
	readonly capturedAt: string;
};

const hasStringMessage = (
	error: unknown,
): error is { readonly message: string } =>
	typeof error === "object" &&
	error !== null &&
	"message" in error &&
	typeof (error as { message: unknown }).message === "string";

/**
 * The message text only, never a JS call stack -- a stack is
 * non-deterministic across call sites and every observation captured for
 * #533/#673 so far has quoted the message alone (`Error: Test timed out
 * in 30000ms.` + its own next line), not a stack.
 *
 * Real `instanceof Error` is checked first, but Vitest's own
 * `TestResult.errors` entries are not always real `Error` instances
 * (confirmed empirically wiring this into `onTestFailed` for G2.4:
 * `String(error)` itself threw `TypeError: Cannot convert object to
 * primitive value` on one) -- `hasStringMessage` covers that shape by
 * duck typing before falling back to `String()`, which is itself
 * wrapped so a genuinely unstringifiable value still produces a record
 * instead of losing the whole capture.
 */
const errorTextOf = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	if (hasStringMessage(error)) {
		return error.message;
	}
	try {
		return String(error);
	} catch {
		return "<error text unavailable: could not stringify>";
	}
};

export type Clock = () => string;

const defaultClock: Clock = () => new Date().toISOString();

export const buildFailureRecord = (
	input: FailureInput,
	clock: Clock = defaultClock,
): FailureRecord => ({
	testName: input.testName,
	filePath: input.filePath,
	errorText: errorTextOf(input.error),
	workerId: input.workerId,
	poolSize: input.poolSize,
	concurrentSuites: input.concurrentSuites,
	capturedAt: clock(),
});

export type RecordSink = (record: FailureRecord) => void;

/** Greppable across a full `pnpm test` log: a fixed marker prefix, one JSON object per line, never pretty-printed (a multi-line record would break line-oriented `grep`). */
export const FAILURE_CAPTURE_MARKER = "[failure-capture]";

export const stderrSink: RecordSink = (record) => {
	console.error(`${FAILURE_CAPTURE_MARKER} ${JSON.stringify(record)}`);
};

export const captureFailure = (
	input: FailureInput,
	sink: RecordSink = stderrSink,
	clock: Clock = defaultClock,
): FailureRecord => {
	const record = buildFailureRecord(input, clock);
	sink(record);
	return record;
};
