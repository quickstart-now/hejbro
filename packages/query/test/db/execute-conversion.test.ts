import {
	bigint,
	interval,
	roleName,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/db";
import type { Driver, DriverRow } from "../../src/driver/contract";
import { sql } from "../../src/sql";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	duration: interval(),
});

/** int8 text beyond Number.MAX_SAFE_INTEGER -- only correct as bigint/string, never a plain number; catches a driver that quietly hands back a JS number instead of the declared bigint. */
const rawRow = {
	id: "11111111-1111-1111-1111-111111111111",
	status: "draft",
	amount: "9007199254740993",
	duration: "1 year 2 mons 3 days 04:05:06.789123",
};

const fakeDriver = (rows: ReadonlyArray<DriverRow>): Driver => ({
	capabilities: {
		"interactive-transactions": true,
		"session-state": true,
		"prepared-statements": false,
	},
	execute: vi.fn(async () => rows),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => rows) }),
	),
	setupSession: vi.fn(async () => {}),
});

describe("db().execute wires task 4.4's conversion into the real pipeline (task 4.4-wiring)", () => {
	it("bigint text and interval text arrive converted -- not the driver's raw text", async () => {
		const driver = fakeDriver([rawRow]);
		const handle = db({ posts }, driver);

		const rows = await handle.execute(select(posts));

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
		expect(rows[0]?.duration).toEqual({
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 789123,
		});
	});

	it("a column with no declared conversion (uuid/text) passes through the execute() path exactly as the driver gave it -- a direct assertion, not incidental coverage from a test aimed at something else (recommended, batch B follow-up)", async () => {
		const driver = fakeDriver([rawRow]);
		const handle = db({ posts }, driver);

		const rows = await handle.execute(select(posts));

		expect(rows[0]?.id).toBe("11111111-1111-1111-1111-111111111111");
		expect(rows[0]?.status).toBe("draft");
	});

	it("the same conversion runs inside a transaction's tx.execute() -- not just the top-level path", async () => {
		const driver = fakeDriver([rawRow]);
		const handle = db({ posts }, driver);

		const rows = await handle.transaction((tx) => tx.execute(select(posts)));

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(rows[0]?.duration).toEqual({
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 789123,
		});
	});

	it("the same conversion runs through db.as(context).execute() -- not just the unscoped and transaction paths (owner review, batch C)", async () => {
		const driver = fakeDriver([rawRow]);
		const handle = db({ posts }, driver, { roles: [roleName("app_reader")] });

		const rows = await handle
			.as({ role: roleName("app_reader") })
			.execute(select(posts));

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("a poisoned cell surfaces result-conversion-failed through db().execute() itself, not just convert.ts's own unit tests", async () => {
		const driver = fakeDriver([{ ...rawRow, amount: "not-a-number" }]);
		const handle = db({ posts }, driver);

		try {
			await handle.execute(select(posts));
			expect.unreachable("execute should have rejected");
		} catch (error) {
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "amount");
		}
	});

	it("the sql escape hatch's rows pass through completely unchanged -- no declared column to convert against", async () => {
		const driver = fakeDriver([{ one: 1 }]);
		const handle = db({ posts }, driver);

		const rows = await handle.execute(sql`select 1 as one`);

		expect(rows).toEqual([{ one: 1 }]);
	});
});
