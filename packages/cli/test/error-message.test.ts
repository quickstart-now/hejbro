import { describe, expect, it } from "vitest";
import { describeDriverError } from "../src/check/error-message";

// #458 review round 1, task 1.9: a thrown value's own shape decides how
// it's described -- a table (D110), not one example, so a fix scoped to
// one branch shows up as exactly the new row passing, every neighbour
// unaffected.
const THROWN_VALUE_ROWS: ReadonlyArray<{
	readonly label: string;
	readonly thrown: unknown;
	readonly expected: string;
}> = [
	{ label: "an Error instance", thrown: new Error("boom"), expected: "boom" },
	{
		label: "a bare string",
		thrown: "just a string",
		expected: "just a string",
	},
	{
		label: "an object carrying only a code",
		thrown: { code: "ECONNREFUSED" },
		expected: "ECONNREFUSED",
	},
	{
		label: "an AggregateError with an empty own message",
		thrown: new AggregateError([new Error("inner1"), new Error("inner2")], ""),
		expected: "inner1; inner2",
	},
	{
		label: "an Error carrying a nested cause (the cause is never read)",
		thrown: Object.assign(new Error("outer"), { cause: new Error("inner") }),
		expected: "outer",
	},
	{ label: "null", thrown: null, expected: "null" },
	// The new row (#458 review round 1, task 1.9): an object with a string
	// `message` but no `code` and no `Error` prototype -- the shape a
	// thrown `ErrorEvent` (Neon's WebSocket `Pool` path, 1.6's own
	// neon-preset.md) has. Structural: this is a plain object, deliberately
	// never `instanceof Error`, so the fix cannot be a narrower `instanceof`
	// check that happens to also catch this one class.
	{
		label: "a plain object with a string message, not an Error instance",
		thrown: { message: "connection reset", type: "error" },
		expected: "connection reset",
	},
	// cd-planner review, #458 task 1.12: the hand-made row above covers the
	// *shape* (an object with a non-empty message) but never the *class*
	// this task exists for -- a real `ErrorEvent` (Neon's WebSocket `Pool`
	// path, measured) carries an EMPTY own `message`, so it never reaches
	// the row above's own branch. Kept side by side with that row on
	// purpose: only this one reproduces the bug the task was opened for.
	{
		label: "a real ErrorEvent instance with an empty own message",
		thrown: new ErrorEvent("error"),
		expected: "ErrorEvent",
	},
	// #458 task 1.12: a plain `Object` is excluded from the new
	// constructor-name rung -- "Object" names nothing `[object Object]`
	// doesn't already say, so this stays on the existing `String()`
	// fallback, unchanged.
	{ label: "a plain empty object", thrown: {}, expected: "[object Object]" },
	// cd-planner review, #458 task 1.9: the neighbour the seven-row table
	// left uncovered -- a plain object carrying BOTH a code and a
	// non-empty message. Not decided here which one this function should
	// prefer; this row only pins whichever the current implementation
	// actually returns, so a rewind against the pre-1.9 implementation
	// can show whether that answer changed.
	{
		label: "a plain object carrying both a code and a message",
		thrown: { code: "ECONNREFUSED", message: "connection refused" },
		expected: "connection refused",
	},
];

describe("describeDriverError", () => {
	it.each(THROWN_VALUE_ROWS)("describes $label", ({ thrown, expected }) => {
		expect(describeDriverError(thrown)).toBe(expected);
	});
});
