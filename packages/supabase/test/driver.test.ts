import { roleName, schema, table, uuid } from "@hejbro/core";
import type { Driver, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { assertSessionStateConformance } from "@hejbro/query/testing/driver-conformance";
import { describe, expect, it, vi } from "vitest";
import { asAnon, asUser } from "../src/context";
import { supabaseDriver } from "../src/driver";
import { anonRole, authenticatedRole, serviceRole } from "../src/roles";

/** A minimal contract `Driver` fixture -- no concrete driver implementation, mirroring `packages/query/test/db/db.test.ts`'s own `fakeDriver`. */
const fakeDriver = (): Driver => ({
	capabilities: { "interactive-transactions": true, "session-state": true },
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
		capabilities: { "interactive-transactions": true, "session-state": true },
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
			capabilities: { "interactive-transactions": true, "session-state": true },
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
