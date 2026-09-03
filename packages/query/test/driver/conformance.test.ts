import { describe, expect, it } from "vitest";
import type { DriverCapabilities } from "../../src/driver/contract";
import { assertSessionStateConformance } from "../../src/testing/driver-conformance";

/** A full `DriverCapabilities` value -- since 1.2, `interactiveTransactions` is required explicitly (not defaulted): combined with `session-state: false` it selects the transaction-envelope observation shape instead of the plain one, so every fixture below states both axes. */
const capabilitiesWithSessionState = (
	sessionState: boolean,
	interactiveTransactions: boolean,
): DriverCapabilities => ({
	"interactive-transactions": interactiveTransactions,
	"session-state": sessionState,
});

describe("assertSessionStateConformance (task 1.4/1.5, #481)", () => {
	it("a driver that declares session-state false and sends the settings only once fails the kit", () => {
		// The stub's `execute` omits the settings entirely -- exactly one
		// entry, the caller's own statement, with nothing preceding it. A
		// kit that passed this would be wrong (tasks.md 1.4's own words):
		// this is the shape #481 exists to catch.
		expect(() =>
			assertSessionStateConformance(
				capabilitiesWithSessionState(false, false),
				{
					recordedForOneExecute: [{ sql: "select 1", params: [] }],
					callerStatement: { sql: "select 1", params: [] },
				},
			),
		).toThrowError(/session-state/);
	});

	it("settings ride with the statement, in that order (also covers order, not just count: a caller statement sent first still fails)", () => {
		// A compliant false-tier driver: the settings precede the caller's
		// own statement -- the kit never reads their SQL text (it doesn't
		// know any driver's pin text), only that something precedes the
		// caller's own statement's position.
		expect(() =>
			assertSessionStateConformance(
				capabilitiesWithSessionState(false, false),
				{
					recordedForOneExecute: [
						{ sql: "set intervalstyle to 'postgres'", params: [] },
						{ sql: "set bytea_output to 'hex'", params: [] },
						{ sql: "select 1", params: [] },
					],
					callerStatement: { sql: "select 1", params: [] },
				},
			),
		).not.toThrow();

		// Order, not just count: the caller's statement sent *first*, with
		// a setting trailing after it, still fails -- two entries present,
		// but not "in that order".
		expect(() =>
			assertSessionStateConformance(
				capabilitiesWithSessionState(false, false),
				{
					recordedForOneExecute: [
						{ sql: "select 1", params: [] },
						{ sql: "set intervalstyle to 'postgres'", params: [] },
					],
					callerStatement: { sql: "select 1", params: [] },
				},
			),
		).toThrowError(/session-state/);
	});

	it("a session-state:true driver checked against the false tier's observation is rejected -- the kit reads the declaration, the caller doesn't hand it a tier", () => {
		// Captures outside the assertion, rather than a shared
		// try/expect.unreachable/catch: if the kit fails to throw at all,
		// `caught` simply stays `undefined` and the `toMatchObject` below
		// fails on that directly -- a `catch` that both raises
		// `expect.unreachable` on the miss and asserts on a hit nests one
		// `AssertionError` inside another on the miss, which still fails
		// but blurs the diagnostic.
		let caught: unknown;
		try {
			assertSessionStateConformance(capabilitiesWithSessionState(true, true), {
				recordedForOneExecute: [{ sql: "select 1", params: [] }],
				callerStatement: { sql: "select 1", params: [] },
			});
		} catch (error) {
			caught = error;
		}
		// Asserts the error's own identity (code + tier), never a bare
		// message substring: a kit that picked the obligation from
		// `observation`'s own shape instead of `capabilities` (the
		// exact forbidden move this test exists to catch) would, for
		// this input, fall through to the false-tier check instead --
		// which throws its own message embedding the literal text
		// "session-state:false", so `/session-state/` matches either
		// way and can't tell the mismatch-rejection apart from the
		// wrong obligation quietly running and merely happening to
		// fail (measured: this exact mutant survived a regex-only
		// assertion here). `tier` pins which failure actually fired.
		expect(caught).toMatchObject({
			code: "driver-conformance-violation",
			tier: "session-state:true",
		});
	});

	it("a session-state:false driver checked against the true tier's observation is rejected", () => {
		// Symmetric to the case above -- the reverse-direction guard
		// (`recordedForSetupSession` handed to a declared-false driver)
		// had no test of its own; disabling it in isolation left every
		// other test green.
		let caught: unknown;
		try {
			assertSessionStateConformance(
				capabilitiesWithSessionState(false, false),
				{
					recordedForSetupSession: [
						{ sql: "set intervalstyle to 'postgres'", params: [] },
					],
				},
			);
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({
			code: "driver-conformance-violation",
			tier: "session-state:false",
		});
	});

	it("a session-state:true driver delivers the settings through its setup hook", () => {
		// Negative control first: an empty setup-hook recording is the
		// violation -- a true-tier driver that never actually pins
		// anything through its setup hook, positive `capabilities` claim
		// notwithstanding.
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(true, true), {
				recordedForSetupSession: [],
			}),
		).toThrowError(/session-state/);

		// Positive: the setup hook sent something -- the kit reads no pin
		// SQL text (same as the false tier), only that the hook is where
		// this tier's settings actually travel.
		expect(() =>
			assertSessionStateConformance(capabilitiesWithSessionState(true, true), {
				recordedForSetupSession: [
					{
						sql: "set intervalstyle to 'postgres'; set bytea_output to 'hex'",
						params: [],
					},
				],
			}),
		).not.toThrow();
	});

	describe.each([
		{
			name: "caller last after a settings statement (control -- must keep passing)",
			recordedForOneExecute: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "caller followed by one trailing statement",
			recordedForOneExecute: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "caller followed by several trailing statements",
			recordedForOneExecute: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
				{ sql: "select pg_advisory_unlock_all()", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "caller first with nothing ahead of it",
			recordedForOneExecute: [
				{ sql: "select 1", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
			],
			outcome: "violation" as const,
		},
		{
			name: "caller absent from the list",
			recordedForOneExecute: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "set bytea_output to 'hex'", params: [] },
			],
			outcome: "violation" as const,
		},
		{
			name: "an empty list",
			recordedForOneExecute: [],
			outcome: "violation" as const,
		},
	])(
		"the false tier asks only that a statement precedes the caller's own -- $name",
		({ recordedForOneExecute, outcome }) => {
			it(`outcome: ${outcome}`, () => {
				const callerStatement = { sql: "select 1", params: [] };
				const run = () =>
					assertSessionStateConformance(
						capabilitiesWithSessionState(false, false),
						{ recordedForOneExecute, callerStatement },
					);
				if (outcome === "pass") {
					expect(run).not.toThrow();
					return;
				}
				expect(run).toThrowError(/session-state/);
			});
		},
	);

	describe.each([
		{
			name: "open/settings/caller/end (conforms)",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "settings/open/caller/end -- settings sent before the transaction opens are caught",
			recordedOnConnection: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "begin", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "violation" as const,
			// An open transaction *was* found (the "begin") -- what's wrong
			// is nothing sat between it and the caller, since the settings
			// landed before the open. Message 2, not message 1: an open
			// transaction did precede the caller.
			expectedMessage:
				/no statement was sent between the transaction's own opening/,
		},
		{
			name: "open/settings/end/open/caller/end -- settings landed in an earlier, already-closed transaction",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "commit", params: [] },
				{ sql: "begin", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "violation" as const,
			// The caller's own transaction (the second "begin") *did* open
			// -- nothing sat between it and the caller. Message 2.
			expectedMessage:
				/no statement was sent between the transaction's own opening/,
		},
		{
			name: "open/caller/end -- nothing precedes the caller inside the transaction",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "violation" as const,
			// Same shape as the row above, minimal form: an open transaction
			// precedes the caller, nothing sits between them. Message 2.
			expectedMessage:
				/no statement was sent between the transaction's own opening/,
		},
		{
			name: "caller with no transaction at all",
			recordedOnConnection: [{ sql: "select 1", params: [] }],
			outcome: "violation" as const,
			// No transaction opened at all -- distinct failure from the
			// three rows above, where an open transaction was found but
			// empty. Message 1, not message 2: it would be false to say
			// "nothing sat between the opening and the caller" when there
			// was no opening to begin with.
			expectedMessage: /was not sent inside an open transaction/,
		},
		{
			name: "boundary vocabulary is whole-statement, never substring -- a function body's own do $$ begin … end $$ ahead of the caller is an ordinary statement, not a reopened transaction",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "do $$ begin perform 1; end $$;", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "boundary vocabulary is whole-statement, never substring -- the caller's own statement carrying the word 'begin' inside a string literal is still found and is not read as control",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 'begin here'", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
			callerStatementOverride: { sql: "select 'begin here'", params: [] },
		},
		// Closing spellings measured against a real server (task 4.1):
		// each of these ends the transaction there, but a whole-statement
		// match on the bare word "commit"/"rollback"/"end" alone misses
		// every one of them -- a driver sending the settings, then one of
		// these, then the caller with nothing reopening a transaction
		// wrongly passes today (the caller runs outside any transaction,
		// and `SET LOCAL` outside one is discarded with a warning). Each
		// row here is exactly that shape, so "the caller's own statement
		// was not sent inside an open transaction" (message 1) is what a
		// leading-keyword match must report.
		{
			name: "closing spelling: 'COMMIT;' (uppercase, trailing semicolon) ends the transaction -- caught, not silently passed",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "COMMIT;", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "violation" as const,
			expectedMessage: /was not sent inside an open transaction/,
		},
		{
			name: "closing spelling: 'commit work' ends the transaction -- caught, not silently passed",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "commit work", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "violation" as const,
			expectedMessage: /was not sent inside an open transaction/,
		},
		{
			name: "closing spelling: 'commit transaction' ends the transaction -- caught, not silently passed",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "commit transaction", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "violation" as const,
			expectedMessage: /was not sent inside an open transaction/,
		},
		{
			name: "closing spelling: 'end transaction' ends the transaction -- caught, not silently passed",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "end transaction", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "violation" as const,
			expectedMessage: /was not sent inside an open transaction/,
		},
		{
			name: "closing spelling: 'abort' ends the transaction -- caught, not silently passed",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "abort", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "violation" as const,
			expectedMessage: /was not sent inside an open transaction/,
		},
		// Opening spellings measured against a real server (task 4.1):
		// each of these opens a transaction there, but a whole-statement
		// match on the bare words "begin"/"start transaction" alone
		// wrongly refuses every one of them -- a driver that opens with
		// one of these, sends its settings, then the caller, all inside
		// one real transaction, is wrongly failed today.
		{
			name: "opening spelling: 'begin work' opens the transaction -- recognized, not wrongly refused",
			recordedOnConnection: [
				{ sql: "begin work", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "opening spelling: 'begin transaction' opens the transaction -- recognized, not wrongly refused",
			recordedOnConnection: [
				{ sql: "begin transaction", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "opening spelling: 'begin isolation level serializable' opens the transaction -- recognized, not wrongly refused",
			recordedOnConnection: [
				{ sql: "begin isolation level serializable", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "opening spelling: 'start transaction read only' opens the transaction -- recognized, not wrongly refused",
			recordedOnConnection: [
				{ sql: "start transaction read only", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "opening spelling: 'BEGIN;' (uppercase, trailing semicolon) opens the transaction -- recognized, not wrongly refused",
			recordedOnConnection: [
				{ sql: "BEGIN;", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		// Savepoint statements (task 4.1) -- none of the three is a
		// transaction boundary, `rollback to savepoint s` especially:
		// its own leading word is "rollback", the same word that ends a
		// transaction bare, so a naive prefix match would wrongly treat
		// it as closing the transaction it's actually running inside.
		{
			name: "savepoint: 'savepoint s' is an ordinary statement, not a boundary",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "savepoint s", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "savepoint: 'release savepoint s' is an ordinary statement, not a boundary",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "release savepoint s", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		{
			name: "savepoint: 'rollback to savepoint s' is an ordinary statement, not a boundary -- the trap a naive 'starts with rollback' match would fall into",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "rollback to savepoint s", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
		// Three spellings the leading-keyword rule newly decides (task
		// 4.3), pinned so the rule's own edges are stated by tests rather
		// than inferred -- all three already pass under the leading-word
		// match; this task's job is naming them, not fixing anything.
		{
			name: "closing spelling: 'commit and chain' ends the transaction -- caught, not silently passed",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "commit and chain", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "violation" as const,
			expectedMessage: /was not sent inside an open transaction/,
		},
		{
			name: "closing spelling: 'rollback and chain' ends the transaction -- caught, not silently passed",
			recordedOnConnection: [
				{ sql: "begin", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "rollback and chain", params: [] },
				{ sql: "select 1", params: [] },
			],
			outcome: "violation" as const,
			expectedMessage: /was not sent inside an open transaction/,
		},
		{
			name: "opening spelling: leading whitespace and a newline ('\\n\\tBEGIN\\n') is still an opener -- recognized, not wrongly refused",
			recordedOnConnection: [
				{ sql: "\n\tBEGIN\n", params: [] },
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
				{ sql: "commit", params: [] },
			],
			outcome: "pass" as const,
		},
	])(
		"the transaction-envelope obligation for interactive-transactions:true + session-state:false -- $name",
		({
			recordedOnConnection,
			outcome,
			callerStatementOverride,
			expectedMessage,
		}) => {
			it(`outcome: ${outcome}`, () => {
				const callerStatement = callerStatementOverride ?? {
					sql: "select 1",
					params: [],
				};
				const run = () =>
					assertSessionStateConformance(
						capabilitiesWithSessionState(false, true),
						{ recordedOnConnection, callerStatement },
					);
				if (outcome === "pass") {
					expect(run).not.toThrow();
					return;
				}
				// Two distinct violation messages share this tier (open
				// never found vs. open found but empty) -- a bare
				// `/session-state/` match would pass either one for the
				// other, so every violation row here carries its own
				// non-overlapping `expectedMessage`.
				if (expectedMessage === undefined) {
					throw new Error(
						"this table row is missing its own expectedMessage -- see the two rows above for the pattern",
					);
				}
				expect(run).toThrowError(expectedMessage);
			});
		},
	);

	it("an envelope-blind observation is refused for a transaction-keeping driver", () => {
		// The plain false-tier shape (recordedForOneExecute) cannot show
		// transaction control at all -- handed to a driver declaring
		// interactive-transactions:true + session-state:false, it is
		// refused outright, not silently accepted as a passing envelope.
		let caught: unknown;
		try {
			assertSessionStateConformance(capabilitiesWithSessionState(false, true), {
				recordedForOneExecute: [
					{ sql: "set intervalstyle to 'postgres'", params: [] },
					{ sql: "select 1", params: [] },
				],
				callerStatement: { sql: "select 1", params: [] },
			});
		} catch (error) {
			caught = error;
		}
		// The mutant this test exists to catch (skipping the shape refusal
		// and falling through to the plain false-tier check) doesn't throw
		// at all for this input -- `recordedForOneExecute` already matches
		// that check's own shape, and its one statement precedes the
		// caller -- so `caught` stays `undefined` and fails `toMatchObject`
		// regardless of which fields it names. `tier` is asserted anyway,
		// to keep this test's identity check the same shape as its
		// siblings above and rule out the other two tiers' violations.
		expect(caught).toMatchObject({
			code: "driver-conformance-violation",
			tier: "session-state:false+interactive-transactions:true",
		});
	});

	it("discriminating mutant: moving the settings statement one position earlier, ahead of the transaction's own opening, turns the envelope case red while every 1.1 case (interactive-transactions:false) stays green", () => {
		// The "conforms" row above (open/settings/caller/end) versus the
		// "settings sent before the transaction opens" row (settings/open/
		// caller/end) *is* this exact mutant -- both already run above as
		// separate table rows. This test pins the other half: the same
		// perturbation applied to a plain false-tier (interactive-
		// transactions:false) observation is not even reachable by this
		// function -- it runs through `assertFalseTierConformance`
		// entirely, which has no notion of "transaction opening" at all,
		// so the plain tier's own cases (task 1.1's table) cannot move
		// together with the envelope tier's. If they did, this obligation
		// would be guarding nothing.
		expect(() =>
			assertSessionStateConformance(
				capabilitiesWithSessionState(false, false),
				{
					recordedForOneExecute: [
						{ sql: "begin", params: [] },
						{ sql: "select 1", params: [] },
						{ sql: "commit", params: [] },
					],
					callerStatement: { sql: "select 1", params: [] },
				},
			),
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
		const falseCapabilities = capabilitiesWithSessionState(false, false);
		assertSessionStateConformance(falseCapabilities, {
			recordedForOneExecute: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
				{ sql: "select 1", params: [] },
			],
			callerStatement: { sql: "select 1", params: [] },
		});
		expect(falseCapabilities["session-state"]).toBe(false);

		const trueCapabilities = capabilitiesWithSessionState(true, true);
		assertSessionStateConformance(trueCapabilities, {
			recordedForSetupSession: [
				{ sql: "set intervalstyle to 'postgres'", params: [] },
			],
		});
		expect(trueCapabilities["session-state"]).toBe(true);
	});
});
