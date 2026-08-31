import type { DriverCapabilities, DriverSession } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import type { SyncDriverConnection } from "../src/sync/connection";
import {
	assertConnected,
	loadSyncDriver,
	resolveConnectionString,
	SYNC_DRIVER_PACKAGE,
	withSyncConnection,
} from "../src/sync/connection";

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

	it("names what to supply when no connection is given", () => {
		expect(() => resolveConnectionString(undefined, {})).toThrow(
			expect.objectContaining({ code: "sync-connection-missing" }),
		);
	});
});

describe("loadSyncDriver", () => {
	// Injected importer, same reasoning as check-driver.test.ts's own: a
	// test that only passes because a package happens not to be installed
	// stops testing anything the moment that stops being true.
	it("names the driver package to install", async () => {
		const rejectingImporter = async () => {
			throw Object.assign(
				new Error(`Cannot find package '${SYNC_DRIVER_PACKAGE}'`),
				{ code: "ERR_MODULE_NOT_FOUND" },
			);
		};

		await expect(loadSyncDriver(rejectingImporter)).rejects.toEqual(
			expect.objectContaining({
				code: "sync-driver-missing",
				message: expect.stringContaining(SYNC_DRIVER_PACKAGE),
			}),
		);
	});

	it("rethrows an error unrelated to module resolution as itself", async () => {
		const brokenImporter = async () => {
			throw new SyntaxError("Unexpected token in @hejbro/pg's own module");
		};

		await expect(loadSyncDriver(brokenImporter)).rejects.toThrow(
			"Unexpected token",
		);
	});
});

describe("withSyncConnection / pool teardown", () => {
	const fakeCapabilities: DriverCapabilities = {
		"interactive-transactions": false,
		"session-state": false,
	};
	const buildFakeImporter = (ends: number[]) => {
		const connection: SyncDriverConnection = {
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

		const result = await withSyncConnection(
			"postgres://from-flag",
			{},
			async () => "module text",
			buildFakeImporter(ends),
		);

		expect(result).toBe("module text");
		expect(ends).toHaveLength(1);
	});

	it("closes the connection pool after a failing run", async () => {
		const ends: number[] = [];

		await expect(
			withSyncConnection(
				"postgres://from-flag",
				{},
				async () => {
					throw new Error("manifest read failed");
				},
				buildFakeImporter(ends),
			),
		).rejects.toThrow("manifest read failed");
		expect(ends).toHaveLength(1);
	});
});

describe("assertConnected", () => {
	it("reports a refused connection with the driver's own reason, not an empty one", async () => {
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

		await expect(assertConnected(session)).rejects.toEqual(
			expect.objectContaining({
				code: "sync-connection-failed",
				message: expect.stringContaining("ECONNREFUSED 127.0.0.1:55499"),
			}),
		);
	});

	it("distinguishes an unreachable database from a later manifest-read failure", async () => {
		const unreachableSession: DriverSession = {
			execute: async () => {
				throw new Error("connect ECONNREFUSED 127.0.0.1:1");
			},
		};
		const manifestRead = vi.fn(async () => "manifest row");

		await expect(
			assertConnected(unreachableSession).then(manifestRead),
		).rejects.toEqual(
			expect.objectContaining({ code: "sync-connection-failed" }),
		);
		expect(manifestRead).not.toHaveBeenCalled();

		const reachableSession: DriverSession = { execute: async () => [] };
		const laterManifestFailure = vi.fn(async () => {
			throw Object.assign(new Error("no manifest table"), {
				code: "sync-manifest-absent",
			});
		});

		await expect(assertConnected(reachableSession)).resolves.toBeUndefined();
		await expect(
			assertConnected(reachableSession).then(laterManifestFailure),
		).rejects.toEqual(
			expect.objectContaining({ code: "sync-manifest-absent" }),
		);
	});
});
