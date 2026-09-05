import type { Driver, DriverCapabilities, DriverSession } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import type {
	CheckDriverConnection,
	ConnectionContext,
} from "../src/check/driver";
import {
	assertConnected,
	CHECK_DRIVER_PACKAGE,
	loadCheckDriver,
	resolveConnectionString,
	withCheckConnection,
} from "../src/check/driver";

// `commandName`/`codes` are required everywhere in this module (no
// default -- see its own doc comment on `ConnectionContext`); this file's
// own fixture is `hejbro check`'s real context (its four codes as
// literals, not assembled from a prefix -- #613), since this suite tests
// this module's own behavior for its one existing caller. Group 7's own
// apply-side context (`APPLY_CONNECTION_CODES`, `apply/capability.ts`)
// is exercised through the command tests that use it, not duplicated
// here.
const CHECK_CONTEXT: ConnectionContext = {
	commandName: "hejbro check",
	connectionFlag: "--url",
	codes: {
		connectionMissing: "check-connection-missing",
		driverMissing: "check-driver-missing",
		connectionFailed: "check-connection-failed",
		driverUnclosable: "check-driver-unclosable",
	},
};

// #458 review round 1, task 1.8: `pull`'s own context, its flag `--db-url`
// -- the one command among the seven whose connection flag differs.
const PULL_CONTEXT: ConnectionContext = {
	commandName: "hejbro pull",
	connectionFlag: "--db-url",
	codes: {
		connectionMissing: "pull-connection-missing",
		driverMissing: "pull-driver-missing",
		connectionFailed: "pull-connection-failed",
		driverUnclosable: "pull-driver-unclosable",
	},
};

describe("resolveConnectionString", () => {
	it("prefers --url over DATABASE_URL", () => {
		const result = resolveConnectionString(
			"postgres://from-flag",
			{
				// biome-ignore lint/style/useNamingConvention: DATABASE_URL is the environment variable name itself
				DATABASE_URL: "postgres://from-env",
			},
			CHECK_CONTEXT,
		);

		expect(result).toBe("postgres://from-flag");
	});

	it("falls back to DATABASE_URL when --url is not given", () => {
		const result = resolveConnectionString(
			undefined,
			{
				// biome-ignore lint/style/useNamingConvention: DATABASE_URL is the environment variable name itself
				DATABASE_URL: "postgres://from-env",
			},
			CHECK_CONTEXT,
		);

		expect(result).toBe("postgres://from-env");
	});

	it("refuses with a coded error when neither is given", () => {
		expect(() => resolveConnectionString(undefined, {}, CHECK_CONTEXT)).toThrow(
			expect.objectContaining({ code: "check-connection-missing" }),
		);
	});

	// #458 review round 1, task 1.8: the connection-missing message must
	// name the flag the CALLING command actually accepts -- a table over
	// both contexts, not one hand-picked case, so a command whose own
	// context is wired up wrong shows up as its own row failing.
	const connectionFlagContexts: ReadonlyArray<{
		readonly label: string;
		readonly context: ConnectionContext;
		readonly acceptedFlag: string;
		readonly rejectedFlag: string;
	}> = [
		{
			label: "a check-shaped context",
			context: CHECK_CONTEXT,
			acceptedFlag: "--url",
			rejectedFlag: "--db-url",
		},
		{
			label: "pull's own context",
			context: PULL_CONTEXT,
			acceptedFlag: "--db-url",
			rejectedFlag: "--url",
		},
	];

	it.each(connectionFlagContexts)(
		"names the flag $label's own command accepts, never the other one ($label)",
		({ context, acceptedFlag, rejectedFlag }) => {
			try {
				resolveConnectionString(undefined, {}, context);
				throw new Error("expected resolveConnectionString to throw");
			} catch (error) {
				const message = (error as { message: string }).message;
				expect(message).toContain(acceptedFlag);
				expect(message).not.toContain(rejectedFlag);
			}
		},
	);
});

describe("loadCheckDriver", () => {
	// The importer is injected (never relying on @hejbro/pg's real absence
	// from this package's own dependencies) so this test keeps failing the
	// driver-missing path even after group 6 adds @hejbro/pg as a
	// devDependency for its own live-server suite -- a test that only
	// passes because a package happens not to be installed stops testing
	// anything the moment that stops being true.
	it("names the package to install when the driver is missing", async () => {
		const rejectingImporter = async () => {
			throw Object.assign(
				new Error(`Cannot find package '${CHECK_DRIVER_PACKAGE}'`),
				{ code: "ERR_MODULE_NOT_FOUND" },
			);
		};

		await expect(
			loadCheckDriver(CHECK_CONTEXT, rejectingImporter),
		).rejects.toEqual(
			expect.objectContaining({
				code: "check-driver-missing",
				message: expect.stringContaining(CHECK_DRIVER_PACKAGE),
			}),
		);
	});

	it("rethrows an error unrelated to module resolution as itself", async () => {
		// A real bug inside an *installed* @hejbro/pg (e.g. a syntax error)
		// must surface as itself, not get misreported as "not installed".
		const brokenImporter = async () => {
			throw new SyntaxError("Unexpected token in @hejbro/pg's own module");
		};

		await expect(
			loadCheckDriver(CHECK_CONTEXT, brokenImporter),
		).rejects.toThrow("Unexpected token");
	});
});

describe("withCheckConnection / N2 pool teardown", () => {
	// A driver-shaped fake with a spied `client.end()` -- no real I/O.
	// `execute` succeeds unconditionally: 1.5's own `assertConnected` now
	// legitimately calls it once (the connectivity probe) before `body`
	// ever runs, so these tests exist to prove teardown, not to police
	// which methods get called. `transaction`/`setupSession` are still
	// never called by these tests, so they throw if reached (a bug
	// elsewhere calling them would surface here, not silently pass).
	const fakeCapabilities: DriverCapabilities = {
		"interactive-transactions": false,
		"session-state": false,
		"prepared-statements": false,
		"batched-transactions": false,
	};
	const buildFakeImporter = (ends: number[]) => {
		const connection: CheckDriverConnection = {
			capabilities: fakeCapabilities,
			execute: async () => [],
			transaction: async () => {
				throw new Error("transaction should not be called by this test");
			},
			batch: async () => {
				throw new Error("batch should not be called by this test");
			},
			setupSession: async () => {
				throw new Error("setupSession should not be called by this test");
			},
			client: {
				end: async () => {
					ends.push(1);
				},
			},
		};
		return async () => ({ pgDriver: () => connection });
	};

	it("closes the connection pool after a successful run", async () => {
		const ends: number[] = [];

		const result = await withCheckConnection(
			"postgres://from-flag",
			{},
			CHECK_CONTEXT,
			async () => "report",
			buildFakeImporter(ends),
		);

		expect(result).toBe("report");
		expect(ends).toHaveLength(1);
	});

	it("closes the connection pool after a failing run", async () => {
		const ends: number[] = [];

		await expect(
			withCheckConnection(
				"postgres://from-flag",
				{},
				CHECK_CONTEXT,
				async () => {
					throw new Error("catalog read failed");
				},
				buildFakeImporter(ends),
			),
		).rejects.toThrow("catalog read failed");
		expect(ends).toHaveLength(1);
	});
});

describe("assertConnected / 1.5 connection failures", () => {
	it("reports a refused connection with the driver's own reason, not an empty one", async () => {
		// node-postgres's own real shape for a host that resolves to more
		// than one address and refuses on all of them (measured: connecting
		// to "localhost" with nothing listening) -- an AggregateError whose
		// own `message` is "", with the real per-attempt reasons only in
		// `.errors[]`.
		const refused = Object.assign(
			new AggregateError(
				[
					Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:55499"), {
						code: "ECONNREFUSED",
					}),
					Object.assign(new Error("connect ECONNREFUSED ::1:55499"), {
						code: "ECONNREFUSED",
					}),
				],
				"",
			),
			{ code: "ECONNREFUSED" },
		);
		const session: DriverSession = {
			execute: async () => {
				throw refused;
			},
		};

		await expect(assertConnected(session, CHECK_CONTEXT)).rejects.toEqual(
			expect.objectContaining({
				code: "check-connection-failed",
				message: expect.stringContaining("ECONNREFUSED 127.0.0.1:55499"),
			}),
		);
	});

	it("distinguishes an unreachable database from an unreadable catalog", async () => {
		// Case A: the connectivity probe itself fails (every call to
		// `execute` fails the same way, standing in for a server nothing is
		// listening on) -- always `check-connection-failed`, and a caller
		// composed the way `withCheckConnection` composes it (probe first,
		// `body` only afterward) never reaches `body`.
		const unreachableSession: DriverSession = {
			execute: async () => {
				throw new Error("connect ECONNREFUSED 127.0.0.1:1");
			},
		};
		const catalogRead = vi.fn(async () => "catalog rows");

		await expect(
			assertConnected(unreachableSession, CHECK_CONTEXT).then(catalogRead),
		).rejects.toEqual(
			expect.objectContaining({ code: "check-connection-failed" }),
		);
		expect(catalogRead).not.toHaveBeenCalled();

		// Case B: the connectivity probe succeeds (this session answers
		// "select 1" fine) -- assertConnected itself never throws, so a
		// *later* catalog-read failure keeps whatever code it already
		// carries (readCatalog's own `check-catalog-unreadable`, simulated
		// here), never reclassified by this function.
		const reachableSession: DriverSession = { execute: async () => [] };
		const laterCatalogFailure = vi.fn(async () => {
			throw Object.assign(new Error("permission denied"), {
				code: "check-catalog-unreadable",
			});
		});

		await expect(
			assertConnected(reachableSession, CHECK_CONTEXT),
		).resolves.toBeUndefined();
		await expect(
			assertConnected(reachableSession, CHECK_CONTEXT).then(
				laterCatalogFailure,
			),
		).rejects.toEqual(
			expect.objectContaining({ code: "check-catalog-unreadable" }),
		);
	});

	// #458 review round 1, task 1.8: same table as resolveConnectionString's
	// own, for the connection-failed message this function throws.
	const connectionFailedFlagContexts: ReadonlyArray<{
		readonly label: string;
		readonly context: ConnectionContext;
		readonly acceptedFlag: string;
		readonly rejectedFlag: string;
	}> = [
		{
			label: "a check-shaped context",
			context: CHECK_CONTEXT,
			acceptedFlag: "--url",
			rejectedFlag: "--db-url",
		},
		{
			label: "pull's own context",
			context: PULL_CONTEXT,
			acceptedFlag: "--db-url",
			rejectedFlag: "--url",
		},
	];

	it.each(connectionFailedFlagContexts)(
		"names the flag $label's own command accepts, never the other one ($label)",
		async ({ context, acceptedFlag, rejectedFlag }) => {
			const failingSession: DriverSession = {
				execute: async () => {
					throw new Error("connect ECONNREFUSED 127.0.0.1:1");
				},
			};

			await expect(assertConnected(failingSession, context)).rejects.toEqual(
				expect.objectContaining({
					message: expect.stringContaining(acceptedFlag),
				}),
			);
			try {
				await assertConnected(failingSession, context);
				throw new Error("expected assertConnected to throw");
			} catch (error) {
				const message = (error as { message: string }).message;
				expect(message).not.toContain(rejectedFlag);
			}
		},
	);
});

describe("withCheckConnection / configured factory (#458 task 1.2)", () => {
	// The same driver shape group 7's own fake used, so unrelated methods
	// still throw if a bug reaches them instead of silently passing.
	const fakeCapabilities: DriverCapabilities = {
		"interactive-transactions": false,
		"session-state": false,
		"prepared-statements": false,
		"batched-transactions": false,
	};

	const buildClosableDriver = (ends: number[]): CheckDriverConnection => ({
		capabilities: fakeCapabilities,
		execute: async () => [],
		transaction: async () => {
			throw new Error("transaction should not be called by this test");
		},
		batch: async () => {
			throw new Error("batch should not be called by this test");
		},
		setupSession: async () => {
			throw new Error("setupSession should not be called by this test");
		},
		client: {
			end: async () => {
				ends.push(1);
			},
		},
	});

	it("calls a sync factory exactly once with the resolved string, never the importer, and closes it after the body", async () => {
		const ends: number[] = [];
		const calls: string[] = [];
		const factory = (connectionString: string) => {
			calls.push(connectionString);
			return buildClosableDriver(ends);
		};
		const importer = vi.fn(async () => {
			throw new Error("the importer must not run when a factory is configured");
		});

		const result = await withCheckConnection(
			"postgres://from-flag",
			{},
			CHECK_CONTEXT,
			async () => "report",
			importer,
			factory,
		);

		expect(result).toBe("report");
		expect(calls).toEqual(["postgres://from-flag"]);
		expect(importer).not.toHaveBeenCalled();
		expect(ends).toHaveLength(1);
	});

	it("awaits an async factory the same way", async () => {
		const ends: number[] = [];
		const factory = async (connectionString: string) => {
			expect(connectionString).toBe("postgres://from-flag");
			return buildClosableDriver(ends);
		};

		const result = await withCheckConnection(
			"postgres://from-flag",
			{},
			CHECK_CONTEXT,
			async () => "report",
			undefined,
			factory,
		);

		expect(result).toBe("report");
		expect(ends).toHaveLength(1);
	});

	it("surfaces a throwing factory as the command's own connection-failed diagnostic, never calling the importer", async () => {
		const importer = vi.fn();
		const factory = () => {
			throw new Error("boom from the configured factory");
		};

		await expect(
			withCheckConnection(
				"postgres://from-flag",
				{},
				CHECK_CONTEXT,
				async () => "report",
				importer,
				factory,
			),
		).rejects.toEqual(
			expect.objectContaining({
				code: "check-connection-failed",
				message: expect.stringContaining("boom from the configured factory"),
			}),
		);
		expect(importer).not.toHaveBeenCalled();
	});

	// #458 review round 1, task 1.7: `hasClosableClient` must refuse every
	// shape a factory could hand back that has no way to close, never
	// crash on one -- a table, not one example (D110), so a guard that is
	// consistent on its neighbours but not on `null`/`undefined` shows up
	// as exactly those two rows failing, not a hand-picked single case.
	// `buildDriver` takes the shared `execute` spy and returns the exact
	// value the factory hands back, so every row's own shape is concrete,
	// never assembled from a base at the call site.
	const unclosableDriverRows: ReadonlyArray<{
		readonly label: string;
		readonly buildDriver: (
			execute: () => Promise<ReadonlyArray<unknown>>,
		) => unknown;
	}> = [
		{
			label: "no client member at all",
			buildDriver: (execute) => ({
				capabilities: fakeCapabilities,
				execute,
				transaction: async () => {
					throw new Error("transaction should not be called by this test");
				},
				setupSession: async () => {
					throw new Error("setupSession should not be called by this test");
				},
			}),
		},
		{
			label: "client: null",
			buildDriver: (execute) => ({
				capabilities: fakeCapabilities,
				execute,
				transaction: async () => {
					throw new Error("transaction should not be called by this test");
				},
				setupSession: async () => {
					throw new Error("setupSession should not be called by this test");
				},
				client: null,
			}),
		},
		{
			label: "client.end is not a function (42)",
			buildDriver: (execute) => ({
				capabilities: fakeCapabilities,
				execute,
				transaction: async () => {
					throw new Error("transaction should not be called by this test");
				},
				setupSession: async () => {
					throw new Error("setupSession should not be called by this test");
				},
				client: { end: 42 },
			}),
		},
		{
			label: "a top-level end, no client wrapper",
			buildDriver: (execute) => ({
				capabilities: fakeCapabilities,
				execute,
				transaction: async () => {
					throw new Error("transaction should not be called by this test");
				},
				setupSession: async () => {
					throw new Error("setupSession should not be called by this test");
				},
				end: async () => {},
			}),
		},
		{ label: "a number, not an object", buildDriver: () => 42 },
		{ label: "null", buildDriver: () => null },
		{ label: "undefined", buildDriver: () => undefined },
	];

	it.each(unclosableDriverRows)(
		"refuses a factory-built driver with no way to close before any statement is sent, naming the field and the missing member ($label)",
		async ({ buildDriver }) => {
			const executed = vi.fn(async () => []);
			const factory = () => buildDriver(executed) as Driver;

			await expect(
				withCheckConnection(
					"postgres://from-flag",
					{},
					CHECK_CONTEXT,
					async () => "report",
					undefined,
					factory,
				),
			).rejects.toEqual(
				expect.objectContaining({
					code: "check-driver-unclosable",
					message: expect.stringContaining("driver"),
				}),
			);
			await expect(
				withCheckConnection(
					"postgres://from-flag",
					{},
					CHECK_CONTEXT,
					async () => "report",
					undefined,
					factory,
				),
			).rejects.toEqual(
				expect.objectContaining({
					message: expect.stringContaining("client.end"),
				}),
			);
			expect(executed).not.toHaveBeenCalled();
		},
	);

	// #458 review round 1, task 1.7 guardrail: the new non-null-object
	// guard must never refuse a *legitimate* driver -- an async factory,
	// and the exact shape the preset docs show (a base driver spread,
	// then a decorator field added, mirroring `supabaseDriver`/
	// `nileDriver`'s own `{ ...driver, contributedRoles: [...] }`).
	it("still admits an async factory returning a spread-decorated driver, the shape the preset docs show", async () => {
		const ends: number[] = [];
		const base: CheckDriverConnection = buildClosableDriver(ends);
		const factory = async () => ({
			...base,
			contributedRoles: ["anon", "authenticated"],
		});

		const result = await withCheckConnection(
			"postgres://from-flag",
			{},
			CHECK_CONTEXT,
			async () => "report",
			undefined,
			factory,
		);

		expect(result).toBe("report");
		expect(ends).toHaveLength(1);
	});

	it("still closes the connection after a failing body when a factory is configured", async () => {
		const ends: number[] = [];
		const factory = () => buildClosableDriver(ends);

		await expect(
			withCheckConnection(
				"postgres://from-flag",
				{},
				CHECK_CONTEXT,
				async () => {
					throw new Error("body failed");
				},
				undefined,
				factory,
			),
		).rejects.toThrow("body failed");
		expect(ends).toHaveLength(1);
	});

	it("refuses a missing connection before the factory ever runs", async () => {
		const factory = vi.fn();

		await expect(
			withCheckConnection(
				undefined,
				{},
				CHECK_CONTEXT,
				async () => "report",
				undefined,
				factory,
			),
		).rejects.toEqual(
			expect.objectContaining({ code: "check-connection-missing" }),
		);
		expect(factory).not.toHaveBeenCalled();
	});
});
