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
	// @hejbro/pg is deliberately absent from this package's own
	// dependencies (proposal.md: an optional peer, resolved from the
	// user's project at runtime) -- so in this repo's own test
	// environment the dynamic import is guaranteed to miss, exercising
	// the real "not installed" path without any mocking.
	it("names the package to install when the driver is missing", async () => {
		await expect(loadCheckDriver()).rejects.toEqual(
			expect.objectContaining({
				code: "check-driver-missing",
				message: expect.stringContaining(CHECK_DRIVER_PACKAGE),
			}),
		);
	});
});
