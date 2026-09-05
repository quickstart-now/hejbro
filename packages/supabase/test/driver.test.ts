import { roleName, schema, table, uuid } from "@hejbro/core";
import type { CompileResult, Driver, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { assertSessionStateConformance } from "@hejbro/query/testing/driver-conformance";
import { describe, expect, it, vi } from "vitest";
import { asAnon, asUser } from "../src/context";
import type {
	SupabaseDriverEndpoint,
	SupabaseDriverOptions,
} from "../src/driver";
import { supabaseDriver } from "../src/driver";
import { anonRole, authenticatedRole, serviceRole } from "../src/roles";

/** A minimal contract `Driver` fixture -- no concrete driver implementation, mirroring `packages/query/test/db/db.test.ts`'s own `fakeDriver`. */
const fakeDriver = (): Driver => ({
	capabilities: {
		"interactive-transactions": true,
		"session-state": true,
		"prepared-statements": false,
	},
	execute: vi.fn(async () => []),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => []) }),
	),
	setupSession: vi.fn(async () => {}),
});

/** A driver that models one BEGIN/COMMIT per `driver.transaction()` call and records every statement sent on that connection, in order -- mirrors `packages/query/test/db/context.test.ts`'s own `recordingTransactionalDriver`, so a `db.as(context)` test here can check exactly what `applyContext` sent, not just that it didn't throw. */
const recordingTransactionalDriver = (): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<
		Array<{ sql: string; params: ReadonlyArray<unknown> }>
	>;
} => {
	const sentPerTransaction: Array<
		Array<{ sql: string; params: ReadonlyArray<unknown> }>
	> = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: vi.fn(async () => []),
		transaction: vi.fn(async (callback) => {
			const sent: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
			sentPerTransaction.push(sent);
			const session: DriverSession = {
				execute: vi.fn(async (compiled) => {
					sent.push({ sql: compiled.sql, params: compiled.params });
					return [];
				}),
			};
			return callback(session);
		}),
		setupSession: vi.fn(async () => {}),
	};
	return { driver, sentPerTransaction };
};

describe("supabaseDriver(driver) decorator", () => {
	it("contributes exactly the three Supabase roles", () => {
		const wrapped = supabaseDriver(fakeDriver());

		expect(wrapped.contributedRoles).toEqual([
			anonRole,
			authenticatedRole,
			serviceRole,
		]);
	});

	it("passes every wrapped driver member through unchanged", () => {
		const driver = fakeDriver();
		const wrapped = supabaseDriver(driver);

		const passthroughKeys = Object.keys(driver) as ReadonlyArray<keyof Driver>;
		expect(passthroughKeys).not.toHaveLength(0);
		passthroughKeys.forEach((key) => {
			expect(wrapped[key]).toBe(driver[key]);
		});
	});
});

describe("supabaseDriver(driver) one-argument call is unchanged by the endpoint option (task 2.2, regression lock)", () => {
	it("declares the same capabilities as the wrapped driver -- no options argument at all, not even omitted-but-typed", () => {
		const driver = fakeDriver();

		const wrapped = supabaseDriver(driver);

		expect(wrapped.capabilities).toBe(driver.capabilities);
		expect(wrapped.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		});
	});

	it("contributes the same three roles one-argument callers always got", () => {
		const wrapped = supabaseDriver(fakeDriver());

		expect(wrapped.contributedRoles).toEqual([
			anonRole,
			authenticatedRole,
			serviceRole,
		]);
	});
});

describe("task 4.7 (a') union wiring proof -- driver-contributed roles on a grant-less schema", () => {
	it("driver-contributed roles unlock asUser/asAnon on a grant-less schema; undeclared roles stay rejected", async () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		// zero grants, zero RLS policies -- the only role source here is
		// supabaseDriver's own contributedRoles.
		const grantlessSchema = { posts };
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(grantlessSchema, supabaseDriver(driver));

		// open direction: a driver-contributed role is accepted, and the
		// context it applies actually reaches the driver -- not just "didn't
		// throw" (6.1 x 6.2 wired together, not merely each in isolation).
		await handle.as(asAnon()).transaction(async () => {});
		expect(sentPerTransaction[0]).toEqual([
			{ sql: 'set local role "anon"', params: [] },
			{
				sql: "select set_config($1, $2, true)",
				params: ["request.jwt.claims", '{"role":"anon"}'],
			},
		]);

		await handle.as(asUser({ sub: "user-1" })).transaction(async () => {});
		expect(sentPerTransaction[1]).toEqual([
			{ sql: 'set local role "authenticated"', params: [] },
			{
				sql: "select set_config($1, $2, true)",
				params: [
					"request.jwt.claims",
					'{"sub":"user-1","role":"authenticated"}',
				],
			},
		]);

		// closed direction: the union only ever widens who is *accepted* --
		// fail-closed for anyone not in it still holds.
		try {
			handle.as({ role: roleName("nonexistent_role") });
			expect.unreachable("db.as should have thrown for an undeclared role");
		} catch (error) {
			expect(error).toHaveProperty("code", "undeclared-role");
		}
	});
});

describe("supabaseDriver(driver, options) endpoint option (task 2.1)", () => {
	it("endpoint: 'transaction-pooler' produces the pooled-transaction capability pair", () => {
		const wrapped = supabaseDriver(fakeDriver(), {
			endpoint: "transaction-pooler",
		});

		expect(wrapped.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": false,
			"prepared-statements": false,
		});
	});
});

describe("supabaseDriver(driver, { endpoint: 'transaction-pooler' }) still contributes Supabase's three roles (task 2.3)", () => {
	it("contributedRoles survives the pooler path's capability replacement", () => {
		const wrapped = supabaseDriver(fakeDriver(), {
			endpoint: "transaction-pooler",
		});

		expect(wrapped.contributedRoles).toEqual([
			anonRole,
			authenticatedRole,
			serviceRole,
		]);
	});
});

describe("supabaseDriver(driver, options) rejects an unrecognized endpoint value (task 2.4)", () => {
	it("throws the unknown-pooler-mode error at construction, naming the recognized endpoint values -- the only check a caller without type checking gets", () => {
		// simulates a caller with no type checking (plain JS, or an `any`
		// upstream) sending a misspelled value straight through -- `as
		// unknown as` here, never `any`, so this file's own source stays
		// within the house ban.
		const misspelled = "transactoin" as unknown as SupabaseDriverEndpoint;

		try {
			supabaseDriver(fakeDriver(), { endpoint: misspelled });
			expect.unreachable(
				"supabaseDriver should have thrown for an unrecognized endpoint value",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "unknown-pooler-mode");
			const message = (error as Error).message;
			expect(message).toContain('"transactoin"');
			expect(message).toContain("session");
			expect(message).toContain("transaction-pooler");
			expect(message).toMatch(/Next:/);
		}
	});

	it("never reaches the execution path -- the wrapped driver's own members are never called for a rejected value", () => {
		const misspelled = "transactoin" as unknown as SupabaseDriverEndpoint;
		const driver = fakeDriver();

		expect(() => supabaseDriver(driver, { endpoint: misspelled })).toThrow();

		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.setupSession).not.toHaveBeenCalled();
	});
});

describe("the transaction-pooler endpoint refuses a base that prepares (task 1.4, #303)", () => {
	const preparingDriver = (): Driver => ({
		...fakeDriver(),
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": true,
		},
	});

	it("throws prepared-statements-without-session, naming the endpoint, with a Next: line -- the base is never called", () => {
		const driver = preparingDriver();

		try {
			supabaseDriver(driver, { endpoint: "transaction-pooler" });
			expect.unreachable(
				"supabaseDriver should have thrown for a preparing base over the transaction-pooler endpoint",
			);
		} catch (error) {
			expect(error).toHaveProperty(
				"code",
				"prepared-statements-without-session",
			);
			const message = (error as Error).message;
			expect(message).toContain("transaction-pooler");
			expect(message).toMatch(/Next:/);
		}

		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.setupSession).not.toHaveBeenCalled();
	});

	it("a non-preparing base over the transaction-pooler endpoint still declares prepared-statements: false (regression control)", () => {
		const wrapped = supabaseDriver(fakeDriver(), {
			endpoint: "transaction-pooler",
		});

		expect(wrapped.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": false,
			"prepared-statements": false,
		});
	});

	it.each<[string, SupabaseDriverOptions | undefined]>([
		["the session endpoint", { endpoint: "session" }],
		["no endpoint stated", undefined],
	])(
		"%s over a preparing base passes the declaration through, true, and execute reaches the base",
		async (_label, options) => {
			const driver = preparingDriver();

			const wrapped = supabaseDriver(driver, options);

			expect(wrapped.capabilities).toEqual({
				"interactive-transactions": true,
				"session-state": true,
				"prepared-statements": true,
			});
			const compiled: CompileResult = {
				sql: "select 1",
				params: [],
				kind: "select",
			};
			await wrapped.execute(compiled);
			expect(driver.execute).toHaveBeenCalledTimes(1);
			// This path is a pure passthrough (no wrapping, unlike the
			// pooler's own execute/transaction members) -- an equal
			// CompileResult reaches the base's own execute (toHaveBeenCalledWith
			// is deep equality, not identity). That is enough: the name a
			// preparing base derives is a function of `sql` alone, so a
			// preserved `sql` preserves the name it would produce.
			expect(driver.execute).toHaveBeenCalledWith(compiled);
		},
	);
});

describe("supabaseDriver(driver) conforms to the driver contract (#481, task 1.7)", () => {
	it("conforms to the driver contract", async () => {
		// `supabaseDriver` is a pure passthrough decorator (this file's own
		// "passes every wrapped driver member through unchanged" test
		// above) -- production usage always wraps a real Postgres
		// connection (session-state:true), so this fixture's own
		// `setupSession` actually records something, unlike `fakeDriver`'s
		// no-op above (which would fail the true tier's obligation if
		// checked, correctly: it never sends anything).
		const recorded: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
		const underlying: Driver = {
			capabilities: {
				"interactive-transactions": true,
				"session-state": true,
				"prepared-statements": false,
			},
			execute: vi.fn(async () => []),
			transaction: vi.fn(async (callback) =>
				callback({ execute: vi.fn(async () => []) }),
			),
			setupSession: vi.fn(async (session: DriverSession) => {
				const rows = await session.execute({
					sql: "set intervalstyle to 'postgres'; set bytea_output to 'hex'",
					params: [],
					kind: "sql",
				});
				void rows;
			}),
		};
		const wrapped = supabaseDriver(underlying);
		const recordingSession: DriverSession = {
			execute: vi.fn(async (compiled) => {
				recorded.push({ sql: compiled.sql, params: compiled.params });
				return [];
			}),
		};

		await wrapped.setupSession(recordingSession);

		expect(() =>
			assertSessionStateConformance(wrapped.capabilities, {
				recordedForSetupSession: recorded,
			}),
		).not.toThrow();
	});
});

describe("supabaseDriver(driver, { endpoint: 'transaction-pooler' }) + db.as(context) baseline pin (task 4.2, #557 -- fixed before the context-application generalization lands, so a later change that moves this is caught here)", () => {
	it("sends the same role + set_config sequence on the pooled-transaction path (session-state: false) as the default path, inside one transaction", async () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const grantlessSchema = { posts };
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const pooled = supabaseDriver(driver, { endpoint: "transaction-pooler" });
		const handle = db(grantlessSchema, pooled);

		await handle.as(asAnon()).transaction(async () => {});

		// the pooler's own transaction-local pins (pooler.ts's
		// PIN_STATEMENTS) come first -- they are this path's own
		// replacement for the session-scoped setupSession pin, sent inside
		// the same transaction.transaction() call, ahead of everything
		// else. Then the context's own statements -- role first, one
		// set_config per setting -- exactly the sequence the default
		// (session) path sends (task 4.7's own test above): the
		// pooled-transaction capability pair only replaces session-state,
		// never the context-application sequence itself
		// (interactive-transactions is the only capability db.as(context)
		// requires).
		expect(sentPerTransaction[0]).toEqual([
			{ sql: "set local intervalstyle to 'postgres'", params: [] },
			{ sql: "set local bytea_output to 'hex'", params: [] },
			{ sql: 'set local role "anon"', params: [] },
			{
				sql: "select set_config($1, $2, true)",
				params: ["request.jwt.claims", '{"role":"anon"}'],
			},
		]);
	});
});
