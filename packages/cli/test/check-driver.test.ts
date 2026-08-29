import { describe, expect, it } from "vitest";
import {
	CHECK_DRIVER_PACKAGE,
	loadCheckDriver,
	resolveConnectionString,
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
