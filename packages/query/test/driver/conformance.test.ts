import { describe, expect, it } from "vitest";
import type { DriverCapabilities } from "../../src/driver/contract";
import { assertSessionStateConformance } from "../../src/testing/driver-conformance";

/** A full `DriverCapabilities` value for a given `session-state` reading -- `interactive-transactions` is irrelevant to this kit, fixed `true` so every fixture below states only the axis under test. */
const capabilitiesWithSessionState = (
	sessionState: boolean,
): DriverCapabilities => ({
	"interactive-transactions": true,
	"session-state": sessionState,
});

describe("assertSessionStateConformance (task 1.4/1.5, #481)", () => {
	it("a driver that declares session-state false and sends the settings only once fails the kit", () => {
		// The stub's `execute` omits the settings entirely -- exactly one
		// entry, the caller's own statement, with nothing preceding it. A
		// kit that passed this would be wrong (tasks.md 1.4's own words):
		// this is the shape #481 exists to catch.
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(false), {
				recordedForOneExecute: [{ sql: "select 1", params: [] }],
				callerStatement: { sql: "select 1", params: [] },
			}),
		).toThrowError(/session-state/);
	});

	it("settings ride with the statement, in that order (also covers order, not just count: a caller statement sent first still fails)", () => {
		// A compliant false-tier driver: the settings precede the caller's
		// own statement, which lands last -- the kit never reads their SQL
		// text (it doesn't know any driver's pin text), only their
		// position relative to the caller's own statement.
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(false), {
				recordedForOneExecute: [
					{ sql: "set intervalstyle to 'postgres'", params: [] },
					{ sql: "set bytea_output to 'hex'", params: [] },
					{ sql: "select 1", params: [] },
				],
				callerStatement: { sql: "select 1", params: [] },
			}),
		).not.toThrow();

		// Order, not just count: the caller's statement sent *first*, with
		// a setting trailing after it, still fails -- two entries present,
		// but not "in that order".
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(false), {
				recordedForOneExecute: [
					{ sql: "select 1", params: [] },
					{ sql: "set intervalstyle to 'postgres'", params: [] },
				],
				callerStatement: { sql: "select 1", params: [] },
			}),
		).toThrowError(/session-state/);
	});

	it("a session-state:true driver checked against the false tier's observation is rejected -- the kit reads the declaration, the caller doesn't hand it a tier", () => {
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(true), {
				recordedForOneExecute: [{ sql: "select 1", params: [] }],
				callerStatement: { sql: "select 1", params: [] },
			}),
		).toThrowError(/session-state/);
	});

	it("a session-state:true driver delivers the settings through its setup hook", () => {
		// Negative control first: an empty setup-hook recording is the
		// violation -- a true-tier driver that never actually pins
		// anything through its setup hook, positive `capabilities` claim
		// notwithstanding.
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(true), {
				recordedForSetupSession: [],
			}),
		).toThrowError(/session-state/);

		// Positive: the setup hook sent something -- the kit reads no pin
		// SQL text (same as the false tier), only that the hook is where
		// this tier's settings actually travel.
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(true), {
				recordedForSetupSession: [
					{
						sql: "set intervalstyle to 'postgres'; set bytea_output to 'hex'",
						params: [],
					},
				],
			}),
		).not.toThrow();
	});

	it("the declaration is left alone -- the kit reads capabilities, never writes it, for either tier", () => {
		// Structural guarantee, made explicit: `assertSessionStateConformance`
		// never receives a `Driver` or any mutable reference to its
		// `capabilities` -- only a plain value copy -- so there is no
		// channel through which running the kit could ever change what a
		// driver's own capabilities object reads afterward. This test
		// exercises both tiers' *compliant* path and then re-reads the
		// same object literal to make that structural fact an executable
		// check, not just an argument.
		const falseCapabilities = capabilitiesWithSessionState(false);
		assertSessionStateConformance(falseCapabilities, {
			recordedForOneExecute: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
			],
			callerStatement: { sql: "select 1", params: [] },
		});
		expect(falseCapabilities["session-state"]).toBe(false);

		const trueCapabilities = capabilitiesWithSessionState(true);
		assertSessionStateConformance(trueCapabilities, {
			recordedForSetupSession: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
			],
		});
		expect(trueCapabilities["session-state"]).toBe(true);
	});
});
