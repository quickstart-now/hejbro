import {
	deleteFrom as coreDeleteFrom,
	insert as coreInsert,
	update as coreUpdate,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import type { ReturnableQuery } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { Db } from "../src/db/db";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});
type Posts = typeof posts;

declare const db: Db<Record<string, never>, { readonly posts: Posts }>;

describe("d106 probe: real chains", () => {
	it("insert chain without returning awaits ReadonlyArray<never>", async () => {
		const chain = db.insert(posts).values({ id: "x", status: "a" });
		type Rows = Awaited<typeof chain>;
		expectTypeOf<Rows>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("insert chain .returning() resolves whole table", async () => {
		const chain = db.insert(posts).values({ id: "x", status: "a" }).returning();
		type Rows = Awaited<typeof chain>;
		expectTypeOf<Rows[number]["status"]>().toEqualTypeOf<string>();
	});

	it("insert chain .returning({...}) resolves exactly projected keys", async () => {
		const chain = db
			.insert(posts)
			.values({ id: "x", status: "a" })
			.returning({ s: posts.status });
		type Rows = Awaited<typeof chain>;
		expectTypeOf<Rows[number]>().toEqualTypeOf<{ readonly s: string }>();
	});

	it("update chain without returning awaits ReadonlyArray<never>", async () => {
		const chain = db.update(posts).set({ status: "b" });
		expectTypeOf<Awaited<typeof chain>>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("delete chain without returning awaits ReadonlyArray<never>", async () => {
		const chain = db.deleteFrom(posts);
		expectTypeOf<Awaited<typeof chain>>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("db.execute on a bare core insert stage resolves ReadonlyArray<never>", async () => {
		const stage = coreInsert(posts).values({ id: "x", status: "a" });
		type Rows = Awaited<ReturnType<Db["execute"]<typeof stage>>>;
		expectTypeOf<Rows>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("db.execute on a core insert with returning() resolves the table shape", async () => {
		const stage = coreInsert(posts)
			.values({ id: "x", status: "a" })
			.returning();
		type Rows = Awaited<ReturnType<Db["execute"]<typeof stage>>>;
		expectTypeOf<Rows[number]["status"]>().toEqualTypeOf<string>();
	});
});

describe("d106 probe: ReturnableQuery assignability (plpgsql ctx.execute/ctx.return)", () => {
	it("a bare insert stage is assignable to ReturnableQuery", () => {
		const stage = coreInsert(posts).values({ id: "x", status: "a" });
		const q: ReturnableQuery = stage;
		expectTypeOf(q).toExtend<ReturnableQuery>();
	});

	it("an insert stage WITH returning() is assignable to ReturnableQuery", () => {
		const stage = coreInsert(posts)
			.values({ id: "x", status: "a" })
			.returning();
		const q: ReturnableQuery = stage;
		expectTypeOf(q).toExtend<ReturnableQuery>();
	});

	it("an insert stage WITH returning({...}) is assignable to ReturnableQuery", () => {
		const stage = coreInsert(posts)
			.values({ id: "x", status: "a" })
			.returning({ s: posts.status });
		const q: ReturnableQuery = stage;
		expectTypeOf(q).toExtend<ReturnableQuery>();
	});

	it("update/delete with returning() are assignable to ReturnableQuery", () => {
		const u: ReturnableQuery = coreUpdate(posts)
			.set({ status: "b" })
			.returning();
		const d: ReturnableQuery = coreDeleteFrom(posts).returning();
		expectTypeOf(u).toExtend<ReturnableQuery>();
		expectTypeOf(d).toExtend<ReturnableQuery>();
	});
});
