import { describe, expect, it } from "vitest";
import type { QueryNode } from "../../src/expr/ast";
import { defineTrigger, schema, table, uuid } from "../../src/index";
import {
	closeRecordingSession,
	hasOpenRecordingSession,
	markConsumed,
	noteBuilder,
	openRecordingSession,
} from "../../src/plpgsql/recording-session";

const app = schema("app");
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

const triggerConfig = {
	name: "unused_builder_probe",
	timing: "before" as const,
	events: ["insert"] as const,
	forEach: "row" as const,
};

const fakeSelect = (): QueryNode =>
	({ queryKind: "select" }) as unknown as QueryNode;

// #426/1.3: the recording session mechanism, on its own — no production
// code registers a builder yet (that's 1.4), so these only pin the
// lifecycle a later guard depends on: a session is open exactly while a
// body records, closes even if the body throws, and nests as a stack.
describe("recording-session lifecycle", () => {
	it("opens a session while the body's own callback runs, and closes it once finished", () => {
		expect(hasOpenRecordingSession()).toBe(false);
		const observedDuringBody: Array<boolean> = [];

		defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
			observedDuringBody.push(hasOpenRecordingSession());
			ctx.return(row);
		});

		// The determinism guard (D22) runs the body twice, each under its
		// own session -- both observations land inside one.
		expect(observedDuringBody).toEqual([true, true]);
		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("closes the session even when the body callback throws", () => {
		expect(hasOpenRecordingSession()).toBe(false);

		expect(() =>
			defineTrigger(comments, triggerConfig, () => {
				throw new Error("boom");
			}),
		).toThrow("boom");

		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("nests as a stack: closing the inner session restores the outer one", () => {
		expect(hasOpenRecordingSession()).toBe(false);
		openRecordingSession();
		expect(hasOpenRecordingSession()).toBe(true);
		openRecordingSession();
		expect(hasOpenRecordingSession()).toBe(true);

		closeRecordingSession();
		expect(hasOpenRecordingSession()).toBe(true);
		closeRecordingSession();
		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("closing a session with none open is a no-op", () => {
		expect(hasOpenRecordingSession()).toBe(false);
		expect(closeRecordingSession()).toEqual([]);
		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("reports a produced node unconsumed when the session closes", () => {
		openRecordingSession();
		const produced = fakeSelect();
		noteBuilder(produced, null);
		expect(closeRecordingSession()).toEqual([produced]);
	});

	it("does not report a node marked consumed", () => {
		openRecordingSession();
		const produced = fakeSelect();
		noteBuilder(produced, null);
		markConsumed(produced);
		expect(closeRecordingSession()).toEqual([]);
	});

	it("noteBuilder's supersedes argument marks the parent consumed in the same call", () => {
		openRecordingSession();
		const parent = fakeSelect();
		noteBuilder(parent, null);
		const child = fakeSelect();
		noteBuilder(child, parent);
		// parent is superseded (consumed); only the still-unconsumed child remains.
		expect(closeRecordingSession()).toEqual([child]);
	});

	it("markConsumed reaches an outer session while an inner one is open", () => {
		openRecordingSession();
		const outerBuilder = fakeSelect();
		noteBuilder(outerBuilder, null);

		openRecordingSession();
		markConsumed(outerBuilder);
		expect(closeRecordingSession()).toEqual([]); // inner session: nothing of its own

		expect(closeRecordingSession()).toEqual([]); // outer session: its builder was consumed
	});

	it("marking an untracked node (built outside any session) is a silent no-op", () => {
		const untracked = fakeSelect();
		expect(() => markConsumed(untracked)).not.toThrow();

		openRecordingSession();
		markConsumed(untracked);
		expect(closeRecordingSession()).toEqual([]);
	});

	it("consuming the same node twice stays consumed (idempotent, not an error)", () => {
		openRecordingSession();
		const produced = fakeSelect();
		noteBuilder(produced, null);
		markConsumed(produced);
		expect(() => markConsumed(produced)).not.toThrow();
		expect(closeRecordingSession()).toEqual([]);
	});
});
