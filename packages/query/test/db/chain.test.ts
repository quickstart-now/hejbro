import { bigint, eq, schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import type { Driver, DriverRow } from "../../src/driver/contract";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

/** int8 text beyond Number.MAX_SAFE_INTEGER -- only correct as bigint, never a plain number (same fixture reasoning as execute-conversion.test.ts). */
const rawRow = {
	id: "11111111-1111-1111-1111-111111111111",
	status: "published",
	amount: "9007199254740993",
};

/** A driver whose `execute` is a plain `vi.fn` spy, so a test can assert it was never called before `await` (the thenable-inertness negative probe) as well as inspect its call count/arguments afterward. */
const fakeDriver = (rows: ReadonlyArray<DriverRow>): Driver => ({
	capabilities: { "interactive-transactions": true, "session-state": true },
	execute: vi.fn(async () => rows),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => rows) }),
	),
	setupSession: vi.fn(async () => {}),
});

describe("db().select chain (task 7.1)", () => {
	it("await on a select chain returns converted rows; before await no driver call is made", async () => {
		const driver = fakeDriver([rawRow]);
		const handle = db({ posts }, driver);

		const chain = handle
			.select(posts)
			.where(eq(posts.status, "published"))
			.orderBy(posts.id)
			.limit(10);

		// inertness (decision ③): building a chain, including every stage,
		// never touches the driver until it is actually awaited.
		expect(driver.execute).not.toHaveBeenCalled();

		const rows = await chain;

		expect(driver.execute).toHaveBeenCalledTimes(1);
		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("where() delegates to core's own select().where() -- compiled SQL is identical to the equivalent core builder chain (delegation mutation: a reimplemented where would drift)", () => {
		const driver = fakeDriver([]);
		const handle = db({ posts }, driver);

		const chainCompiled = handle
			.select(posts)
			.where(eq(posts.status, "published"))
			.compile();
		const coreCompiled = compile(
			select(posts).where(eq(posts.status, "published")),
		);

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("orderBy() delegates to core's own select().orderBy()", () => {
		const driver = fakeDriver([]);
		const handle = db({ posts }, driver);

		const chainCompiled = handle.select(posts).orderBy(posts.status).compile();
		const coreCompiled = compile(select(posts).orderBy(posts.status));

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("limit() delegates to core's own select().limit()", () => {
		const driver = fakeDriver([]);
		const handle = db({ posts }, driver);

		const chainCompiled = handle.select(posts).limit(5).compile();
		const coreCompiled = compile(select(posts).limit(5));

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("innerJoin() delegates to core's own select().innerJoin()", () => {
		const driver = fakeDriver([]);
		const handle = db({ posts, comments }, driver);
		const on = eq(posts.id, comments.postId);

		const chainCompiled = handle
			.select(posts)
			.innerJoin(comments, on)
			.compile();
		const coreCompiled = compile(select(posts).innerJoin(comments, on));

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("leftJoin() delegates to core's own select().leftJoin() -- never silently collapsed into innerJoin", () => {
		const driver = fakeDriver([]);
		const handle = db({ posts, comments }, driver);
		const on = eq(posts.id, comments.postId);

		const chainCompiled = handle.select(posts).leftJoin(comments, on).compile();
		const coreCompiled = compile(select(posts).leftJoin(comments, on));

		expect(chainCompiled).toEqual(coreCompiled);
		expect(chainCompiled.sql).toContain("left join");
	});

	it("select({alias: expr}, table) -- the object-projection form -- also chains and awaits", async () => {
		// projection aliases render snake_case (D57 naming), so the driver
		// row's own key is "the_status", not the camelCase call-site alias.
		// biome-ignore lint/style/useNamingConvention: the_status models the real driver row key toSnakeCase(alias) produces -- the test's whole point is that alias.
		const driver = fakeDriver([{ the_status: "published" }]);
		const handle = db({ posts }, driver);

		const rows = await handle.select({ theStatus: posts.status }, posts);

		// biome-ignore lint/style/useNamingConvention: same snake_case alias key as the fixture above.
		expect(rows).toEqual([{ the_status: "published" }]);
	});
});
