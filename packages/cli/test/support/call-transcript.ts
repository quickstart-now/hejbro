import { FAILURE_CAPTURE_MARKER } from "./failure-capture";

/**
 * #533 G2.3b: `errorText` alone (the vitest-printed assertion/timeout
 * message) is not the body that actually goes missing for this issue --
 * `test/support/cli-runner.ts`'s own `runCli` only logs a call when
 * `execFile` itself errors (a spawn/crash), so a call that *succeeds*
 * (exit 0) leaves no trace even when the test's own assertions on its
 * stdout are what fails; and `isHejbroDiagnostic` deliberately suppresses
 * a `stderr` that starts with `error[` -- exactly the shape
 * `restore-state-lost` is about. This transcript records every call
 * unconditionally and dumps it only when the test that made the calls
 * failed.
 */
export type CallRecord = {
	readonly argv: ReadonlyArray<string>;
	readonly cwd: string;
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export type TranscriptDump = {
	readonly kind: "call-transcript";
	readonly calls: ReadonlyArray<CallRecord>;
	readonly truncated: boolean;
};

const DEFAULT_MAX_CALLS = 200;

export class CallTranscript {
	private calls: CallRecord[] = [];
	private truncated = false;
	private readonly maxCalls: number;

	constructor(maxCalls: number = DEFAULT_MAX_CALLS) {
		this.maxCalls = maxCalls;
	}

	/** Called once per test (the `beforeEach` wiring in `failure-capture-setup.ts`) -- a run's calls must never pile up across tests. */
	reset(): void {
		this.calls = [];
		this.truncated = false;
	}

	/**
	 * Unconditional -- success and failure both recorded, and a
	 * diagnostic-shaped `stderr` (`error[...]`) is never filtered here
	 * (that filtering belongs to `cli-runner.ts`'s own separate, narrower
	 * "worth an immediate console.error" decision, not to this
	 * transcript). Past `maxCalls`, new entries are dropped and
	 * `truncated` is set -- silently discarding would defeat the point of
	 * a capture harness whose whole purpose is not losing evidence.
	 */
	record(entry: CallRecord): void {
		if (this.calls.length >= this.maxCalls) {
			this.truncated = true;
			return;
		}
		this.calls.push(entry);
	}

	isEmpty(): boolean {
		return this.calls.length === 0 && !this.truncated;
	}

	snapshot(): TranscriptDump {
		return {
			kind: "call-transcript",
			calls: [...this.calls],
			truncated: this.truncated,
		};
	}
}

/** The one shared transcript for the currently-running test. */
export const transcript = new CallTranscript();

export type LineWriter = (line: string) => void;

const defaultWriter: LineWriter = (line) => {
	console.error(line);
};

/**
 * No-op on an empty transcript -- a passing test never has anything
 * worth dumping (its own transcript was reset at the start and nothing
 * failed to trigger a dump), so calling this unconditionally after every
 * test is safe: nothing is written unless there is something to write.
 */
export const dumpTranscript = (write: LineWriter = defaultWriter): void => {
	if (transcript.isEmpty()) {
		return;
	}
	write(`${FAILURE_CAPTURE_MARKER} ${JSON.stringify(transcript.snapshot())}`);
};
