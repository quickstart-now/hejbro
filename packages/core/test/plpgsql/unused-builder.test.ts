import { describe, expect, it } from "vitest";
import type { QueryNode } from "../../src/expr/ast";
import {
	defineFunction,
	defineTrigger,
	deleteFrom,
	insert,
	isNotNull,
	schema,
	select,
	table,
	update,
	uuid,
} from "../../src/index";
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

// #423/1.4: the query/* factories now call noteBuilder/markConsumed on
// every stage they build -- these calls must be no-ops with no session
// open, since @hejbro/query's runtime chain builds the exact same
// factories on every executed query without ever declaring anything.
describe("the runtime query chain is unaffected", () => {
	it("builds a chained select outside any recording session", () => {
		expect(hasOpenRecordingSession()).toBe(false);
		const query = select(comments)
			.where(isNotNull(comments.postId))
			.orderBy(comments.id)
			.limit(10);
		expect(query.selectQuery.limit).toBe(10);
		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("builds a chained insert outside any recording session", () => {
		expect(hasOpenRecordingSession()).toBe(false);
		const query = insert(comments)
			.values({ postId: "00000000-0000-0000-0000-000000000000" })
			.returning();
		expect(query.insertQuery.returning).not.toBeNull();
		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("builds a chained update outside any recording session", () => {
		expect(hasOpenRecordingSession()).toBe(false);
		const query = update(comments)
			.set({ postId: "00000000-0000-0000-0000-000000000000" })
			.where(isNotNull(comments.id))
			.returning();
		expect(query.updateQuery.returning).not.toBeNull();
		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("builds a chained delete outside any recording session", () => {
		expect(hasOpenRecordingSession()).toBe(false);
		const query = deleteFrom(comments)
			.where(isNotNull(comments.id))
			.returning();
		expect(query.deleteQuery.returning).not.toBeNull();
		expect(hasOpenRecordingSession()).toBe(false);
	});
});

// #423/1.5: the failure itself -- a builder created while a body records
// and never consumed fails the declaration, naming every unused builder
// (not just the first) and closing the session either way.
describe("statement-builder-unused", () => {
	it("a statement built and dropped fails the declaration", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				insert(comments).values({ postId: row.postId });
				ctx.return(row);
			}),
		).toThrowError(
			/built 1 statement\(s\) it never used \(an insert\)\. Next: run it for its effect with ctx\.execute/,
		);
		expect(hasOpenRecordingSession()).toBe(false);
	});

	it("names every unused builder, in the order they were built", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				insert(comments).values({ postId: row.postId });
				select({ id: comments.id }, comments);
				ctx.return(row);
			}),
		).toThrowError(
			/built 2 statement\(s\) it never used \(an insert, a select\)/,
		);
	});

	it("a set operation left unused is not told to use ctx.execute, which cannot carry one", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				select({ id: comments.id }, comments).union(
					select({ id: comments.id }, comments),
				);
				ctx.return(row);
			}),
		).toThrowError(
			/built 1 statement\(s\) it never used \(a set operation\)\. Next: a body has no statement that carries a set operation/,
		);
	});

	it("an unused builder fails before scalar-return-missing is ever reached", () => {
		expect(() =>
			defineFunction(
				app,
				"silent_and_wasteful",
				{ returns: { typeName: "integer" } },
				() => {
					select(comments);
				},
			),
		).toThrowError(/built 1 statement\(s\) it never used/);
	});
});
