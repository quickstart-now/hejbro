import { describe, expect, it } from "vitest";
import {
	buildFailureRecord,
	captureFailure,
	FAILURE_CAPTURE_MARKER,
	type FailureInput,
} from "./failure-capture";

/**
 * #533: the capture step must carry the verbatim error text plus the
 * worker/pool size and the concurrently-running suite names, for any of
 * the three shapes a real vitest failure can take. Driven from an input
 * table, not one example, per D110.
 */
const baseInput: Omit<FailureInput, "error"> = {
	testName: "restore-state-lost",
	filePath: "test/restore-command.test.ts",
	workerId: "worker-3",
	poolSize: 16,
	concurrentSuites: ["test/vendor.test.ts", "test/git.test.ts"],
};

const assertionError = (() => {
	try {
		expect(1).toBe(2);
	} catch (error) {
		return error;
	}
	throw new Error("unreachable: expect(1).toBe(2) did not throw");
})();

const timeoutError = new Error(
	'Test timed out in 30000ms.\nIf this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".',
);

describe("failure-capture / #533", () => {
	it.each([
		{
			name: "a failed assertion",
			error: assertionError,
			expectedText: (assertionError as Error).message,
		},
		{
			name: "a thrown Error",
			error: new Error("boom: declaration file evaluation crashed"),
			expectedText: "boom: declaration file evaluation crashed",
		},
		{
			name: "a timeout",
			error: timeoutError,
			expectedText:
				'Test timed out in 30000ms.\nIf this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".',
		},
	])(
		"buildFailureRecord captures the verbatim error text for $name",
		({ error, expectedText }) => {
			const record = buildFailureRecord(
				{ ...baseInput, error },
				() => "2026-09-03T00:00:00.000Z",
			);

			expect(record.errorText).toBe(expectedText);
			expect(record.testName).toBe(baseInput.testName);
			expect(record.filePath).toBe(baseInput.filePath);
			expect(record.workerId).toBe(baseInput.workerId);
			expect(record.poolSize).toBe(baseInput.poolSize);
			expect(record.concurrentSuites).toEqual(baseInput.concurrentSuites);
			expect(record.capturedAt).toBe("2026-09-03T00:00:00.000Z");
		},
	);

	it("buildFailureRecord captures a non-Error thrown value by String() coercion", () => {
		const record = buildFailureRecord(
			{ ...baseInput, error: "a plain string throw" },
			() => "2026-09-03T00:00:00.000Z",
		);
		expect(record.errorText).toBe("a plain string throw");
	});

	// Discovered empirically wiring this into a real `onTestFailed` hook
	// for G2.4: Vitest's own `TestResult.errors` entries are not always
	// real `Error` instances, and can be unstringifiable objects.
	it("buildFailureRecord reads .message from an error-like object that isn't instanceof Error", () => {
		const errorLike = { message: "assertion failed: 1 !== 2", diff: "..." };
		const record = buildFailureRecord(
			{ ...baseInput, error: errorLike },
			() => "2026-09-03T00:00:00.000Z",
		);
		expect(record.errorText).toBe("assertion failed: 1 !== 2");
	});

	it("buildFailureRecord never throws on an object String() itself rejects", () => {
		const unstringifiable = {
			toString: () => {
				throw new Error("no");
			},
			[Symbol.toPrimitive]: () => {
				throw new Error("no");
			},
		};
		expect(() =>
			buildFailureRecord(
				{ ...baseInput, error: unstringifiable },
				() => "2026-09-03T00:00:00.000Z",
			),
		).not.toThrow();
		const record = buildFailureRecord(
			{ ...baseInput, error: unstringifiable },
			() => "2026-09-03T00:00:00.000Z",
		);
		expect(record.errorText).toBe(
			"<error text unavailable: could not stringify>",
		);
	});

	it("captureFailure hands the built record to the sink and returns it", () => {
		const sunk: unknown[] = [];
		const record = captureFailure(
			{ ...baseInput, error: new Error("boom") },
			(r) => sunk.push(r),
			() => "2026-09-03T00:00:00.000Z",
		);

		expect(sunk).toEqual([record]);
		expect(record.errorText).toBe("boom");
	});

	it("the default sink writes one greppable JSON line to stderr, marker first", () => {
		const lines: string[] = [];
		const stderrSpy = (line: string) => lines.push(line);
		const originalError = console.error;
		console.error = (...args: unknown[]) => stderrSpy(String(args[0]));
		try {
			captureFailure(
				{ ...baseInput, error: new Error("boom") },
				undefined,
				() => "2026-09-03T00:00:00.000Z",
			);
		} finally {
			console.error = originalError;
		}

		expect(lines).toHaveLength(1);
		expect(lines[0]?.startsWith(FAILURE_CAPTURE_MARKER)).toBe(true);
		const jsonText =
			lines[0]?.slice(FAILURE_CAPTURE_MARKER.length).trim() ?? "";
		expect(() => JSON.parse(jsonText)).not.toThrow();
		expect(JSON.parse(jsonText).errorText).toBe("boom");
	});
});
