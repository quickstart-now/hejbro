import {
	bigint,
	deleteFrom,
	eq,
	insert,
	roleName,
	schema,
	select,
	table,
	text,
	update,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

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

describe("db().select chain (task 7.1)", () => {
	it("await on a select chain returns converted rows; before await no driver call is made", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [rawRow],
		});
		const handle = db({ posts }, driver);

		const chain = handle
			.select(posts)
			.where(eq(posts.status, "published"))
			.orderBy(posts.id)
			.limit(10);

		// inertness (decision ③): building a chain, including every stage,
		// never touches the driver until it is actually awaited. Unscoped
		// chains run directly on the driver (no transaction opened), so the
		// top-level record is what's asserted here; a scoped/tx chain's
		// same proof (task 7.4) checks `sentPerTransaction` instead.
		expect(topLevelSent).toHaveLength(0);

		const rows = await chain;

		expect(topLevelSent).toHaveLength(1);
		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("where() delegates to core's own select().where() -- compiled SQL is identical to the equivalent core builder chain (delegation mutation: a reimplemented where would drift)", () => {
		const { driver } = recordingTransactionalDriver();
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
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);

		const chainCompiled = handle.select(posts).orderBy(posts.status).compile();
		const coreCompiled = compile(select(posts).orderBy(posts.status));

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("limit() delegates to core's own select().limit()", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);

		const chainCompiled = handle.select(posts).limit(5).compile();
		const coreCompiled = compile(select(posts).limit(5));

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("innerJoin() delegates to core's own select().innerJoin()", () => {
		const { driver } = recordingTransactionalDriver();
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
		const { driver } = recordingTransactionalDriver();
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
		const { driver, topLevelSent } = recordingTransactionalDriver({
			// biome-ignore lint/style/useNamingConvention: the_status models the real driver row key toSnakeCase(alias) produces -- the test's whole point is that alias.
			rows: [{ the_status: "published" }],
		});
		const handle = db({ posts }, driver);

		const rows = await handle.select({ theStatus: posts.status }, posts);

		// biome-ignore lint/style/useNamingConvention: same snake_case alias key as the fixture above.
		expect(rows).toEqual([{ the_status: "published" }]);
		expect(topLevelSent).toHaveLength(1);
	});
});

describe("db().insert/update/deleteFrom chains (task 7.2)", () => {
	it("insert(...).values(...) with no returning() resolves exactly like db.execute of the same statement -- empty rows, one driver call, inert until awaited", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);
		const row = { id: rawRow.id, status: "draft" };

		const chain = handle.insert(posts).values(row);
		expect(topLevelSent).toHaveLength(0);

		const chainRows = await chain;
		const executeRows = await handle.execute(insert(posts).values(row));

		expect(chainRows).toEqual([]);
		expect(chainRows).toEqual(executeRows);
		expect(topLevelSent).toHaveLength(2);
	});

	it("insert(...).values(...).returning() delegates to core's own insert().values().returning() -- compiled SQL identical", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);
		const row = { id: rawRow.id, status: "draft" };

		const chainCompiled = handle
			.insert(posts)
			.values(row)
			.returning()
			.compile();
		const coreCompiled = compile(insert(posts).values(row).returning());

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("insert(...).returning(projection) forwards the explicit projection to core -- never silently widened to every column (delegation mutation: an ignored projection would drift)", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);
		const row = { id: rawRow.id, status: "draft" };

		const chainCompiled = handle
			.insert(posts)
			.values(row)
			.returning({ insertedId: posts.id })
			.compile();
		const coreCompiled = compile(
			insert(posts).values(row).returning({ insertedId: posts.id }),
		);

		expect(chainCompiled).toEqual(coreCompiled);
		expect(chainCompiled.sql).not.toEqual(
			compile(insert(posts).values(row).returning()).sql,
		);
	});

	it("insert(...).values(...).onConflictDoNothing(...) delegates to core's own onConflictDoNothing()", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);
		const row = { id: rawRow.id, status: "draft" };

		const chainCompiled = handle
			.insert(posts)
			.values(row)
			.onConflictDoNothing(posts.id)
			.returning()
			.compile();
		const coreCompiled = compile(
			insert(posts).values(row).onConflictDoNothing(posts.id).returning(),
		);

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("insert(...).values(...).onConflictDoUpdate(...) delegates to core's own onConflictDoUpdate()", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);
		const row = { id: rawRow.id, status: "draft" };

		const chainCompiled = handle
			.insert(posts)
			.values(row)
			.onConflictDoUpdate({ target: [posts.id], set: { status: "updated" } })
			.returning()
			.compile();
		const coreCompiled = compile(
			insert(posts)
				.values(row)
				.onConflictDoUpdate({ target: [posts.id], set: { status: "updated" } })
				.returning(),
		);

		expect(chainCompiled).toEqual(coreCompiled);
	});

	it("update(...).set(...) with no returning() resolves like db.execute; .where()/.returning() delegate to core", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);

		const noReturning = await handle.update(posts).set({ status: "archived" });
		expect(noReturning).toEqual([]);
		expect(topLevelSent).toHaveLength(1);

		const chainCompiled = handle
			.update(posts)
			.set({ status: "archived" })
			.where(eq(posts.status, "draft"))
			.returning({ archivedId: posts.id })
			.compile();
		const coreCompiled = compile(
			update(posts)
				.set({ status: "archived" })
				.where(eq(posts.status, "draft"))
				.returning({ archivedId: posts.id }),
		);

		expect(chainCompiled).toEqual(coreCompiled);
		expect(chainCompiled.sql).not.toEqual(
			compile(update(posts).set({ status: "archived" }).returning()).sql,
		);
	});

	it("deleteFrom(...) with no returning() resolves like db.execute; .where()/.returning() delegate to core", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);

		const noReturning = await handle.deleteFrom(posts);
		expect(noReturning).toEqual([]);
		expect(topLevelSent).toHaveLength(1);

		const chainCompiled = handle
			.deleteFrom(posts)
			.where(eq(posts.status, "draft"))
			.returning({ deletedId: posts.id })
			.compile();
		const coreCompiled = compile(
			deleteFrom(posts)
				.where(eq(posts.status, "draft"))
				.returning({ deletedId: posts.id }),
		);

		expect(chainCompiled).toEqual(coreCompiled);
		expect(chainCompiled.sql).not.toEqual(
			compile(deleteFrom(posts).returning()).sql,
		);
	});
});

describe("mutation chain result conversion (task 7.2 rework -- tables propagation axis)", () => {
	// Symmetric with 7.1's "await on a select chain returns converted
	// rows" proof: `makeChainTerminal(run, stage, tables)` (the generic
	// terminal 7.2's refactor introduced) has to thread `tables` through
	// to `executeOn`'s conversion step for every one of its four call
	// sites -- select's own (bound by the 7.1 test above) and each of
	// insert/update/delete's `*FinalChain` (bound by the three tests
	// below). Losing `tables` on any one of the three mutation paths
	// (e.g. a stray `{}`) would silently drop numeric-mode/`interval`
	// conversion for that path alone -- the other two, and the whole rest
	// of the query package's test suite, would stay green (R1 finding:
	// `tables: {}` on any one `make*FinalChain` survived the full
	// package suite before these three tests existed).
	it("insert(...).values(...).returning() converts bigint text to bigint -- not the driver's raw string", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ posts }, driver);

		const rows = await handle
			.insert(posts)
			.values({ id: rawRow.id, status: "draft" })
			.returning();

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("update(...).set(...).returning() converts bigint text to bigint -- not the driver's raw string", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ posts }, driver);

		const rows = await handle
			.update(posts)
			.set({ status: "archived" })
			.returning();

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("deleteFrom(...).returning() converts bigint text to bigint -- not the driver's raw string", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ posts }, driver);

		const rows = await handle.deleteFrom(posts).returning();

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});
});

describe("chain.compile() (task 7.3)", () => {
	it("chain.compile() equals compile(statement) and never touches the driver", () => {
		const { driver, topLevelSent, sentPerTransaction } =
			recordingTransactionalDriver();
		const handle = db({ posts, comments }, driver);
		const on = eq(posts.id, comments.postId);

		const selectChainCompiled = handle
			.select(posts)
			.innerJoin(comments, on)
			.where(eq(posts.status, "published"))
			.orderBy(posts.id)
			.limit(5)
			.compile();
		const selectCoreCompiled = compile(
			select(posts)
				.innerJoin(comments, on)
				.where(eq(posts.status, "published"))
				.orderBy(posts.id)
				.limit(5),
		);

		const insertChainCompiled = handle
			.insert(posts)
			.values({ id: rawRow.id, status: "draft" })
			.returning({ insertedId: posts.id })
			.compile();
		const insertCoreCompiled = compile(
			insert(posts)
				.values({ id: rawRow.id, status: "draft" })
				.returning({ insertedId: posts.id }),
		);

		const updateChainCompiled = handle
			.update(posts)
			.set({ status: "archived" })
			.where(eq(posts.status, "draft"))
			.compile();
		const updateCoreCompiled = compile(
			update(posts)
				.set({ status: "archived" })
				.where(eq(posts.status, "draft")),
		);

		const deleteChainCompiled = handle
			.deleteFrom(posts)
			.where(eq(posts.status, "draft"))
			.compile();
		const deleteCoreCompiled = compile(
			deleteFrom(posts).where(eq(posts.status, "draft")),
		);

		expect(selectChainCompiled).toEqual(selectCoreCompiled);
		expect(insertChainCompiled).toEqual(insertCoreCompiled);
		expect(updateChainCompiled).toEqual(updateCoreCompiled);
		expect(deleteChainCompiled).toEqual(deleteCoreCompiled);

		// zero driver interaction (decision ③): four `.compile()` calls
		// across every statement kind, never a single top-level send or a
		// single transaction opened.
		expect(topLevelSent).toHaveLength(0);
		expect(sentPerTransaction).toHaveLength(0);
	});
});

describe("chain surface uniformity across unscoped/scoped/tx (task 7.4)", () => {
	it("scoped and tx chains run under their context/session (recorded SQL proves it)", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db({ posts }, driver, { roles: [roleName("app_reader")] });

		// wiring point 2 -- ScopedDb's own chain: one context-applied
		// transaction, role then setting then the chain's own SQL, all
		// three in the *same* transaction array (not just "somewhere").
		await handle
			.as({ role: roleName("app_reader"), settings: { "app.claim": "v" } })
			.select(posts);

		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]).toHaveLength(3);
		expect(sentPerTransaction[0]?.[0]?.sql).toBe('set local role "app_reader"');
		expect(sentPerTransaction[0]?.[1]?.sql).toBe(
			"select set_config($1, $2, true)",
		);
		expect(sentPerTransaction[0]?.[2]?.sql).toContain("posts");

		// wiring point 4 -- the tx `db.as(context).transaction(cb)` hands
		// its callback: context applied once, every tx.select() call
		// afterward shares that same one transaction array.
		await handle
			.as({ role: roleName("app_reader") })
			.transaction(async (tx) => {
				await tx.select(posts);
				await tx.select(posts);
			});

		expect(sentPerTransaction).toHaveLength(2);
		expect(sentPerTransaction[1]).toHaveLength(3); // role + 2 selects
		expect(sentPerTransaction[1]?.[0]?.sql).toBe('set local role "app_reader"');
		expect(sentPerTransaction[1]?.[1]?.sql).toContain("posts");
		expect(sentPerTransaction[1]?.[2]?.sql).toContain("posts");

		// wiring point 3 -- the tx a plain (unscoped) `db.transaction(cb)`
		// hands its callback: no context to apply, but the chain SQL still
		// lands inside the callback's own one transaction.
		await handle.transaction(async (tx) => {
			await tx.select(posts);
		});

		expect(sentPerTransaction).toHaveLength(3);
		expect(sentPerTransaction[2]).toHaveLength(1);
		expect(sentPerTransaction[2]?.[0]?.sql).toContain("posts");
	});
});
