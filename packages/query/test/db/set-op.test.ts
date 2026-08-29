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

describe("chain union refuses branches whose key order differs (#487, second half — group 8)", () => {
	// same key SET ({email, city}) on both tables, declared in a
	// different order -- the chain builds its own setOp node directly
	// (never routing through core's combineSetOp), so it needs its own
	// call to the same order guard, or this, the primary user-facing
	// surface, would still silently corrupt data (measured on
	// postgres:17, group 8's own core-level red).
	const usersByEmail = table(app, "chain_users_by_email", {
		email: text().notNull(),
		city: text().notNull(),
	});
	const usersByCity = table(app, "chain_users_by_city", {
		city: text().notNull(),
		email: text().notNull(),
	});

	it("the chain's union refuses branches whose key order differs", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, usersByEmail, usersByCity }, driver);
		expect(() =>
			handle.select(usersByEmail).union(handle.select(usersByCity)),
		).toThrow(
			/set-op-key-order-mismatch|left: \(email, city\), right: \(city, email\)/,
		);
	});
});

describe("left-branch conversion and codec/retarget gaps (review F4-F6)", () => {
	it("rows convert per the LEFT branch's declarations when modes differ (F4)", async () => {
		const leftLedger = table(app, "left_ledger", {
			id: uuid().primaryKey(),
			amount: bigint({ mode: "number" }).notNull(),
		});
		const rightLedger = table(app, "right_ledger", {
			id: uuid().primaryKey(),
			amount: bigint().notNull(),
		});
		const raw = [{ id: "0b0e5b3e-0000-4000-8000-000000000001", amount: "123" }];
		const { driver } = recordingTransactionalDriver({ rows: raw });
		const handle = db({ app, leftLedger, rightLedger }, driver);
		const rows = await handle
			.select(leftLedger)
			.unionAll(handle.select(rightLedger));
		// the LEFT branch declares mode "number" -- the arrival is a plain
		// number, never the right branch's bigint (the review-F4 mutant
		// flips the plan to the right branch and must die here).
		expect(rows[0]?.amount).toBe(123);
		expect(typeof rows[0]?.amount).toBe("number");
	});
});
