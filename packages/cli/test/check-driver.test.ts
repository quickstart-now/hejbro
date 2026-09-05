import type { DriverCapabilities, DriverSession } from "@hejbro/query";
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
// own fixture is `hejbro check`'s real context (its three codes as
// literals, not assembled from a prefix -- #613), since this suite tests
// this module's own behavior for its one existing caller. Group 7's own
// apply-side context (`APPLY_CONNECTION_CODES`, `apply/capability.ts`)
// is exercised through the command tests that use it, not duplicated
// here.
const CHECK_CONTEXT: ConnectionContext = {
	commandName: "hejbro check",
	codes: {
		connectionMissing: "check-connection-missing",
		driverMissing: "check-driver-missing",
		connectionFailed: "check-connection-failed",
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
	};
	const buildFakeImporter = (ends: number[]) => {
		const connection: CheckDriverConnection = {
			capabilities: fakeCapabilities,
			execute: async () => [],
			transaction: async () => {
				throw new Error("transaction should not be called by this test");
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
});
