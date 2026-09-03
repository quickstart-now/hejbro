import { afterEach, describe, expect, it } from "vitest";
import { CallTranscript, dumpTranscript, transcript } from "./call-transcript";
import { FAILURE_CAPTURE_MARKER } from "./failure-capture";

/**
 * #533 G2.3b, driven from the input table the plan names:
 * (i) a failing test with only successful calls -- their stdout/stderr
 *     are in the record;
 * (ii) a call whose stderr starts with `error[` -- present, not
 *     suppressed;
 * (iii) more calls than the cap -- a truncation marker, not silent loss;
 * (iv) nothing recorded -- dump writes nothing.
 */
describe("call-transcript / #533 G2.3b", () => {
	afterEach(() => {
		transcript.reset();
	});

	it("(i) successful calls are recorded even though they never error", () => {
		const t = new CallTranscript();
		t.record({
			argv: ["generate"],
			cwd: "/fixture",
			exitCode: 0,
			stdout: "wrote migrations/0001_init.sql\n",
			stderr: "",
		});
		t.record({
			argv: ["verify"],
			cwd: "/fixture",
			exitCode: 0,
			stdout: "no changes\n",
			stderr: "",
		});

		const snap = t.snapshot();
		expect(snap.calls).toHaveLength(2);
		expect(snap.calls[0]?.stdout).toBe("wrote migrations/0001_init.sql\n");
		expect(snap.calls[1]?.stdout).toBe("no changes\n");
		expect(snap.truncated).toBe(false);
	});

	it("(ii) a call whose stderr is a hejbro diagnostic (error[...]) is not suppressed", () => {
		const t = new CallTranscript();
		t.record({
			argv: ["restore", "--to", "0001"],
			cwd: "/fixture",
			exitCode: 1,
			stdout: "",
			stderr: "error[restore-state-lost]: no snapshot at that commit\n",
		});

		const snap = t.snapshot();
		expect(snap.calls).toHaveLength(1);
		expect(snap.calls[0]?.stderr).toBe(
			"error[restore-state-lost]: no snapshot at that commit\n",
		);
	});

	it("(iii) more calls than the cap set truncated, without silently losing the fact", () => {
		const t = new CallTranscript(2);
		t.record({ argv: ["a"], cwd: "/x", exitCode: 0, stdout: "", stderr: "" });
		t.record({ argv: ["b"], cwd: "/x", exitCode: 0, stdout: "", stderr: "" });
		t.record({ argv: ["c"], cwd: "/x", exitCode: 0, stdout: "", stderr: "" });

		const snap = t.snapshot();
		expect(snap.calls).toHaveLength(2);
		expect(snap.truncated).toBe(true);
	});

	it("(iv) an empty transcript dumps nothing", () => {
		transcript.reset();
		const lines: string[] = [];
		dumpTranscript((line) => lines.push(line));
		expect(lines).toEqual([]);
	});

	it("a non-empty transcript dumps exactly one marked JSON line, calls and truncated both present", () => {
		transcript.reset();
		transcript.record({
			argv: ["verify"],
			cwd: "/fixture",
			exitCode: 0,
			stdout: "no changes\n",
			stderr: "",
		});
		const lines: string[] = [];
		dumpTranscript((line) => lines.push(line));

		expect(lines).toHaveLength(1);
		expect(lines[0]?.startsWith(FAILURE_CAPTURE_MARKER)).toBe(true);
		const parsed = JSON.parse(
			lines[0]?.slice(FAILURE_CAPTURE_MARKER.length).trim() ?? "",
		);
		expect(parsed.kind).toBe("call-transcript");
		expect(parsed.calls).toHaveLength(1);
		expect(parsed.truncated).toBe(false);
	});
});
