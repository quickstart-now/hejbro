import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { pgDriver } from "../src/driver";

describe("pgDriver(pool) (owner decision ①, task 5.1)", () => {
	it("declares interactive-transactions and session-state true", () => {
		const pool = new Pool({
			connectionString: "postgres://localhost/does-not-need-to-connect",
		});
		const driver = pgDriver(pool);
		expect(driver.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": true,
		});
	});

	it("exposes the caller's own pool as client, the same reference -- one surface, no divergence (owner decision ②)", () => {
		const pool = new Pool({
			connectionString: "postgres://localhost/does-not-need-to-connect",
		});
		const driver = pgDriver(pool);
		expect(driver.client).toBe(pool);
	});
});

describe("pgDriver(connectionString) (owner decision ②, task 5.2)", () => {
	it("a connection-string driver exposes its own pool as client", () => {
		const driver = pgDriver("postgres://localhost/does-not-need-to-connect");
		expect(driver.client).toBeInstanceOf(Pool);
		expect(driver.client.options.connectionString).toBe(
			"postgres://localhost/does-not-need-to-connect",
		);
	});

	it("never auto-closes the pool it constructed (owner decision ②: pool lifetime = process lifetime)", () => {
		const driver = pgDriver("postgres://localhost/does-not-need-to-connect");
		expect(driver.client.ended).toBe(false);
	});
});
