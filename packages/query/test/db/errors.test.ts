import { eq, insert, schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/db";
import type { Driver } from "../../src/driver/contract";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

/** A value distinctive enough that finding it anywhere in a wrapper error would prove `params` leaked -- never itself planted in the fake driver's own error, so a positive hit can only come from `compiled.params`. */
const MARKER = "adversarial-marker-f3c9a7b1";

const driverThatThrows = (driverError: Error): Driver => ({
	capabilities: {
		"interactive-transactions": true,
		"session-state": true,
		"prepared-statements": false,
		"batched-transactions": false,
	},
	execute: vi.fn(async () => {
		throw driverError;
	}),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => []) }),
	),
	batch: vi.fn(async () => []),
	setupSession: vi.fn(async () => {}),
});

describe("query-execution-failed (task 4.5)", () => {
	it("constraint violation rejects with cause and value-free, parameterized SQL text", async () => {
		const driverError = new Error(
			"duplicate key value violates unique constraint",
		);
		const driver = driverThatThrows(driverError);
		const handle = db({ posts }, driver);
		const statement = select(posts).where(eq(posts.status, MARKER));

		try {
			await handle.execute(statement);
			expect.unreachable("execute should have rejected");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "query-execution-failed");
			expect(error).toHaveProperty("kind", "select");
			expect(error).toHaveProperty("cause", driverError);
			const message = (error as Error).message;
			// the SQL text is present, parameterized -- never the value itself.
			expect(message).toContain("$1");
			expect(message).not.toContain(MARKER);
			expect(message).toMatch(/Next:/);
			// params never appear anywhere in the wrapper error's own surface:
			// not as a field, not in JSON serialization, not via String()/stack.
			expect(Object.keys(error as object)).not.toContain("params");
			expect(JSON.stringify(error)).not.toContain(MARKER);
			expect(String(error)).not.toContain(MARKER);
			expect((error as Error).stack ?? "").not.toContain(MARKER);
		}
	});

	it("no retry -- the driver's execute runs exactly once per db.execute() call", async () => {
		const driver = driverThatThrows(new Error("boom"));
		const handle = db({ posts }, driver);

		await expect(handle.execute(select(posts))).rejects.toThrow();

		expect(driver.execute).toHaveBeenCalledTimes(1);
	});

	it('kind travels with the wrapper -- not hardcoded to "select" (an insert rejects with kind "insert")', async () => {
		const driver = driverThatThrows(new Error("boom"));
		const handle = db({ posts }, driver);

		try {
			await handle.execute(insert(posts).values({ status: "draft" }));
			expect.unreachable("execute should have rejected");
		} catch (error) {
			expect(error).toHaveProperty("kind", "insert");
		}
	});
});

describe("driver-message fidelity (#427)", () => {
	it("the driver's own message leads the failure message", async () => {
		const driverError = new Error(
			'duplicate key value violates unique constraint "users_email_key"',
		);
		const handle = db({ posts }, driverThatThrows(driverError));

		try {
			await handle.execute(select(posts).where(eq(posts.status, MARKER)));
			expect.unreachable("execute should have rejected");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain(driverError.message);
			// the reason leads; the (possibly long) SQL follows it -- located
			// by its bind placeholder, since the word "select" also appears
			// earlier in the kind marker.
			expect(message.indexOf(driverError.message)).toBeLessThan(
				message.indexOf("$1"),
			);
			expect(message).toContain("$1");
			expect(message).not.toContain(MARKER);
		}
	});

	it("a server-echoed value is carried, not scrubbed", async () => {
		const echoed = 'invalid input syntax for type integer: "not-a-number"';
		const handle = db({ posts }, driverThatThrows(new Error(echoed)));

		await expect(handle.execute(select(posts))).rejects.toThrow(
			expect.objectContaining({ message: expect.stringContaining(echoed) }),
		);
	});

	it("a string cause is carried as the reason", async () => {
		const driver: Driver = {
			capabilities: {
				"interactive-transactions": true,
				"session-state": true,
				"prepared-statements": false,
				"batched-transactions": false,
			},
			execute: vi.fn(async () => {
				throw "socket hang up";
			}),
			transaction: vi.fn(async (callback) =>
				callback({ execute: vi.fn(async () => []) }),
			),
			batch: vi.fn(async () => []),
			setupSession: vi.fn(async () => {}),
		};
		const handle = db({ posts }, driver);

		await expect(handle.execute(select(posts))).rejects.toThrow(
			expect.objectContaining({
				message: expect.stringContaining("socket hang up"),
			}),
		);
	});

	it("an empty-message Error cause is named, not interpolated blank", async () => {
		const handle = db({ posts }, driverThatThrows(new Error("")));

		try {
			await handle.execute(select(posts).where(eq(posts.status, MARKER)));
			expect.unreachable("execute should have rejected");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toMatch(/no message|non-error/i);
			expect(message).not.toContain("undefined");
			expect(message).toContain("$1");
			expect(message).not.toContain(MARKER);
		}
	});

	it("a non-error cause is named, not interpolated", async () => {
		const driver: Driver = {
			capabilities: {
				"interactive-transactions": true,
				"session-state": true,
				"prepared-statements": false,
				"batched-transactions": false,
			},
			execute: vi.fn(async () => {
				throw { weird: true };
			}),
			transaction: vi.fn(async (callback) =>
				callback({ execute: vi.fn(async () => []) }),
			),
			batch: vi.fn(async () => []),
			setupSession: vi.fn(async () => {}),
		};
		const handle = db({ posts }, driver);

		try {
			await handle.execute(select(posts));
			expect.unreachable("execute should have rejected");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).not.toContain("undefined");
			expect(message).not.toContain("[object Object]");
			expect(message).toMatch(/no message|non-error/i);
			expect(message).toContain("select");
			expect(message).toMatch(/Next:/);
		}
	});
});
