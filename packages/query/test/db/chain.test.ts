import {
	bigint,
	deleteFrom,
	eq,
	insert,
	interval,
	numeric,
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

		// the query layer remaps the driver's snake label back to the
		// caller's verbatim projection key (#339).
		expect(rows).toEqual([{ theStatus: "published" }]);
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

describe("typed mutation round-trip through declared read types (task 2.4, #322)", () => {
	// A dedicated table, self-contained to this describe block -- no
	// cross-group fixture dependency (tasks.md 2.4's own constraint):
	// `tags` is a plain `text[]` column, which needs no group-1 element-
	// wise read conversion at all (that machinery is `numeric[]`/
	// `interval[]`-specific, #320); a `text[]` cell already arrives from
	// any real driver as a JS string array, so `convertRow`'s existing
	// "no declared conversion for this typeName -- pass the raw value
	// through" branch is what a real read already does here, unchanged
	// by this group's own work.
	const metrics = table(app, "metrics", {
		id: uuid().primaryKey(),
		amount: bigint({ mode: "bigint" }),
		score: numeric({ mode: "string" }),
		duration: interval(),
		tags: text().array(),
	});

	it("typed writes round-trip through declared read types", async () => {
		const writtenDuration = {
			years: 0,
			months: 1,
			days: 2,
			hours: 3,
			minutes: 4,
			seconds: 5,
			microseconds: 6,
		};
		// The row a real server's `returning()` would hand back for this
		// insert -- each declared-conversion column's own canonical text
		// (bigint decimal, the always-full interval grammar #322 Settled
		// Decision 2 serializes to and `parseInterval` already consumes),
		// `tags` already as the JS array a driver hands back unconverted.
		const rawMetricsRow = {
			id: "22222222-2222-2222-2222-222222222222",
			amount: "9007199254740993",
			score: "123.45",
			duration: "0 years 1 mons 2 days 03:04:05.000006",
			tags: ["a", "b"],
		};
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [rawMetricsRow],
		});
		const handle = db({ metrics }, driver);

		const rows = await handle
			.insert(metrics)
			.values({
				id: rawMetricsRow.id,
				amount: 9007199254740993n,
				score: "123.45",
				duration: writtenDuration,
				tags: ["a", "b"],
			})
			.returning();

		// Write half: the compiled bind parameters the driver actually
		// received already carry each settled kind's own canonical text
		// (task 2.3's `liftColumnValue`/`serializeArrayLiteral`/
		// `serializeInterval`) -- the same grammar
		// `packages/query/test/compile/mutation.test.ts` pins at the
		// compile layer alone, proven here end to end through the actual
		// chain a driver receives.
		expect(topLevelSent[0]?.params).toEqual([
			rawMetricsRow.id,
			"9007199254740993",
			"123.45",
			"0 years 1 mons 2 days 03:04:05.000006",
			"{a,b}",
		]);

		// Read half: `convertRow` turns that same canonical text back into
		// the exact declared read shape each column promises -- bigint
		// mode's own `bigint`, `'string'`-mode numeric's own `string`, the
		// structured interval value (`parseInterval`, unchanged by this
		// group), and `tags` passed through as the array it already is.
		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
		expect(rows[0]?.score).toBe("123.45");
		expect(typeof rows[0]?.score).toBe("string");
		expect(rows[0]?.duration).toEqual(writtenDuration);
		expect(rows[0]?.tags).toEqual(["a", "b"]);
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
	// Each wiring point gets its own test (not one test covering all
	// three) so that removing any single point implicates exactly one
	// named test, never leaving two others only reachable by reading a
	// stack trace (the same axis-isolation lesson the 7.2 rework's
	// mutation-testing round already forced onto the mutation *chain*
	// tests, applied here to the wiring tests too).
	//
	// Named per the planner/reviewer's own W1-W4 wiring-point table
	// (measured against a pre-buildTx-refactor tree, `706fd1c`):
	//   W1 db.ts's unscoped handle -- (send) => send(driver)
	//   W2 context.ts's `db.as(ctx)` scoped handle -- (send) => scopedRun("db.as", send)
	//   W3 context.ts's `db.as(ctx).transaction(cb)` tx -- (send) => send(session)
	//   W4 transaction.ts's `db.transaction(cb)` tx -- (send) => send(session)
	// W3/W4 no longer read as two hand-written `const tx: Tx = {...}`
	// object literals in the current tree -- both now call the shared
	// `transaction.ts` `buildTx(session, tables)` (task 7.4's own
	// dedup), but the two *call sites* (context.ts's `scopedTransaction`
	// for W3, transaction.ts's `createTransactionApi` for W4) stay
	// exactly as distinct as before, which is what each test below
	// removes one at a time. W1 needs no dedicated test here -- it's
	// already exhaustively bound by every 7.1/7.2 await test.

	it("scoped and tx chains run under their context/session (recorded SQL proves it) -- W2, ScopedDb's own chain", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db({ posts }, driver, { roles: [roleName("app_reader")] });

		// one context-applied transaction, role then setting then the
		// chain's own SQL, all three in the *same* transaction array (not
		// just "somewhere").
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
	});

	it("db.as(context).transaction(cb)'s tx chain shares the one context-applied transaction -- W3", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db({ posts }, driver, { roles: [roleName("app_reader")] });

		// context applied once, every tx.select() call afterward shares
		// that same one transaction array.
		await handle
			.as({ role: roleName("app_reader") })
			.transaction(async (tx) => {
				await tx.select(posts);
				await tx.select(posts);
			});

		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]).toHaveLength(3); // role + 2 selects
		expect(sentPerTransaction[0]?.[0]?.sql).toBe('set local role "app_reader"');
		expect(sentPerTransaction[0]?.[1]?.sql).toContain("posts");
		expect(sentPerTransaction[0]?.[2]?.sql).toContain("posts");
	});

	it("a plain db.transaction(cb)'s tx chain shares its one transaction, no context to apply -- W4", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);

		await handle.transaction(async (tx) => {
			await tx.select(posts);
		});

		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]).toHaveLength(1);
		expect(sentPerTransaction[0]?.[0]?.sql).toContain("posts");
	});
});

describe("scoped/tx chain result conversion (task 7.4 rework -- tables propagation axis)", () => {
	// R2 finding: task 7.4 added two *new* `createChainApi(run, tables)`
	// call sites -- context.ts's `createAsApi` return (W2) and
	// transaction.ts's `buildTx` (shared by W3/W4) -- on top of the four
	// `chain.ts`-internal ones the 7.2 rework already bound
	// (`packages/query/src/db/chain.ts`'s four `make*FinalChain`
	// functions). Both new call sites are the same class of axis: losing
	// `tables` there (a stray `{}`) silently drops numeric-mode/
	// `interval` conversion for that surface's chains alone, while the
	// SQL-recording wiring tests above (which never inspect a resolved
	// row's *value*, only which statements landed in which transaction)
	// stay green -- confirmed survivable before these tests existed
	// (`tables: {}` on context.ts's W2 `createChainApi` call, and on
	// transaction.ts's `buildTx` call, each independently survived the
	// full package suite).
	//
	// Inventory update (7.13 closeout correction: this previously read
	// "six", omitting W1 -- db.ts's own unscoped createChainApi call
	// never got a dedicated inventory line because it was bound from
	// task 7.1 onward, but "already bound" isn't "not a call site").
	// The `tables`-propagation axis (first raised for `chain.ts`'s four
	// internal terminals, task 7.2 rework) has **seven** call sites
	// total, all at the same rank:
	//   1-4. chain.ts's four make*FinalChain functions (task 7.2 rework)
	//   5.   db.ts's own createChainApi call, `declarations.tables` -- W1
	//   6.   context.ts's createAsApi return -- W2 (task 7.4 rework, R2)
	//   7.   transaction.ts's buildTx -- shared by W3 and W4 (task 7.4 rework, R2)
	//
	// W1 is upstream of 1-4 for the unscoped surface specifically (it's
	// the one `tables` value db.ts hands to `createChainApi`, which
	// chain.ts's own select/insert/update/delete builders each thread
	// down to their own make*FinalChain independently) -- verified
	// during the 7.13 closeout by mutating db.ts's call to `{}`: **4**
	// tests went red at once (7.1's own select conversion test plus all
	// three of 7.2-rework's insert/update/delete conversion tests),
	// never just 1. That's a wider blast radius than W2/W3/W4 (each of
	// which only breaks its own single scoped/tx conversion test above,
	// since no scoped/tx equivalent of the insert/update/delete
	// conversion tests exists yet) -- expected given W1 sits upstream of
	// all four chain kinds for this one surface, not a sign the mutation
	// missed something.
	//
	// Confirmed-green-for-the-right-reason (TDD order note): production
	// code for W2/W3/W4 already existed before these three tests were
	// written (task 7.4 landed the wiring first, tasks.md-recorded as a
	// TDD-order deviation), so writing the test could not itself go red.
	// Each test below was instead verified the way task 7.4's own
	// wiring-point tests were verified: build the test, confirm it's
	// green, then mutate the exact `tables` argument at the relevant
	// `createChainApi`/`buildTx` call site to `{}` and confirm the same
	// test (and only that scope) goes red, then revert.
	it("db.as(context)'s own chain converts bigint text to bigint -- not the driver's raw string (W2)", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ posts }, driver, { roles: [roleName("app_reader")] });

		const rows = await handle
			.as({ role: roleName("app_reader") })
			.select(posts);

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("a plain db.transaction(cb)'s tx chain converts bigint text to bigint -- not the driver's raw string (W4)", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ posts }, driver);

		const rows = await handle.transaction(async (tx) => tx.select(posts));

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("db.as(context).transaction(cb)'s tx chain converts bigint text to bigint -- not the driver's raw string (W3, surface-symmetry evidence)", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ posts }, driver, { roles: [roleName("app_reader")] });

		const rows = await handle
			.as({ role: roleName("app_reader") })
			.transaction(async (tx) => tx.select(posts));

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});
});
