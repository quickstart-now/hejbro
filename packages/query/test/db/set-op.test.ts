import { bigint, schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");
const activeUsers = table(app, "active_users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
	score: bigint().notNull(),
});
const archivedUsers = table(app, "archived_users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
	score: bigint(),
});
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
});

describe("chain set-op combinators (add-set-operations task 3.3)", () => {
	it("chain union compiles byte-identically to the core builder formulation and resolves converted rows", async () => {
		const raw = [
			{
				id: "0b0e5b3e-0000-4000-8000-000000000001",
				name: "mo",
				score: "9007199254740993",
			},
		];
		const { driver } = recordingTransactionalDriver({ rows: raw });
		const handle = db({ app, activeUsers, archivedUsers, posts }, driver);

		const chained = handle
			.select(activeUsers)
			.union(handle.select(archivedUsers))
			.orderBy(activeUsers.name)
			.limit(5);
		const viaCore = compile(
			select(activeUsers)
				.union(select(archivedUsers))
				.orderBy(activeUsers.name)
				.limit(5),
		);
		expect(chained.compile().sql).toBe(viaCore.sql);
		expect(chained.compile().params).toEqual(viaCore.params);

		const rows = await chained;
		expect(rows[0]?.score).toBe(9007199254740993n);
		type Row = Awaited<typeof chained>[number];
		expectTypeOf<Row["score"]>().toEqualTypeOf<bigint | null>();
		expectTypeOf<Row["name"]>().toEqualTypeOf<string>();
	});

	it("mismatched branch shapes fail to type-check", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, activeUsers, archivedUsers, posts }, driver);
		// @ts-expect-error posts' row keys differ from activeUsers' -- the database would reject the union
		const bad = () => handle.select(activeUsers).union(handle.select(posts));
		expect(typeof bad).toBe("function");
	});
});
