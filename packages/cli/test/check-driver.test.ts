import type { DriverCapabilities } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type { CheckDriverConnection } from "../src/check/driver";
import {
	CHECK_DRIVER_PACKAGE,
	loadCheckDriver,
	resolveConnectionString,
	withCheckConnection,
} from "../src/check/driver";

describe("resolveConnectionString", () => {
	it("prefers --url over DATABASE_URL", () => {
		const result = resolveConnectionString("postgres://from-flag", {
			// biome-ignore lint/style/useNamingConvention: DATABASE_URL is the environment variable name itself
			DATABASE_URL: "postgres://from-env",
		});

		expect(result).toBe("postgres://from-flag");
	});

	it("falls back to DATABASE_URL when --url is not given", () => {
		const result = resolveConnectionString(undefined, {
			// biome-ignore lint/style/useNamingConvention: DATABASE_URL is the environment variable name itself
			DATABASE_URL: "postgres://from-env",
		});

		expect(result).toBe("postgres://from-env");
	});

	it("refuses with a coded error when neither is given", () => {
		expect(() => resolveConnectionString(undefined, {})).toThrow(
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

		await expect(loadCheckDriver(rejectingImporter)).rejects.toEqual(
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

		await expect(loadCheckDriver(brokenImporter)).rejects.toThrow(
			"Unexpected token",
		);
	});
});

describe("withCheckConnection / N2 pool teardown", () => {
	// A driver-shaped fake with a spied `client.end()` -- no real I/O, and
	// `execute`/`transaction`/`setupSession` are never called by these
	// tests, so they throw if reached (a bug elsewhere calling them would
	// surface here, not silently pass).
	const fakeCapabilities: DriverCapabilities = {
		"interactive-transactions": false,
		"session-state": false,
	};
	const buildFakeImporter = (ends: number[]) => {
		const connection: CheckDriverConnection = {
			capabilities: fakeCapabilities,
			execute: async () => {
				throw new Error("execute should not be called by this test");
			},
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
				async () => {
					throw new Error("catalog read failed");
				},
				buildFakeImporter(ends),
			),
		).rejects.toThrow("catalog read failed");
		expect(ends).toHaveLength(1);
	});
});
