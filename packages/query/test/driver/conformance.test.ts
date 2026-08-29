import { describe, expect, it } from "vitest";
import { assertFalseTierConformance } from "../../src/testing/driver-conformance";

describe("assertFalseTierConformance (task 1.4/1.5, #481)", () => {
	it("a driver that declares session-state false and sends the settings only once fails the kit", () => {
		// The stub's `execute` omits the settings entirely -- exactly one
		// entry, the caller's own statement, with nothing preceding it. A
		// kit that passed this would be wrong (tasks.md 1.4's own words):
		// this is the shape #481 exists to catch.
		expect(() =>
			assertFalseTierConformance([{ sql: "select 1", params: [] }], {
				sql: "select 1",
				params: [],
			}),
		).toThrowError(/session-state/);
	});

	it("settings ride with the statement, in that order", () => {
		// A compliant false-tier driver: the settings precede the caller's
		// own statement, which lands last -- the kit never reads their SQL
		// text (it doesn't know any driver's pin text), only their
		// position relative to the caller's own statement.
		expect(() =>
			assertFalseTierConformance(
				[
					{ sql: "set intervalstyle to 'postgres'", params: [] },
					{ sql: "set bytea_output to 'hex'", params: [] },
					{ sql: "select 1", params: [] },
				],
				{ sql: "select 1", params: [] },
			),
		).not.toThrow();
	});

	it("fails when the caller's statement is not the last entry sent (order violation, not just a count check)", () => {
		expect(() =>
			assertFalseTierConformance(
				[
					{ sql: "select 1", params: [] },
					{ sql: "set intervalstyle to 'postgres'", params: [] },
				],
				{ sql: "select 1", params: [] },
			),
		).toThrowError(/session-state/);
	});
});
